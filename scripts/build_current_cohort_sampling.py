#!/usr/bin/env python3
"""Export accepted SR215 current-cohort panels for Atlas presentation only.

This verifies and reformats saved RPF results. It performs no clustering,
state discovery, sampling, scoring, alignment, or coordinate generation.
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
from collections import defaultdict
from pathlib import Path


COHORT = "current-12104"
MODEL_COUNT = 12104
EXPECTED = {
    "models": "d1eeaaa00d7e42d5f9dfe4b1a7435dd091ba4a0f694acd111c4ff0411666d4dd",
    "ensembles": "d5965e5e778da8701bd6e0f17eb8c9b8010f61ff4dc94bbdb5d4febd6697047c",
    "states": "c0d576fa1ba36dbe25f15725b1c617f2c2356f5752470ea04c38aac5bed914d3",
    "selected": "dfdda201aad9d590077a957817a463744ae4386140fad19c5b1f4d15854accab",
    "audit": "45fe813fbe632ac6723271b5a45637243e578a097c19233f4ee730a7471cdd52",
    "atlas_view": "3f56602e9c391da4e5cfac6111936f1fe0ec6c32c4e8b7e258c41414f25c0d7a",
}
RANGE_META = {
    "all": ("All residues · 1–139", "1–139"),
    "res5-95": ("Residues 5–95", "5–95"),
    "res32-47-plus78-99": ("Residues 32–47 + 78–99", "32–47 + 78–99"),
}


def digest(body):
    return hashlib.sha256(body).hexdigest()


def verified(path, expected):
    body = Path(path).read_bytes()
    if digest(body) != expected:
        raise ValueError(f"Accepted input changed: {path}")
    return body


def json_bytes(value):
    return (json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def safe_write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError(f"Refusing symlink destination: {path}")
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError(f"Preserve differing existing artifact: {path}")
        return
    path.write_bytes(body)


def csv_bytes(rows, fields):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def load_csv(body):
    return list(csv.DictReader(io.StringIO(body.decode())))


def build(args):
    model_body = verified(args.models, EXPECTED["models"])
    ensemble_body = verified(args.ensembles, EXPECTED["ensembles"])
    state_body = verified(args.states, EXPECTED["states"])
    selected_body = verified(args.selected, EXPECTED["selected"])
    audit_body = verified(args.audit, EXPECTED["audit"])
    atlas_raw = Path(args.atlas_view).read_bytes()
    if atlas_raw[:2] == b"\x1f\x8b":
        atlas_raw = gzip.decompress(atlas_raw)
    if digest(atlas_raw) != EXPECTED["atlas_view"]:
        raise ValueError("Atlas logical clustering bytes changed")

    model_rows = json.loads(model_body)
    panels = json.loads(ensemble_body)
    states = load_csv(state_body)
    selected = load_csv(selected_body)
    audit = json.loads(audit_body)
    atlas = json.loads(atlas_raw)
    model_ids = [row["id"] for row in model_rows]
    model_set = set(model_ids)
    if len(model_ids) != MODEL_COUNT or len(model_set) != MODEL_COUNT:
        raise ValueError("RPF roster count or uniqueness differs")
    if atlas.get("models") != model_ids:
        raise ValueError("Atlas and accepted RPF model order differ")
    model_order_sha = digest(json.dumps(model_ids, separators=(",", ":")).encode())
    if model_order_sha != "1b8980f1a3dfe084c0b9322551f78027357fc4f774ed361c38d981b6c0b68330":
        raise ValueError("Current cohort model-order hash differs")
    if audit.get("status") != "validated" or audit.get("models") != MODEL_COUNT or audit.get("panel_count") != 48:
        raise ValueError("Accepted completion audit differs")

    state_rows = defaultdict(list)
    for row in states:
        if row["residue_range"] not in RANGE_META or row["state"] not in {"S1", "S2", "S3"}:
            raise ValueError("Unexpected accepted state")
        state_rows[row["residue_range"]].append(row)
    selected_by_panel = defaultdict(list)
    for row in selected:
        selected_by_panel[row["panel"]].append(row)
    for rows in selected_by_panel.values():
        rows.sort(key=lambda row: int(row["panel_index"]))

    output_panels = []
    writes = []
    seen = set()
    for panel in panels:
        panel_id = panel["id"]
        if panel_id in seen or panel["residue_range"] not in RANGE_META:
            raise ValueError("Duplicate or unexpected panel")
        seen.add(panel_id)
        rows = selected_by_panel.get(panel_id, [])
        members = panel["members"]
        if len(members) != 50 or len(set(members)) != 50 or not set(members) <= model_set:
            raise ValueError(f"Invalid accepted panel members: {panel_id}")
        if [row["model_id"] for row in rows] != members:
            raise ValueError(f"Panel CSV membership order differs: {panel_id}")
        if panel["selection"] not in {"mcmc50", "disco50"} or panel["repeat"] not in {1, 2, 3}:
            raise ValueError(f"Panel method or repeat differs: {panel_id}")
        structure = panel["structure"]
        if structure["path"] != f"current/panels/{panel_id}.pdb.gz" or structure["bytes"] <= 0:
            raise ValueError(f"Panel structure binding differs: {panel_id}")
        member_path = f"sr215-current/sampling/panels/{panel_id}.csv"
        member_body = csv_bytes(rows, list(rows[0]))
        safe_write(args.site / member_path, member_body)
        writes.append({"path": member_path, "bytes": len(member_body), "sha256": digest(member_body)})
        output_panels.append({
            "id": panel_id,
            "mask": panel["residue_range"],
            "state": panel["state"],
            "method": panel["selection"],
            "repeat": panel["repeat"],
            "seed": panel["seed"],
            "models": members,
            "accepted": True,
            "pdb": "https://benavt.github.io/rpf-results/" + structure["path"],
            "pdb_sha256": structure["sha256"],
            "pdb_bytes": structure["bytes"],
            "members_csv": member_path,
            "source_url": "https://benavt.github.io/rpf-results/#ensembles?id=" + panel_id,
            "native_result_sha256": panel["native_result_sha256"],
            "diagnostics": panel["diagnostics"],
        })

    expected_keys = {
        (row["residue_range"], row["state"], method, repeat)
        for row in states
        for method in ("mcmc50", "disco50")
        for repeat in (1, 2, 3)
    }
    actual_keys = {(p["mask"], p["state"], p["method"], p["repeat"]) for p in output_panels}
    if actual_keys != expected_keys or len(output_panels) != 48 or len(selected) != 2400:
        raise ValueError("Accepted panel matrix is incomplete")

    masks = []
    for range_id, (name, positions) in RANGE_META.items():
        rows = sorted(state_rows[range_id], key=lambda row: row["state"])
        masks.append({
            "id": range_id,
            "name": name,
            "states": [{
                "id": row["state"],
                "count": int(row["models"]),
                "anchor": row["representative"],
                "tm_positions_label": positions,
            } for row in rows],
            "sampling_note": (
                f"{len(rows)} accepted representative-relative TM state{'s' if len(rows) != 1 else ''}; "
                f"{int(rows[0]['unassigned_in_range']):,} models are unassigned for this residue scope. "
                "State labels are local to this mask and do not establish biological populations."
            ),
            "sampling_diagnostics": (
                "Three fixed saved repeats per method; 50 distinct models per state and panel. "
                "MCMC diagnostics are fixed-budget and do not establish convergence. "
                "DISCO and MCMC panels reuse the validated current-cohort RPF release."
            ),
        })

    summary = {
        "schema_version": 1,
        "kind": "accepted_cohort_sampling_summary",
        "cohort_models": MODEL_COUNT,
        "cohort_id": COHORT,
        "cohort_description": "Original audited SR215 cohort · 12,104 models",
        "repeats": 3,
        "models": model_ids,
        "model_order_sha256": model_order_sha,
        "masks": masks,
        "panels": output_panels,
        "source_receipts": {
            "rpf_models_sha256": EXPECTED["models"],
            "rpf_ensembles_sha256": EXPECTED["ensembles"],
            "states_sha256": EXPECTED["states"],
            "selected_models_sha256": EXPECTED["selected"],
            "completion_audit_sha256": EXPECTED["audit"],
            "atlas_source_view_sha256": EXPECTED["atlas_view"],
            "snapshot_sha256": audit["snapshot_sha256"],
        },
        "scientific_execution": False,
    }
    summary_path = "sr215-current/sampling/summary.json"
    summary_body = json_bytes(summary)
    safe_write(args.site / summary_path, summary_body)
    writes.append({"path": summary_path, "bytes": len(summary_body), "sha256": digest(summary_body)})
    receipt = {
        "status": "exported_accepted_saved_results_only",
        "scientific_execution": False,
        "cohort_id": COHORT,
        "model_count": MODEL_COUNT,
        "model_order_sha256": model_order_sha,
        "panel_count": len(output_panels),
        "selected_entries": len(selected),
        "source_sha256": EXPECTED,
        "writes": writes,
    }
    receipt_path = "sr215-current/sampling/export-receipt.json"
    receipt_body = json_bytes(receipt)
    safe_write(args.site / receipt_path, receipt_body)
    return {"summary": summary_path, "receipt": receipt_path, "panels": len(output_panels), "models": len(model_ids)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    for name in ("models", "ensembles", "states", "selected", "audit", "atlas-view"):
        parser.add_argument("--" + name, type=Path, required=True)
    print(json.dumps(build(parser.parse_args()), sort_keys=True))


if __name__ == "__main__":
    main()
