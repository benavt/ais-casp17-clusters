#!/usr/bin/env python3
"""Freeze or explicitly execute saved four-target HDBSCAN figures, never publish."""
from __future__ import annotations
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import importlib
from importlib.metadata import version
import itertools
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))
OPERATION = 'CASP17 four-target frozen HDBSCAN Bonsai and complete medoid grids'
PHASE_A_OPERATION = 'CASP17 four-target saved-Primary 10D UMAP HDBSCAN Phase A'
TARGETS = ('BhR2_bmr6717', 'CmR116_bmr17022', 'PaT90_bmr7191', 'StR82_bmr15386')
MASKS = {'BhR2_bmr6717': list(range(107)), 'CmR116_bmr17022': list(range(131)),
         'PaT90_bmr7191': list(range(7, 91)), 'StR82_bmr15386': list(range(77))}
MODEL_COUNT = 11000
PACKAGES = ('numpy', 'scipy', 'scikit-learn', 'biopython', 'pandas', 'h5py',
            'tables', 'ruamel.yaml', 'PyYAML', 'psutil', 'matplotlib', 'networkx', 'natsort')
ZERO = {'gpus': 0, 'paid_calls': 0, 'cost_usd': 0, 'automatic_retries': 0}
EXCLUDED = ['Clustering or UMAP/tSNE/default PCA refits', 'New group selection',
            'Reference TM scoring', 'Coordinate ensemble/PSE exports', 'PPTX/PDF reports',
            'Folding', 'Package installation', 'Git merges or public publication']


def limits():
    for name in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMBA_NUM_THREADS', 'BLIS_NUM_THREADS']:
        os.environ[name] = '8'
    allowed = sorted(os.sched_getaffinity(0))
    os.sched_setaffinity(0, set(allowed[:8]))


def need(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            value.update(block)
    return value.hexdigest()


def regular(path):
    path = Path(path).absolute()
    need(path.is_file() and not any(p.is_symlink() for p in [path, *path.parents]), 'Expected regular frozen file: ' + str(path))
    return path


def fresh(path):
    path = Path(path).absolute()
    need(not path.exists() and not any(p.is_symlink() for p in [path, *path.parents]), 'New immutable output required; no automatic retry: ' + str(path))
    return path


def read(path):
    return json.loads(regular(path).read_text())


def record(path):
    path = regular(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path)}


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def head(root):
    return subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()


def source_inventory(root):
    root = Path(root).absolute()
    need(not subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=all', '--', 'src', 'scripts', 'config'], text=True).strip(),
         'Commit and review source before freezing or executing: ' + str(root))
    names = subprocess.check_output(['git', '-C', str(root), 'ls-files', 'src', 'scripts', 'config', 'pyproject.toml', 'project_support.py'], text=True).splitlines()
    return [record(root / name) for name in names]


def verify(rows):
    for row in rows:
        need(record(row['path']) == row, 'Frozen source/input changed: ' + row['path'])


def target_inventory(phase_output, entry):
    """Read the exact saved groups; never rank models or select a group again."""
    from src.analysis.atlas_presentation import verify_files
    target = entry['target']; root = Path(phase_output) / target
    complete = read(root / 'complete.json')
    manifest = read(root / 'delivery-manifest.json'); delivery = root / 'delivery'
    verify_files(delivery, manifest['files'])
    data_path = delivery / 'density.json'; data = read(data_path)
    names, labels = data['models'], data['clusters']; reps = data['representatives']
    need(data['target'] == target and data['view_id'] == 'density' and names == entry['models']
         and len(names) == MODEL_COUNT and len(set(names)) == MODEL_COUNT and len(labels) == MODEL_COUNT,
         'Completed HDBSCAN cohort differs from frozen Phase A')
    membership = dict(zip(names, labels)); populations = Counter(labels)
    structural = {x for x in labels if not x.endswith('.unassigned')}
    by_label = {row['cluster']: row for row in reps}
    need(len(by_label) == len(reps) and set(by_label) == structural and 1 <= len(reps) <= 800,
         'Saved representatives do not cover exact nonnoise clusters')
    need(complete['structural_clusters'] == len(reps)
         and complete['unassigned_models'] == sum(x.endswith('.unassigned') for x in labels), 'Target completion counts differ')
    groups = {}
    for path in sorted((root / 'representative-selection/groups').glob('*.json')):
        group = read(path); selected = group['selected_models']; indices = group['selected_indices']; medoid = group['medoid_model']
        need(selected and len(selected) <= 5 and len(set(selected)) == len(selected)
             and len(indices) == len(selected) and all(type(i) is int and 0 <= i < len(names) for i in indices)
             and [names[i] for i in indices] == selected and medoid in selected,
             'Invalid saved selected-group identity')
        label = membership[medoid]
        need(label in by_label and label not in groups and all(membership[n] == label for n in selected)
             and group['population'] == populations[label] and by_label[label]['model'] == medoid
             and type(group['medoid_index']) is int and names[group['medoid_index']] == medoid,
             'Frozen group differs from final membership/medoid')
        key = hashlib.sha256(json.dumps(sorted(n for n in names if membership[n] == label), separators=(',', ':')).encode()).hexdigest()
        need(group['key'] == key and path.stem == key, 'Saved group key differs from exact final population')
        groups[label] = (group, record(path))
    need(set(groups) == structural, 'Saved selections are incomplete')
    selected = []
    for representative in reps:
        label = representative['cluster']; group = groups[label][0]
        need(representative['count'] == populations[label], 'Representative population changed')
        for index, name in zip(group['selected_indices'], group['selected_models']):
            selected.append({'model': name, 'index': index, 'cluster_label': label,
                             'confidence': entry['scores'][index]})
    need(len(selected) == len({row['model'] for row in selected}) and len(selected) >= 3,
         'Bonsai needs at least three unique saved selected models')
    medoids = [row['model'] for row in reps]
    need(len(medoids) == len(set(medoids)), 'Repeated saved medoid')
    pairs = [list(pair) for pair in sorted(tuple(sorted(pair)) for pair in itertools.combinations(medoids, 2))]
    positions = entry['retained_reference_positions']
    need(positions == MASKS[target], 'Target mask differs from approved Phase A')
    members = {row['model']: row for row in entry['members']}
    for row in selected:
        row['source_path'] = members[row['model']]['source_path']
    feature_proof = read(root / 'inference/feature-proof.json')
    need(feature_proof == entry['feature_proof'], 'Saved feature proof differs from Phase A input geometry')
    return {'target': target, 'phase_a_delivery': str(delivery), 'source_data_sha256': sha(data_path),
        'retained_positions': positions, 'canonical_positions': [p+1 for p in positions],
        'construct_residues': entry['expected_ca_count'], 'parent_manifest': entry['parent_manifest'],
        'feature_proof': feature_proof,
        'selections': selected, 'group_files': [groups[row['cluster']][1] for row in reps],
        'grid': {'labels': [row['cluster'] for row in reps], 'medoids': medoids, 'pairs': pairs,
                 'maximum_directional_calls': 2*len(pairs)},
        'members': [members[name] for name in medoids],
        'bonsai_settings': {'max_components': None, 'rescale_by_var': False,
                           'use_knn': -1 if len(selected) <= 64 else 10}}


def selected_features(target):
    import numpy as np
    from src.analysis.bonsai_interactive import selected_shared_distance_features
    parent = read(target['parent_manifest'])
    need(parent['terminal_detection']['retained_reference_positions'] == target['retained_positions'], 'Parent residue mask changed')
    names = [row['model'] for row in target['selections']]
    matrix, source = selected_shared_distance_features(parent, names)
    matrix = np.ascontiguousarray(matrix, dtype=np.float32)
    count = len(target['retained_positions']); expected = (len(names), count*(count-1)//2)
    need(matrix.shape == expected and np.isfinite(matrix).all() and np.all(matrix >= 0), 'Saved selected feature geometry differs')
    proof = {'shape': list(matrix.shape), 'dtype': str(matrix.dtype),
             'sha256': hashlib.sha256(matrix.tobytes(order='C')).hexdigest(),
             'model_order_sha256': hashlib.sha256(json.dumps(names, separators=(',', ':')).encode()).hexdigest(),
             'scaling': 'Frozen saved masked distance rows; float16 then float32; no scaling or extra mask.'}
    return matrix, source, proof


def resource_limits(wall_seconds=43200, output_gib=20):
    need(type(wall_seconds) is int and 1 <= wall_seconds <= 43200, 'Wall ceiling must be within twelve hours')
    need(type(output_gib) is int and 1 <= output_gib <= 20, 'Output ceiling must be within20GiB')
    return {'cpus': 8, 'memory_gib': 32, 'output_gib': output_gib, 'reserve_gib': 50,
            'wall_seconds': wall_seconds, **ZERO}


def prepare(phase_a_plan, engine, metadata, output, *, wall_seconds=43200, output_gib=20):
    limits(); phase_a_plan = regular(phase_a_plan); phase = read(phase_a_plan)
    need(phase.get('operation') == PHASE_A_OPERATION and tuple(x['target'] for x in phase['targets']) == TARGETS,
         'Choose the completed four-target HDBSCAN Phase A plan')
    phase_output = Path(phase['output']); completed = read(phase_output / 'complete.json')
    need(completed.get('status') == 'private_phase_a_complete_phase_b_pending'
         and completed.get('plan_sha256') == sha(phase_a_plan), 'Phase A has not completed under this exact plan')
    verify(phase['frozen_files'])
    metadata, output = fresh(metadata), fresh(output)
    need(not metadata.is_relative_to(output) and not output.is_relative_to(metadata), 'Separate metadata and science output roots')
    need(not output.is_relative_to(phase_output) and not metadata.is_relative_to(phase_output), 'Preserve the immutable Phase A output')
    need(not output.is_relative_to(Path(engine).absolute()), 'Keep generated output outside the frozen engine')
    resources = resource_limits(wall_seconds, output_gib)
    ancestor = output.parent
    while not ancestor.exists(): ancestor = ancestor.parent
    need(shutil.disk_usage(ancestor).free >= (resources['output_gib']+resources['reserve_gib'])*2**30, 'Insufficient output and working reserve')
    sources = source_inventory(ROOT)
    from scripts.regional_bonsai import inventory
    engine_rows = inventory(engine)
    native = phase['native_sources']['ensembles']; need(head(native['worktree']) == native['commit'], 'Pinned native ensemble source moved')
    sources += source_inventory(native['worktree'])
    frozen = {str(path): record(path) for path in [phase_a_plan, phase_output/'complete.json']}
    # The entire completed Phase A file set is an immutable post-run invariant.
    for path in sorted(phase_output.rglob('*')):
        if path.is_file(): frozen[str(path.absolute())] = record(path)
    targets = []
    from src.analysis.half_matrix import list_distogram_paths
    for entry in phase['targets']:
        target = target_inventory(phase_output, entry)
        matrix, _, proof = selected_features(target); del matrix
        target['selected_feature_proof'] = proof
        parent = read(target['parent_manifest']); directory = Path(parent['distogram_dir'])
        names = {row['model'] for row in target['selections']}
        bins = {path.stem: path for path in list_distogram_paths(directory)}
        need(names <= set(bins), 'Selected saved feature bin is missing')
        for path in [regular(target['parent_manifest']), *(bins[name] for name in names),
                     directory/'distogram_manifest.json', directory/'distogram_selection_metadata.json.gz']:
            frozen[str(Path(path).absolute())] = record(path)
        original = {row['model']: row for row in entry['members']}
        for name in names | set(target['grid']['medoids']):
            row = original[name]; actual = record(row['source_path'])
            need(actual['sha256'] == row['sha256'], 'Frozen selected original structure changed')
            frozen[actual['path']] = actual
        targets.append(target)
    runtime = {'host': os.uname().nodename, 'python': str(regular(Path(sys.executable).resolve())),
        'python_sha256': sha(sys.executable), 'usalign': phase['runtime']['usalign'],
        'usalign_sha256': phase['runtime']['usalign_sha256'],
        'versions': {package: version(package) for package in PACKAGES}}
    need(sha(runtime['usalign']) == runtime['usalign_sha256'], 'Approved USalign changed')
    bounds = {'Bonsai_fits': 4, 'native_full_SVD_preparations': 4,
        'Bonsai_rows': {t['target']: len(t['selections']) for t in targets},
        'medoid_unordered_pairs': sum(len(t['grid']['pairs']) for t in targets),
        'maximum_directional_TM_calls': sum(t['grid']['maximum_directional_calls'] for t in targets),
        'clustering_fits': 0, 'projection_fits': 0, 'new_group_selections': 0,
        'coordinate_exports': 0, 'package_installs': 0, **ZERO}
    plan = {'schema_version': 1, 'operation': OPERATION, 'source': {'worktree': str(ROOT), 'commit': head(ROOT)},
        'phase_a_plan': str(phase_a_plan), 'phase_a_plan_sha256': sha(phase_a_plan), 'phase_a_output': str(phase_output),
        'source_files': sources, 'frozen_files': list(frozen.values()), 'targets': targets,
        'native_ensembles': native, 'engine': {'root': str(Path(engine).absolute()), 'commit': head(engine), 'files': engine_rows},
        'runtime': runtime, 'resources': resources, 'bounds': bounds, 'output': str(output),
        'fit_order': list(TARGETS), 'stage_order': ['all_Bonsai', 'all_medoid_grids'],
        'cache_reuse': 'None: conservative full directional budget; no historical import.', 'excluded': EXCLUDED}
    metadata.mkdir(parents=True, exist_ok=False); write(metadata/'execution-plan.json', plan)
    result = {'status': 'awaiting_fresh_exact_approval', 'plan': str(metadata/'execution-plan.json'),
              'plan_sha256': sha(metadata/'execution-plan.json'), 'source_commit': plan['source']['commit'],
              'bounds': bounds, 'resources': resources, 'scientific_fits_started': 0}
    write(metadata/'status.json', result)
    return result


def validate(plan_path, approval_path):
    plan, approval = read(plan_path), read(approval_path)
    need(approval.get('status') == 'approved' and approval.get('user_message')
         and approval.get('approved_plan_sha256') == sha(plan_path)
         and approval.get('approved_source_commit') == plan['source']['commit'], 'Fresh approval must bind the exact figure plan and source')
    need(plan.get('schema_version') == 1 and plan.get('operation') == OPERATION
         and tuple(t['target'] for t in plan['targets']) == TARGETS
         and plan.get('fit_order') == list(TARGETS) and plan.get('stage_order') == ['all_Bonsai', 'all_medoid_grids']
         and plan.get('cache_reuse') == 'None: conservative full directional budget; no historical import.'
         and plan.get('excluded') == EXCLUDED, 'Changed finite figure operation')
    expected = resource_limits(plan['resources']['wall_seconds'], plan['resources']['output_gib'])
    need(plan['resources'] == expected, 'Resource scope differs from the reviewed figure limits')
    need(head(ROOT) == plan['source']['commit'] and Path(plan['source']['worktree']) == ROOT, 'Approved figure source moved')
    need(source_inventory(ROOT) + source_inventory(plan['native_ensembles']['worktree']) == plan['source_files'], 'Scientific source inventory changed')
    need(head(plan['native_ensembles']['worktree']) == plan['native_ensembles']['commit'], 'Pinned ensemble source moved')
    verify(plan['frozen_files'])
    from scripts.regional_bonsai import inventory
    need(head(plan['engine']['root']) == plan['engine']['commit']
         and inventory(plan['engine']['root']) == plan['engine']['files'], 'Native Bonsai engine changed')
    need(os.uname().nodename == plan['runtime']['host'] and sha(sys.executable) == plan['runtime']['python_sha256']
         and sha(plan['runtime']['usalign']) == plan['runtime']['usalign_sha256'], 'Approved host/executable changed')
    need(set(plan['runtime']['versions']) == set(PACKAGES)
         and all(version(name) == val for name, val in plan['runtime']['versions'].items()), 'Approved library runtime changed')
    phase = read(plan['phase_a_plan']); need(sha(plan['phase_a_plan']) == plan['phase_a_plan_sha256'], 'Frozen Phase A plan changed')
    need(plan['phase_a_output'] == phase['output'] and phase['operation'] == PHASE_A_OPERATION, 'Wrong Phase A source')
    output = Path(plan['output']).absolute(); metadata = Path(plan_path).absolute().parent
    need(not output.is_relative_to(Path(plan['phase_a_output'])) and not metadata.is_relative_to(output)
         and not output.is_relative_to(metadata) and not output.is_relative_to(Path(plan['engine']['root'])),
         'Figure output must preserve old science, metadata and the frozen engine')
    for entry, target in zip(phase['targets'], plan['targets']):
        expected_target = target_inventory(plan['phase_a_output'], entry)
        for key, val in expected_target.items(): need(target[key] == val, 'Saved selection/mask/grid changed: '+key)
        grid = target['grid']
        need(grid['pairs'] == [list(p) for p in sorted(tuple(sorted(p)) for p in itertools.combinations(grid['medoids'], 2))], 'Expanded or missing exact medoid pairs')
    expected_bounds = {'Bonsai_fits': 4, 'native_full_SVD_preparations': 4,
        'Bonsai_rows': {t['target']: len(t['selections']) for t in plan['targets']},
        'medoid_unordered_pairs': sum(len(t['grid']['pairs']) for t in plan['targets']),
        'maximum_directional_TM_calls': sum(t['grid']['maximum_directional_calls'] for t in plan['targets']),
        'clustering_fits': 0, 'projection_fits': 0, 'new_group_selections': 0,
        'coordinate_exports': 0, 'package_installs': 0, **ZERO}
    need(plan['bounds'] == expected_bounds, 'Changed exact scientific count ceilings')
    fresh(plan['output'])
    return plan


def load_ensembles(recorded):
    need(head(recorded['worktree']) == recorded['commit'], 'Pinned native ensemble source moved')
    key = '_casp17_figure_ensembles_' + recorded['commit']
    if key not in sys.modules:
        package = types.ModuleType(key); package.__path__ = [str(Path(recorded['worktree'])/'src/analysis')]
        sys.modules[key] = package
    return importlib.import_module(key+'.bounded_ensembles')


def run_grid(target, native, runtime, root):
    """Use exact saved medoids; never call group selection with empty arrays."""
    root = Path(root); root.mkdir(parents=True, exist_ok=False)
    need(sha(runtime['usalign']) == runtime['usalign_sha256'], 'Approved USalign changed before scoring')
    names = target['grid']['medoids']
    store = native.EnsembleStore(names, target['members'], None, None, target['retained_positions'], root/'canonical-inputs', count=1)
    # Native canonical_file uses an exclusive output file and an unlocked memo.
    # Match TMCache.matrix: prepare each input once before pair concurrency.
    for index in range(len(names)):
        store.canonical_file(index)
    tm = native.TMCache(store, root/'native-cache', runtime['usalign'], runtime['usalign_sha256'], target['grid']['maximum_directional_calls'], 0)
    indices = {name: i for i, name in enumerate(names)}; scores = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(tm.score, indices[a], indices[b]): tuple(sorted((a,b))) for a,b in target['grid']['pairs']}
        try:
            for future in as_completed(futures):
                val = float(future.result()); need(math.isfinite(val) and 0<=val<=1, 'Invalid native medoid value')
                scores[futures[future]] = val
        except BaseException:
            failed = getattr(tm, 'failed', None)
            if failed is not None:
                failed.set()
            for future in futures: future.cancel()
            raise
    need(len(scores) == len(target['grid']['pairs']) and tm.attempted <= target['grid']['maximum_directional_calls'], 'Native grid accounting differs')
    matrix = [[1. if a == b else scores[tuple(sorted((a,b)))] for b in names] for a in names]
    return {'labels': target['grid']['labels'], 'models': names, 'matrix': matrix,
            'title': 'TM similarity across every saved selected-group medoid', 'csv': 'grids/density.csv',
            'canonical_positions': target['canonical_positions'], 'source_data_sha256': target['source_data_sha256'],
            'note': 'Mean bidirectional full USalign, average-length normalization on the exact frozen target mask; no new clustering or medoid selection.'}, tm.attempted


def run_bonsai(target, engine, runtime, root):
    import bonsai_clustering as native
    from src.analysis.bonsai_interactive import run_ensemble_bonsai
    importlib.import_module('ruamel.yaml')
    native.bonsai_submodule_root = lambda: Path(engine['root'])
    def no_install(executable, status_callback=None):
        need(sha(executable) == runtime['python_sha256'], 'Bonsai subprocess Python changed')
        importlib.import_module('ruamel.yaml')
    native._ensure_ruamel_yaml = no_install
    matrix, source, proof = selected_features(target)
    need(proof == target['selected_feature_proof'], 'Frozen selected feature bytes/order changed')
    payload = run_ensemble_bonsai(matrix, target['selections'], Path(root)/'native',
        identifier=target['target']+'_HDBSCAN', feature_source=source, log=print)
    names = [row['model'] for row in payload['models']]
    need(len(names) == len(set(names)) == len(target['selections']) and set(names) == {row['model'] for row in target['selections']}
         and len(payload['layouts']) == 3, 'Incomplete native Bonsai export')
    write(Path(root)/'density.json', payload)
    return {'file': 'bonsai/density.json', 'sha256': sha(Path(root)/'density.json'), 'selected_models': len(payload['models'])}


def worker(plan_path, approval_path):
    recorded = os.environ.get('CASP17_FIGURE_CONTROLLER_PID', '')
    need(recorded.isdigit() and int(recorded) == os.getppid() and int(recorded)>1, 'Scientific worker requires its approved controller')
    limits(); plan = validate(plan_path, approval_path)
    root = Path(plan['output']); root.mkdir(parents=True, exist_ok=False)
    scratch = root/'scratch'; scratch.mkdir(); os.environ['TMPDIR'] = str(scratch)
    import tempfile
    tempfile.tempdir = str(scratch)
    trees = {}
    for target in plan['targets']:
        trees[target['target']] = run_bonsai(target, plan['engine'], plan['runtime'], root/target['target']/'bonsai')
    native = load_ensembles(plan['native_ensembles']); receipts=[]
    for target in plan['targets']:
        folder = root/target['target']; grid, calls = run_grid(target, native, plan['runtime'], folder/'tm')
        write(folder/'grids/density.json', grid)
        with (folder/'grids/density.csv').open('x', newline='') as stream:
            writer = csv.writer(stream); writer.writerow(['cluster', *grid['labels']])
            writer.writerows([label, *row] for label,row in zip(grid['labels'],grid['matrix']))
        result = {'target': target['target'], 'status': 'target_figures_complete', 'plan_sha256': sha(plan_path),
            'phase_a_plan_sha256': plan['phase_a_plan_sha256'], 'density_data_sha256': target['source_data_sha256'],
            'structural_clusters': len(grid['labels']), 'selected_models': len(target['selections']),
            'unordered_grid_pairs': len(target['grid']['pairs']), 'directional_native_calls': calls,
            'bonsai': trees[target['target']], 'medoid_tm': {'file': 'grids/density.json',
                'sha256': sha(folder/'grids/density.json'), 'csv': 'grids/density.csv', 'csv_sha256': sha(folder/'grids/density.csv')}}
        write(folder/'complete.json', result); receipts.append(result)
    verify(plan['frozen_files'])
    verify(plan['source_files'])
    from scripts.regional_bonsai import inventory
    need(head(ROOT) == plan['source']['commit'] and head(plan['native_ensembles']['worktree']) == plan['native_ensembles']['commit']
         and head(plan['engine']['root']) == plan['engine']['commit']
         and inventory(plan['engine']['root']) == plan['engine']['files'], 'Source or native engine changed during figure execution')
    need(sha(plan['runtime']['usalign']) == plan['runtime']['usalign_sha256'] and sha(sys.executable) == plan['runtime']['python_sha256'],
         'Approved executable changed during figure execution')
    write(root/'complete.json', {'status': 'casp17_hdbscan_figures_complete', 'plan_sha256': sha(plan_path),
        'phase_a_plan_sha256': plan['phase_a_plan_sha256'], 'source_commit': plan['source']['commit'],
        'targets': receipts, 'publication': False, 'coordinate_exports': 0,
        'directional_native_calls': sum(row['directional_native_calls'] for row in receipts), **ZERO})


def controller(plan, plan_path, approval_path):
    import fcntl
    import psutil
    from scripts.run_regional_comparison import monitor, stop_group
    parent = Path(plan['output']).parent
    while not parent.exists(): parent = parent.parent
    resource = plan['resources']
    need(shutil.disk_usage(parent).free >= (resource['output_gib']+resource['reserve_gib'])*2**30, 'Output would breach working reserve')
    with (Path(plan_path).parent/'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        env = {**os.environ, **{key:'8' for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS','BLIS_NUM_THREADS']},
               'CASP17_FIGURE_CONTROLLER_PID': str(os.getpid()), 'PYTHONDONTWRITEBYTECODE': '1'}
        child = None; started = time.monotonic()
        try:
            with (Path(plan_path).parent/'execution.log').open('x') as log, (Path(plan_path).parent/'resource-telemetry.jsonl').open('x') as telemetry:
                child = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'run','--plan',str(plan_path),
                    '--approval-file',str(approval_path),'--worker'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    process=psutil.Process(child.pid); process.cpu_affinity(process.cpu_affinity()[:8])
                    reason, elapsed=monitor(child, plan, process, psutil, lambda _:shutil.disk_usage(parent), telemetry)
                except psutil.NoSuchProcess:
                    reason, elapsed=None, time.monotonic()-started
                code=child.wait()
                write(Path(plan_path).parent/'execution-receipt.json', {'exit_code':code, 'stop_reason':reason,
                    'elapsed_seconds':elapsed, 'plan_sha256':sha(plan_path)})
                if code or reason: raise RuntimeError(reason or 'Figure batch failed; preserve diagnostics; no automatic retry')
        finally:
            if child is not None and child.poll() is None: stop_group(child)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__); commands=parser.add_subparsers(dest='command',required=True)
    prep=commands.add_parser('prepare')
    for name in ['phase-a-plan','engine-root','metadata','output']: prep.add_argument('--'+name,type=Path,required=True)
    prep.add_argument('--wall-seconds',type=int,default=43200); prep.add_argument('--output-gib',type=int,default=20)
    run=commands.add_parser('run'); run.add_argument('--plan',type=Path,required=True)
    run.add_argument('--approval-file',type=Path,required=True); run.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args(argv)
    if args.command=='prepare':
        print(json.dumps(prepare(args.phase_a_plan,args.engine_root,args.metadata,args.output,
            wall_seconds=args.wall_seconds,output_gib=args.output_gib),indent=2))
    elif args.worker: worker(args.plan,args.approval_file)
    else: controller(validate(args.plan,args.approval_file),args.plan,args.approval_file)


if __name__=='__main__': main()
