#!/usr/bin/env python3
"""Bind reviewed saved RPF observations and pooled views to an existing site.

This is an explicit saved-artifact export. It never fits, scores or samples.
Existing site data/native files are preserved; new outputs use distinct paths.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]

TARGET = 'SR215_bmr6366'
COHORT = 'afsample3-bioemu2'
RANGES = ('all', 'res5-95', 'res32-47-plus78-99')
POSITIONS = {'all': list(range(1, 140)), 'res5-95': list(range(5, 96)),
             'res32-47-plus78-99': list(range(32, 48)) + list(range(78, 100))}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    path = Path(path)
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def safe_relative(value):
    p = PurePosixPath(value)
    if not isinstance(value, str) or p.is_absolute() or '..' in p.parts or '\\' in value or not p.parts:
        raise ValueError('Select a safe relative artifact path')
    return value


def write_new(root, name, content):
    safe_relative(name)
    destination = root / name
    if destination.is_symlink() or any(p.is_symlink() for p in destination.parents):
        raise ValueError('Public artifact path is a symlink')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_bytes() != content:
            raise ValueError('Existing artifact differs; preserve it and select a new export destination: ' + name)
        return
    with destination.open('xb') as f:
        f.write(content)


def materialize(root, file):
    path = root / safe_relative(file)
    if path.is_file():
        return path.read_bytes()
    packed = root / (file + '.gz')
    if packed.is_file():
        return gzip.decompress(packed.read_bytes())
    raise ValueError('Saved analysis is absent: ' + file)


def build(site, scores, score_csv, cohort_root, cohort_manifest, violin, ptm):
    site = Path(site)
    source_pin = read_json(ROOT / 'config/sr215-rpf-source.json')
    if sha(scores) != source_pin['source_payload_sha256']:
        raise ValueError('RPF observations differ from the reviewed cross-project source payload')
    payload = read_json(scores)
    for key in ('rpf_snapshot_sha256', 'scientific_review_sha256', 'native_rpf_binary_sha256'):
        if payload['provenance'][key] != source_pin[key]:
            raise ValueError('RPF provenance differs from the reviewed source identity')
    if (payload['target'] != TARGET or payload['score_context'] != 'independent_single_model' or
            len(payload['models']) != 2000):
        raise ValueError('Reviewed complete SR215 RPF observations required')
    scored = {r['model_id']: r for r in payload['models']}
    if len(scored) != 2000 or any(sum(r['method'] == method for r in scored.values()) != 1000
                                  for method in ('afsample3', 'bioemu2')):
        raise ValueError('RPF source coverage differs')
    exported = read_json(cohort_manifest)
    expected = exported['files']
    for name, info in expected.items():
        safe_relative(name)
        if not name.startswith('rpf-sr215/') or not name.endswith(('.json', '.csv', '.cif', '.pdb', '.png', '.json.gz', '.csv.gz', '.cif.gz', '.pdb.gz')):
            raise ValueError('Only selected pooled-view artifacts may be exported')
        source = Path(cohort_root) / name
        if source.is_symlink() or source.stat().st_size != info['bytes'] or sha(source) != info['sha256']:
            raise ValueError('Pooled artifact changed: ' + name)
        write_new(site, name, source.read_bytes())
    bindings = {}
    ranges = []
    for range_id in RANGES:
        views = []
        for view_id, label in [('primary', 'UMAP KNN'), ('density', 'HDBSCAN')]:
            name = 'rpf-sr215/' + range_id + '/' + view_id + '.json'
            raw = materialize(site, name)
            write_new(site, name, raw)  # Plain JSON also supports an unchanged packed-asset catalog.
            data = json.loads(raw)
            if (data['target'] != TARGET or data['view_id'] != view_id or data['cohort_id'] != COHORT or
                    len(data['models']) != 2000 or set(data['models']) != set(scored) or
                    data['clustering_positions'] != POSITIONS[range_id]):
                raise ValueError('Pooled saved view is not the exact 2,000-model source cohort')
            digest = hashlib.sha256(raw).hexdigest()
            bindings[digest] = dict(source_data_sha256=digest, scored_models=2000, cohort_id=COHORT,
                                    range_id=range_id, view_id=view_id)
            views.append(dict(id=view_id, name=label, source_view_id=view_id, data=name,
                              asset_root='rpf-sr215/' + range_id + '/', source_data_sha256=digest,
                              canonical_positions=data['clustering_positions'], available=True))
        ranges.append(dict(id=range_id, name={'all':'All residues · 1–139','res5-95':'Residues 5–95',
                                            'res32-47-plus78-99':'Residues 32–47 + 78–99'}[range_id],
                           data=views[0]['data'], asset_root='rpf-sr215/' + range_id + '/',
                           default_view='density', available=True, views=views))
    # Bind original full-cohort analyses without altering any of their arrays or artifacts.
    policy = read_json(site / 'view-policy.json.gz') if (site/'view-policy.json.gz').exists() else read_json(site/'view-policy.json')
    original = policy['targets'][TARGET]
    original_ranges = original.get('residue_ranges') or list(original.get('ranges', {}).values())
    if not original_ranges:
        raise ValueError('Existing SR215 residue-range policy is absent')
    for entry in original_ranges:
        for view in entry['views']:
            if view.get('available') is False:
                continue
            raw = materialize(site, view['data'])
            data = json.loads(raw)
            count = len(set(data['models']) & set(scored))
            if count != 2000:
                raise ValueError('Original saved view does not contain all scored SR215 sources')
            digest = hashlib.sha256(raw).hexdigest()
            bindings[digest] = dict(source_data_sha256=digest, scored_models=count, cohort_id='all',
                                    range_id=entry['id'], view_id=view['id'])
    write_new(site, 'metrics/sr215-rpf.json', Path(scores).read_bytes())
    write_new(site, 'metrics/sr215-rpf.csv', Path(score_csv).read_bytes())
    for source, stem in [(Path(violin), 'sr215-rpf-violin'), (Path(ptm), 'sr215-afsample3-ptm-rpf')]:
        for suffix in ('.png', '.svg'):
            write_new(site, 'metrics/' + stem + suffix, source.with_suffix(suffix).read_bytes())
    catalog = dict(schema_version=1, target=TARGET,
                   observations=dict(file='metrics/sr215-rpf.json', sha256=sha(scores),
                                     source_models=2000, score_context='independent_single_model'),
                   bindings=list(bindings.values()),
                   cohort=dict(id=COHORT, name='AFSample3 + BioEMU2 · 2,000 models', available=True,
                               residue_ranges=ranges),
                   note='Full-construct RPF and native pTM are passive saved annotations and were never clustering features or selection weights.')
    write_new(site, 'rpf-overlays.json', (json.dumps(catalog, indent=2) + '\n').encode())
    return catalog


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('site', 'scores', 'score-csv', 'cohort-root', 'cohort-manifest', 'violin', 'ptm'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    result = build(a.site, a.scores, a.score_csv, a.cohort_root, a.cohort_manifest, a.violin, a.ptm)
    print(json.dumps(dict(target=TARGET, cohort=COHORT, bound_views=len(result['bindings']), scored_models=2000), indent=2))


if __name__ == '__main__':
    main()
