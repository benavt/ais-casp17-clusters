#!/usr/bin/env python3
"""Collect completed four-target figures into new immutable private deliveries.

This adapter copies saved artifacts only. It never selects models, fits, scores,
aligns coordinates, merges source or publishes.
"""
import argparse
from copy import deepcopy
import csv
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.analysis.atlas_presentation import _verified_delivery, digest, safe_file, verify_files

TARGETS = ('BhR2_bmr6717', 'CmR116_bmr17022', 'PaT90_bmr7191', 'StR82_bmr15386')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    path = Path(path)
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as stream:
        return json.load(stream)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def verify_frozen(rows):
    require(isinstance(rows, list) and rows, 'Figure plan must freeze its scientific inputs')
    for row in rows:
        path = Path(row['path']).absolute()
        require(path.is_file() and not any(p.is_symlink() for p in [path, *path.parents])
                and path.stat().st_size == row['bytes'] and digest(path) == row['sha256'],
                'Frozen figure input changed')


def checked_grid(grid, data, positions):
    reps = data['representatives']
    labels, models = [r['cluster'] for r in reps], [r['model'] for r in reps]
    require(grid.get('labels') == labels and grid.get('models') == models,
            'Figure medoid labels/models differ from frozen representatives')
    require(grid.get('canonical_positions') == [i + 1 for i in positions],
            'Figure medoid mask differs from frozen clustering residues')
    matrix, n = grid.get('matrix'), len(models)
    require(n > 0 and isinstance(matrix, list) and len(matrix) == n
            and all(isinstance(row, list) and len(row) == n for row in matrix),
            'Incomplete medoid figure matrix')
    require(all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1
                and v == matrix[j][i] and (i != j or v == 1)
                for i, row in enumerate(matrix) for j, v in enumerate(row)),
            'Invalid native medoid figure values')
    require(grid.get('csv') == 'grids/density.csv', 'Unexpected medoid download route')


def checked_csv(path, grid):
    with path.open(newline='') as stream:
        rows = list(csv.reader(stream))
    labels = grid['labels']
    require(len(rows) == len(labels) + 1 and rows[0][1:] == labels,
            'Medoid CSV labels differ')
    for i, row in enumerate(rows[1:]):
        require(len(row) == len(labels) + 1 and row[0] == labels[i]
                and all(abs(float(v) - grid['matrix'][i][j]) <= 1e-8
                        for j, v in enumerate(row[1:])), 'Medoid CSV values differ')


def checked_bonsai(tree, groups, positions):
    expected = [model for group in groups for model in group['selected_models']]
    rows = tree.get('models', [])
    models = [row.get('model') for row in rows]
    require(tree.get('schema_version') == 1 and models and len(models) == len(set(models))
            and len(expected) == len(set(expected)) and set(models) == set(expected),
            'Bonsai model identities differ from saved selections')
    require(tree.get('provenance', {}).get('retained_reference_positions') == positions,
            'Bonsai mask differs from frozen clustering residues')
    layouts = tree.get('layouts', [])
    require(isinstance(layouts, list) and len(layouts) == 3
            and all(isinstance(layout.get('key'), str) for layout in layouts)
            and len({layout['key'] for layout in layouts}) == 3, 'Incomplete native Bonsai layouts')
    for layout in layouts:
        nodes, edges = layout.get('nodes', []), layout.get('edges', [])
        require(nodes and isinstance(edges, list)
                and all(type(row.get('vertex')) is int and 0 <= row['vertex'] < len(nodes)
                        for row in rows), 'Invalid native Bonsai model/vertex mapping')
        for point in [*nodes, *(point for edge in edges for point in edge)]:
            require(isinstance(point, list) and len(point) == 2
                    and all(type(v) in (int, float) and math.isfinite(v) for v in point),
                    'Invalid native Bonsai geometry')


def verify_native_bonsai(root, target, tree):
    """Read saved audits and native layout geometry; no SVD or tree fitting."""
    for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMBA_NUM_THREADS'):
        os.environ[key] = '8'
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:8])
    import numpy as np
    from src.analysis.bonsai_interactive import export_saved_bonsai
    native = root / 'bonsai/native'
    result = safe_file(native, 'result.json')
    names = [row['model'] for row in target['selections']]
    require(read(result).get('selected_models') == target['selections'], 'Native Bonsai selections differ from approved plan')
    array = np.load(safe_file(native, 'input_audit/source_models_by_features.npy'), allow_pickle=False, mmap_mode='r')
    proof = target['selected_feature_proof']
    require(list(array.shape) == proof['shape'] and str(array.dtype) == proof['dtype']
            and hashlib.sha256(array.tobytes(order='C')).hexdigest() == proof['sha256'],
            'Native Bonsai source features differ from approved saved geometry')
    rebuilt = export_saved_bonsai(result, names, expected_retained_positions=target['retained_positions'])
    require(rebuilt == tree, 'Saved Bonsai figure differs from native audited geometry')


def assemble(phase_a_plan, figure_plan, primary_delivery, output):
    phase_a_plan, figure_plan = Path(phase_a_plan), Path(figure_plan)
    phase, figures = read(phase_a_plan), read(figure_plan)
    phase_sha, figure_sha = digest(phase_a_plan), digest(figure_plan)
    phase_root, figure_root = Path(phase['output']), Path(figures['output'])
    verify_frozen(figures.get('frozen_files'))
    done, receipt = read(figure_root / 'complete.json'), read(figure_plan.parent / 'execution-receipt.json')
    require(done.get('status') == 'casp17_hdbscan_figures_complete'
            and done.get('plan_sha256') == figure_sha
            and done.get('phase_a_plan_sha256') == phase_sha,
            'Figure completion does not bind this Phase A and figure plan')
    require(receipt.get('exit_code') == 0 and not receipt.get('stop_reason')
            and receipt.get('plan_sha256') == figure_sha, 'Figure controller did not complete successfully')
    require(read(phase_root / 'complete.json').get('plan_sha256') == phase_sha
            and [t['target'] for t in phase['targets']] == list(TARGETS), 'Wrong completed Phase A parent')
    primary = _verified_delivery(primary_delivery, selected_views={
        target + '/primary.json': target for target in TARGETS})
    frozen = {row['path']: row for row in phase['frozen_files']}
    output = Path(output).absolute()
    require(not output.exists() and not any(p.is_symlink() for p in [output, *output.parents]),
            'Use a new non-symlink assembly output')
    require(not any(output == root.absolute() or root.absolute() in output.parents
                    for root in [phase_root, figure_root, Path(primary_delivery)]),
            'Assembly output must be outside immutable input directories')
    prepared = []
    target_plans = {target['target']: target for target in figures['targets']}
    completed_targets = {target['target']: target for target in done.get('targets', [])}
    require(set(target_plans) == set(TARGETS) and len(figures['targets']) == len(TARGETS)
            and set(completed_targets) == set(TARGETS) and len(done['targets']) == len(TARGETS),
            'Figure plan/completion target set differs')
    for entry in phase['targets']:
        target = entry['target']
        source = _verified_delivery(phase_root / target / 'delivery', selected_views={'density.json': target})
        data = read(safe_file(source['path'], 'density.json'))
        data_sha = digest(safe_file(source['path'], 'density.json'))
        original_path = Path(entry['primary'])
        require(str(original_path) in frozen and digest(original_path) == frozen[str(original_path)]['sha256'],
                'Frozen Primary source changed')
        original = read(original_path)
        saved_primary = read(safe_file(primary['path'], target + '/primary.json'))
        require(saved_primary == original and saved_primary['models'] == data['models']
                and saved_primary['methods'] == data['methods']
                and saved_primary['projections'] == data['projections'],
                'Primary figure source differs from frozen cohort/display coordinates')
        positions = entry['retained_reference_positions']
        parent_path = Path(entry['parent_manifest'])
        require(str(parent_path) in frozen and digest(parent_path) == frozen[str(parent_path)]['sha256'],
                'Frozen Primary feature manifest changed')
        complete = read(safe_file(figure_root, target + '/complete.json'))
        require(complete.get('status') == 'target_figures_complete'
                and complete.get('target') == target and complete == completed_targets[target]
                and complete.get('plan_sha256') == figure_sha
                and complete.get('phase_a_plan_sha256') == phase_sha
                and complete.get('density_data_sha256') == data_sha,
                'Target figure completion differs from frozen density data')
        groups = [read(path) for path in sorted((source['path'].parent / 'representative-selection/groups').glob('*.json'))]
        membership = dict(zip(data['models'], data['clusters']))
        require(len(groups) == len(data['representatives'])
                and {g['medoid_model'] for g in groups} == {r['model'] for r in data['representatives']}
                and all(1 <= len(g['selected_models']) <= 5
                        and g['medoid_model'] in g['selected_models']
                        and all(membership[m] == membership[g['medoid_model']] for m in g['selected_models'])
                        for g in groups), 'Saved Phase A selections differ from representatives')
        files = {}
        for kind, key in [('bonsai', 'file'), ('medoid_tm', 'file'), ('medoid_tm', 'csv')]:
            descriptor = complete[kind]
            name = descriptor[key]
            require(name == ('bonsai/density.json' if kind == 'bonsai' else 'grids/density.' + ('csv' if key == 'csv' else 'json')),
                    'Unexpected completed figure route')
            path = safe_file(figure_root, target + '/' + name)
            require(digest(path) == descriptor['csv_sha256' if key == 'csv' else 'sha256'],
                    'Completed figure file changed')
            files[name] = path
        tree, grid = read(files['bonsai/density.json']), read(files['grids/density.json'])
        checked_bonsai(tree, groups, positions)
        verify_native_bonsai(figure_root / target, target_plans[target], tree)
        checked_grid(grid, data, positions)
        require(grid.get('source_data_sha256') == data_sha, 'Grid source identity differs')
        checked_csv(files['grids/density.csv'], grid)
        maps = saved_primary.get('heatmaps', [])
        require(len(maps) >= 2 and all(any(kind in (m.get('name', '') + ' ' + m.get('file', '')).lower()
                                        for m in maps) for kind in ('median', 'variance')),
                'Both saved Primary global distance maps are required')
        data = deepcopy(data)
        data['bonsai'] = {'file': 'bonsai/density.json', 'sha256': digest(files['bonsai/density.json']),
                          'selected_models': len(tree['models'])}
        data['medoid_tm'] = grid
        data['heatmaps'] = []
        for i, image in enumerate(maps):
            path = safe_file(primary['path'], image['file'])
            name = 'primary-figures/' + str(i) + '-' + Path(image['file']).name
            files[name] = path
            data['heatmaps'].append({**image, 'file': name})
        data['medoid_tm_note'] = 'Complete native TM grid over saved selected-group medoids and the exact clustering residues.'
        data['provenance']['export_stage'] = 'Approved native Bonsai and complete medoid grids; Phase A labels, projections, scores and representative coordinates preserved.'
        data['provenance']['figure_supplement'] = {'phase_a_plan_sha256': phase_sha,
            'figure_plan_sha256': figure_sha, 'authentic_density_data_sha256': data_sha,
            'primary_delivery_manifest_sha256': digest(primary['manifest']),
            'global_distance_maps': 'Exact saved Primary cohort maps; independent of cluster labels.'}
        prepared.append((target, source, data, files))
    size = sum(row['bytes'] for _, source, _, _ in prepared for row in source['rows'])
    size += sum(path.stat().st_size for _, _, _, files in prepared for path in files.values())
    ancestor = output.parent
    while not ancestor.exists():
        ancestor = ancestor.parent
    require(shutil.disk_usage(ancestor).free >= size + 50 * 2**30, 'Assembly would breach free storage reserve')
    output.mkdir(parents=True)
    for target, source, data, files in prepared:
        root = output / target
        delivery = root / 'delivery'
        delivery.mkdir(parents=True)
        for row in source['rows']:
            path = delivery / row['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(safe_file(source['path'], row['path']), path)
            require(digest(path) == row['sha256'], 'Copied Phase A bytes changed')
        for name, path in files.items():
            destination = delivery / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            require(not destination.exists(), 'Figure route collides with saved Phase A output')
            shutil.copyfile(path, destination)
            require(digest(destination) == digest(path), 'Copied figure bytes changed')
        # Only this new presentation copy is enriched.
        (delivery / 'density.json').write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
        rows = [{'path':p.relative_to(delivery).as_posix(), 'bytes':p.stat().st_size, 'sha256':digest(p)}
                for p in sorted(delivery.rglob('*')) if p.is_file()]
        write(root / 'delivery-manifest.json', {'files': rows})
        verify_files(source['path'], source['rows'])
        write(root / 'complete.json', {'status': 'target_supplements_collected', 'target': target,
              'phase_a_plan_sha256': phase_sha, 'figure_plan_sha256': figure_sha, 'scientific_execution': False})
    verify_files(primary['path'], primary['rows'])
    verify_frozen(figures['frozen_files'])
    result = {'status': 'casp17_hdbscan_supplements_collected', 'targets': list(TARGETS),
              'phase_a_plan_sha256': phase_sha, 'figure_plan_sha256': figure_sha,
              'scientific_execution': False, 'publication': False}
    write(output / 'collection-receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('phase-a-plan', 'figure-plan', 'primary-delivery', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(assemble(args.phase_a_plan, args.figure_plan, args.primary_delivery, args.output), indent=2))
