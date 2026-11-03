#!/usr/bin/env python3
"""Collect approved completed coordinate exports into new private deliveries.

Copies and enriches presentation metadata only; no selection, fitting, scoring,
PyMOL invocation, scientific export, source mutation or publication occurs here.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.analysis.atlas_presentation import _verified_delivery, digest, safe_file, verify_files
from src.analysis.atlas_grid_identity import resolve_grid_models
from structure_clustering.privacy import privacy_check

HEX = re.compile(r'^[0-9a-f]{64}$')
IDENT = re.compile(r'^[a-z][a-z0-9-]{0,63}$')
FIELDS = {'ensemble_file', 'ensemble_sha256', 'ensemble_pse', 'ensemble_pse_sha256',
          'ensemble_members', 'aligned_medoid', 'ensemble_metadata'}


def need(ok, message):
    if not ok:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def checked_path(path):
    path = Path(path)
    need('..' not in path.parts, 'Parent traversal is not allowed')
    return path.absolute()


def regular(path):
    path = checked_path(path)
    need(path.is_file() and not any(p.is_symlink() for p in [path, *path.parents]),
         'Expected a regular non-symlink input')
    return path


def artifact(root, record, expected=None):
    name = record.get('file')
    need(isinstance(name, str) and name and PurePosixPath(name).as_posix() == name
         and not any(p in {'', '.', '..'} for p in name.split('/'))
         and (expected is None or name == expected), 'Unexpected export asset route')
    path = safe_file(root, name)
    need(type(record.get('bytes')) is int and record['bytes'] > 0
         and HEX.fullmatch(record.get('sha256', '')) is not None
         and path.stat().st_size == record['bytes'] and digest(path) == record['sha256'],
         'Completed export asset changed')
    return path


def public_metadata(value, prefix, allowed_files):
    """Rebase verified analysis-root links to the cloned delivery namespace."""
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            if key == 'file':
                need(isinstance(child, str) and child in allowed_files,
                     'Metadata references an unverified export asset')
                result[key] = prefix + child
            else:
                result[key] = public_metadata(child, prefix, allowed_files)
        return result
    if isinstance(value, list):
        return [public_metadata(child, prefix, allowed_files) for child in value]
    return value


def frozen_data(analysis, source):
    path = regular(analysis['source_data']['path'])
    need(path.is_relative_to(source['path']), 'Frozen analysis is outside its delivery')
    name = path.relative_to(source['path']).as_posix()
    need(name in source['names'] and digest(path) == analysis['source_data']['sha256']
         and path.stat().st_size == analysis['source_data']['bytes'], 'Frozen source data changed')
    data = read(path)
    need(data['target'] == analysis['target'] and data['view_id'] == analysis['source_view_id'],
         'Wrong frozen target or saved view')
    groups, reps = analysis['groups'], data['representatives']
    need(len(groups) == len(reps) and [g['cluster'] for g in groups] == [r['cluster'] for r in reps],
         'Frozen group order differs from representatives')
    for group, rep in zip(groups, reps):
        need(rep['model'] == group['medoid']['model'] and rep['count'] == group['population'],
             'Frozen representative identity or population changed')
        need(all(data['models'][m['index']] == m['model']
                 and data['clusters'][m['index']] == group['cluster'] for m in group['selected_members']),
             'Frozen member index or cluster differs')
    return name, data


def enrich(analysis, data, manifest, export_root, evidence):
    """Resolve old grid identity before changing any representative/source SHA."""
    original = deepcopy(data)
    original_sha = analysis['source_data']['sha256']
    proof = None
    grid = data.get('medoid_tm')
    if grid:
        models = [r['model'] for r in data['representatives']]
        if 'models' not in grid:
            resolved = resolve_grid_models(data, original_sha, evidence.get('views', {}).get(original_sha),
                                           expected_canonical_positions=analysis['canonical_positions'])
            grid['models'] = resolved['models']
            proof = resolved['provenance']
            data.setdefault('provenance', {})['medoid_grid_identity'] = deepcopy(proof)
        need(grid['models'] == models, 'Saved medoid grid model identities differ')
    for key, expected in [('analysis_id', analysis['id']), ('target', analysis['target']),
                          ('range_id', analysis['range_id']), ('view_id', analysis['view_id']),
                          ('source_view_id', analysis['source_view_id']),
                          ('source_data_sha256', original_sha),
                          ('construct_residues', analysis['construct_residues']),
                          ('canonical_positions', analysis['canonical_positions']),
                          ('sequence_sha256', analysis['sequence_sha256'])]:
        need(manifest.get(key) == expected, 'Export manifest analysis identity or scope differs')
    groups = analysis['groups']
    need(len(manifest.get('groups', [])) == len(groups)
         and manifest.get('rigid_fits') == sum(len(g['selected_members']) for g in groups)
         and all(manifest.get(k) == 0 for k in ['new_group_selections', 'medoid_recomputations',
                                              'TM_calls', 'clustering_fits']),
         'Export completion changed selections or scientific inference')
    files = {}
    prefix = 'ensemble-exports/' + analysis['id'] + '/'
    reference = groups[0]['medoid']
    for number, (group, rep, exported) in enumerate(zip(groups, data['representatives'], manifest['groups']), 1):
        models = [m['model'] for m in group['selected_members']]
        need(exported.get('cluster') == group['cluster']
             and exported.get('population') == group['population']
             and exported.get('color') == group['color']
             and exported.get('medoid_model') == group['medoid']['model']
             and exported.get('selected_models') == models
             and exported.get('selection_policy') == group['selection_policy']
             and exported.get('canonical_positions') == analysis['canonical_positions']
             and exported.get('reference_model') == reference['model']
             and exported.get('reference_source_sha256') == reference['sha256']
             and exported.get('camera') == manifest.get('camera'), 'Exported frozen group differs')
        need(not any(rep.get(key) for key in FIELDS), 'Do not replace an existing saved ensemble')
        folder = f'groups/group-{number:04d}'
        assets = {}
        for key, filename, fmt in [('ensemble', 'ensemble.pdb', 'pdb'), ('pse', 'session.pse', 'pse'),
                                   ('medoid', 'medoid.pdb', 'pdb')]:
            record = exported[key]
            need(record.get('format') == fmt, 'Wrong exported coordinate format')
            path = artifact(export_root, record, folder + '/' + filename)
            privacy_check(path.read_bytes(), filename)
            assets[key] = prefix + record['file']; files[assets[key]] = (path, record['sha256'])
        members = exported.get('members', [])
        need([m.get('model') for m in members] == models, 'Exported member order differs')
        public_members = []
        for rank, (member, frozen) in enumerate(zip(members, group['selected_members']), 1):
            need(member.get('source_sha256') == frozen['sha256']
                 and member.get('format') == 'pdb'
                 and member.get('is_medoid') is (frozen['model'] == group['medoid']['model'])
                 and member.get('alignment_canonical_positions') == analysis['canonical_positions'],
                 'Exported member provenance differs')
            path = artifact(export_root, member, folder + f'/members/member-{rank:02d}.pdb')
            privacy_check(path.read_bytes(), path.name)
            name = prefix + member['file']; files[name] = (path, member['sha256'])
            public_members.append({'model': member['model'], 'file': name, 'sha256': member['sha256'],
                                   'format': 'pdb', 'is_medoid': member['is_medoid']})
        need(sum(m['is_medoid'] for m in public_members) == 1, 'Missing or duplicate aligned medoid')
        selected_medoid = next(m for m in members if m['is_medoid'])
        need(exported['medoid']['sha256'] == selected_medoid['sha256'], 'Aligned medoid bytes differ from selected member')
        metadata = safe_file(export_root, folder + '/metadata.json')
        need(read(metadata) == exported, 'Public group metadata differs from completed manifest')
        privacy_check(metadata.read_bytes(), metadata.name)
        allowed_files = {exported[key]['file'] for key in ['ensemble', 'pse', 'medoid']}
        allowed_files.update(member['file'] for member in members)
        published_metadata = public_metadata(exported, prefix, allowed_files)
        published_metadata['authentic_export_metadata_sha256'] = digest(metadata)
        metadata_bytes = (json.dumps(published_metadata, indent=2, allow_nan=False) + '\n').encode()
        privacy_check(metadata_bytes, metadata.name)
        metadata_sha = hashlib.sha256(metadata_bytes).hexdigest()
        metadata_name = prefix + folder + '/metadata.json'
        files[metadata_name] = (metadata_bytes, metadata_sha)
        rep.update(ensemble_file=assets['ensemble'], ensemble_sha256=exported['ensemble']['sha256'],
                   ensemble_pse=assets['pse'], ensemble_pse_sha256=exported['pse']['sha256'],
                   ensemble_members=public_members,
                   aligned_medoid={'file': assets['medoid'], 'sha256': exported['medoid']['sha256']},
                   ensemble_metadata={'file': metadata_name, 'sha256': metadata_sha})
    restored = deepcopy(data)
    for before, after in zip(original['representatives'], restored['representatives']):
        for key in FIELDS:
            if key in before: after[key] = before[key]
            else: after.pop(key, None)
    if grid and 'models' not in original['medoid_tm']:
        restored['medoid_tm'].pop('models')
        if 'provenance' not in original: restored.pop('provenance', None)
        elif 'medoid_grid_identity' not in original['provenance']:
            restored['provenance'].pop('medoid_grid_identity', None)
        else:
            restored['provenance']['medoid_grid_identity'] = deepcopy(original['provenance']['medoid_grid_identity'])
    need(restored == original, 'Assembly changed scientific data or existing representative coordinates')
    return data, files, proof


def assemble(plan_path, inventory_path, grid_evidence_path, output):
    plan_path, inventory_path = regular(plan_path), regular(inventory_path)
    plan, inventory = read(plan_path), read(inventory_path)
    plan_sha, inventory_sha = digest(plan_path), digest(inventory_path)
    need(plan.get('schema_version') == 1 and plan.get('analyses') == inventory.get('analyses')
         and plan['inventory']['sha256'] == inventory_sha
         and checked_path(plan['inventory']['path']) == inventory_path, 'Plan and frozen inventory differ')
    export_root = checked_path(plan['output'])
    done = read(safe_file(export_root, 'complete.json'))
    receipt = read(regular(plan_path.parent / 'execution-receipt.json'))
    need(done.get('status') == 'coordinate_exports_complete' and done.get('plan_sha256') == plan_sha
         and done.get('source_commit') == plan['source']['commit'] and done.get('bounds') == plan['bounds']
         and done.get('scientific_inference_changed') is False
         and all(done.get(k) == 0 for k in ['new_TM_calls', 'new_selections', 'automatic_retries'])
         and receipt.get('exit_code') == 0 and not receipt.get('stop_reason')
         and receipt.get('plan_sha256') == plan_sha, 'Approved export batch did not complete successfully')
    evidence = read(regular(grid_evidence_path)) if grid_evidence_path else {'views': {}}
    analyses = plan['analyses']; ids = [a['id'] for a in analyses]
    need(ids and len(ids) == len(set(ids)) and all(IDENT.fullmatch(i) for i in ids), 'Invalid analysis identities')
    completed = {row['analysis_id']: row for row in done['analyses']}
    need(set(completed) == set(ids) and len(done['analyses']) == len(ids), 'Incomplete export analysis set')
    sources = {}; prepared = []; total_groups = total_members = 0
    for analysis in analyses:
        source_path = checked_path(analysis['source_delivery'])
        data_path = regular(analysis['source_data']['path'])
        need(data_path.is_relative_to(source_path), 'Frozen source data outside delivery')
        relative = data_path.relative_to(source_path).as_posix()
        if source_path not in sources:
            selected = {Path(a['source_data']['path']).relative_to(source_path).as_posix(): a['target']
                        for a in analyses if checked_path(a['source_delivery']) == source_path}
            sources[source_path] = _verified_delivery(source_path, selected_views=selected)
        source = sources[source_path]; name, data = frozen_data(analysis, source)
        row = completed[analysis['id']]
        manifest_path = artifact(export_root, row['manifest'], analysis['id'] + '/export-manifest.json')
        manifest = read(manifest_path)
        need(row['groups'] == len(analysis['groups'])
             and row['selected_members'] == sum(len(g['selected_members']) for g in analysis['groups']),
             'Completed analysis counts differ')
        data, files, proof = enrich(analysis, data, manifest, manifest_path.parent, evidence)
        prepared.append((analysis, source, name, data, files, proof))
        total_groups += row['groups']; total_members += row['selected_members']
    need(plan['bounds']['groups'] == total_groups and plan['bounds']['selected_member_PDBs'] == total_members,
         'Completed batch counts differ from plan')
    output = checked_path(output)
    need(not output.exists() and not any(p.is_symlink() for p in [output, *output.parents]), 'Use a new non-symlink assembly root')
    protected = [export_root, plan_path.parent, *sources]
    need(all(not output.is_relative_to(p) and not p.is_relative_to(output) for p in protected), 'Output must be disjoint from immutable inputs')
    size = sum(row['bytes'] for source in sources.values() for row in source['rows'])
    size += sum(len(asset) if isinstance(asset, bytes) else asset.stat().st_size
                for _, _, _, _, files, _ in prepared for asset, _ in files.values())
    ancestor = output.parent
    while not ancestor.exists(): ancestor = ancestor.parent
    need(shutil.disk_usage(ancestor).free >= size + 50 * 2**30, 'Assembly would breach50GiB reserve')
    output.mkdir(parents=True, exist_ok=False); mapping = {}; group_roots = {}
    for analysis, source, name, data, files, proof in prepared:
        key = source['path']
        if key not in group_roots:
            root = output / analysis['id']; delivery = root / 'delivery'; delivery.mkdir(parents=True)
            for row in source['rows']:
                destination = delivery / row['path']; destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(safe_file(source['path'], row['path']), destination)
                need(digest(destination) == row['sha256'], 'Copied source bytes changed')
            group_roots[key] = (root, delivery, set())
        root, delivery, changed = group_roots[key]
        need(name not in changed, 'Duplicate enrichment of one saved view'); changed.add(name)
        for route, (asset, expected_sha) in files.items():
            destination = delivery / route; destination.parent.mkdir(parents=True, exist_ok=True)
            need(not destination.exists(), 'New ensemble route collides with saved artifact')
            if isinstance(asset, bytes): destination.write_bytes(asset)
            else: shutil.copyfile(asset, destination)
            need(digest(destination) == expected_sha, 'Copied export bytes changed')
        (delivery / name).write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
        mapping[analysis['id']] = {'target': analysis['target'], 'range_id': analysis['range_id'],
            'view_id': analysis['view_id'], 'source_view_id': analysis['source_view_id'],
            'delivery': str(delivery), 'data': name, 'source_data_sha256': analysis['source_data']['sha256'],
            'new_data_sha256': digest(delivery / name), 'groups': len(analysis['groups']),
            'legacy_grid_identity': proof}
    for source_path, (root, delivery, changed) in group_roots.items():
        source = sources[source_path]
        for row in source['rows']:
            if row['path'] not in changed: need(digest(delivery / row['path']) == row['sha256'], 'Existing scientific asset changed')
        rows = [{'path': p.relative_to(delivery).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)}
                for p in sorted(delivery.rglob('*')) if p.is_file()]
        write(root / 'delivery-manifest.json', {'files': rows})
        verify_files(source['path'], source['rows'])
    need(digest(plan_path) == plan_sha and digest(inventory_path) == inventory_sha, 'Plan or inventory changed during assembly')
    result = {'status': 'coordinate_export_deliveries_assembled', 'plan_sha256': plan_sha,
        'inventory_sha256': inventory_sha, 'analyses': mapping, 'groups': total_groups,
        'selected_members': total_members, 'source_delivery_groups': len(group_roots),
        'scientific_data_unchanged': True, 'scientific_execution': False, 'public_publication': False}
    write(output / 'assembly-receipt.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['plan', 'inventory', 'output']: parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--grid-evidence', type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(assemble(args.plan, args.inventory, args.grid_evidence, args.output), indent=2))


if __name__ == '__main__': main()
