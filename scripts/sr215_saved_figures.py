#!/usr/bin/env python3
"""Prepare, then explicitly execute missing figures for frozen SR215 selected38.

Preparation only reads saved inputs and records identities. It never fits,
scores, exports coordinates, installs packages, merges or publishes.
"""
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

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'scripts')]
from scripts import casp17_hdbscan_figures as common
from scripts.regional_bonsai import inventory

OPERATION = 'SR215 selected38 frozen Primary/HDBSCAN Bonsai and medoid grids'
TARGET = 'SR215_bmr6366'
POSITIONS = list(range(32, 48)) + list(range(78, 100))
VIEWS = ('primary', 'density')
COUNTS = {'primary': 41, 'density': 138}
FEATURE_SHA = 'b30154a6bab08b419bb459afbb2060eaffb6a37ec7be6b48e1803552bbfe2a30'
OPTIONS = ['-mol', 'prot', '-ter', '1', '-a', 'T']
RESOURCE = dict(cpus=8, memory_gib=32, output_gib=5, reserve_gib=50,
                wall_seconds=14400, **common.ZERO)
read, sha, record, write, need = common.read, common.sha, common.record, common.write, common.need


def pair_union(views):
    return sorted({tuple(sorted(pair)) for v in views.values()
                   for pair in itertools.combinations(v['medoids'], 2)})


def frozen_views(root, phase):
    """Reuse saved selected members and medoids, including shared groups."""
    root = Path(root)
    names = phase['models']; need(len(names) == len(set(names)) == 11000, 'Wrong cohort')
    groups = {p.stem: (read(p), record(p)) for p in (root/'representative-selection/groups').glob('*.json')}
    views, used = {}, {}
    for view in VIEWS:
        path = root/'delivery/data'/f'{view}.json'; data = read(path)
        need(data['target'] == TARGET and data['models'] == names
             and data['provenance']['regional_canonical_positions'] == POSITIONS, 'Wrong view/mask')
        labels = data['clusters']; counts = Counter(labels); rows = data['representatives']
        need(len(labels) == len(names) and len(rows) == COUNTS[view]
             and {r['cluster'] for r in rows} == {x for x in labels if not x.endswith('.unassigned')},
             'Representatives must cover exact structural clusters')
        members_by_label = {}
        for i, label in enumerate(labels): members_by_label.setdefault(label, []).append(i)
        selected = []
        for row in rows:
            label = row['cluster']; indices = members_by_label[label]
            key = hashlib.sha256(json.dumps(sorted(names[i] for i in indices), separators=(',', ':')).encode()).hexdigest()
            group, frozen = groups[key]; chosen = group['selected_indices']
            need(group['key'] == key and group['population'] == counts[label] == row['count']
                 and 1 <= len(chosen) <= 5 and len(set(chosen)) == len(chosen)
                 and set(chosen).issubset(indices) and group['selected_models'] == [names[i] for i in chosen]
                 and group['medoid_model'] == row['model'] == names[group['medoid_index']]
                 and group['medoid_index'] in chosen, 'Frozen selection/medoid mismatch')
            selected.extend(dict(model=names[i], index=i, cluster_label=label, confidence=phase['scores'][i]) for i in chosen)
            used[frozen['path']] = frozen
        medoids = [r['model'] for r in rows]
        need(len(medoids) == len(set(medoids)) and len(selected) == len({r['model'] for r in selected}), 'Duplicate identity')
        views[view] = dict(labels=[r['cluster'] for r in rows], medoids=medoids,
                           selections=selected, source_data_sha256=sha(path))
    return views, list(used.values())


def reused_scores(cache, pairs, members, runtime):
    """Import only complete, identically masked native landmark comparisons."""
    need(cache['executable_sha256'] == runtime['usalign_sha256'] and cache['options'] == OPTIONS
         and cache['tm_metric'] == 'mean_bidirectional_average_length_normalized_usalign'
         and cache['normalization'] == 'average_structure_length', 'Landmark scoring settings differ')
    pool = cache['pool']; medoids = cache['medoids']; needed = set(map(tuple, pairs)); scores = {}
    for row, rep in zip(pool, medoids):
        name = row['model']; original = members[name]
        need(row['source_path'] == original['source_path'] and row['source_sha256'] == original['sha256']
             and rep['model'] == name and rep['shared_ca_count'] == len(POSITIONS)
             and [x['canonical_position'] for x in row['mapping']] == POSITIONS
             and rep['alignment_ca_keys'] == [['A', str(p)] for p in POSITIONS]
             and sha(row['canonical_path']) == row['canonical_sha256'], 'Landmark identity/mask changed')
    need(len(pool) == len(medoids) == 100, 'Incomplete landmark population')
    for comparison in cache['comparisons']:
        i, j = comparison['row'], comparison['column']
        key = tuple(sorted((pool[i]['model'], pool[j]['model'])))
        if key not in needed: continue
        directions = comparison['directions']; value = comparison['tm_score']
        need(len(directions) == 2 and math.isfinite(value) and 0 <= value <= 1, 'Incomplete cached pair')
        for direction, a, b in zip(directions, [i,j], [j,i]):
            need(direction['command'] == [runtime['usalign'], pool[a]['canonical_path'], pool[b]['canonical_path'], *OPTIONS],
                 'Cached command differs')
        need(abs(value - sum(r['tm_score'] for r in directions)/2) < 1e-12
             and abs(cache['matrix'][i][j]-value) < 1e-12 and key not in scores, 'Invalid cached score')
        scores[key] = value
    return scores


def features(phase):
    """Replay exact saved raw distance rows; no distances, fits or scaling."""
    import numpy as np
    from scripts.casp17_hdbscan import materialize
    full = materialize(read(phase['parent_manifest']), phase['models'])
    need(hashlib.sha256(full.tobytes()).hexdigest() == phase['expected_source_feature_array_sha256'], 'Source feature bytes changed')
    matrix = np.ascontiguousarray(full[:, phase['mask']['feature_columns']], dtype=np.float32)
    need(matrix.shape == (11000, 703) and hashlib.sha256(matrix.tobytes()).hexdigest() == FEATURE_SHA,
         'Selected38 feature bytes changed')
    return matrix


def prepare(phase_path, engine, output, plan_path):
    phase_path = common.regular(phase_path); phase = read(phase_path); root = Path(phase['output'])
    need(phase['source']['commit'] == 'bee233ea98ac80c24967550d1d452c58f86a2ae2'
         and phase['settings']['canonical_positions'] == POSITIONS
         and read(root/'complete.json')['plan_sha256'] == sha(phase_path), 'Wrong frozen Phase A')
    common.fresh(output); common.fresh(plan_path)
    views, groups = frozen_views(root, phase); pairs = pair_union(views)
    members = {r['model']: r for r in phase['members']}
    cache_path = root/'inference/density/landmark-tm/tm-results.json'; cache = read(cache_path)
    reuse = reused_scores(cache, pairs, members, phase['runtime'])
    need(len(pairs) == 9643 and len(reuse) == 21, 'Pair quote changed')
    parent_path = Path(phase['parent_manifest']); parent = read(parent_path)
    expected = {r['path']: r for r in phase['frozen_files']}
    paths = [parent_path, *[p for p in Path(parent['distogram_dir']).iterdir() if p.is_file()]]
    paths += [Path(members[n]['source_path']) for n in {n for v in views.values() for n in v['medoids']}]
    frozen = {str(p): record(p) for p in paths}
    need(all(expected.get(p) == r for p,r in frozen.items()), 'Frozen original/cache inventory changed')
    matrix = features(phase)
    import numpy as np
    for view in views.values():
        a = np.ascontiguousarray(matrix[[r['index'] for r in view['selections']]])
        view['selected_feature_sha256'] = hashlib.sha256(a.tobytes()).hexdigest()
    del matrix
    for p in [phase_path, root/'complete.json', root/'inference/feature-proof.json', root/'delivery-manifest.json', cache_path,
              *[Path(r['canonical_path']) for r in cache['pool']]]:
        frozen[str(p)] = record(p)
    for row in read(root/'delivery-manifest.json')['files']:
        p = root/'delivery'/row['path']; current = record(p)
        need(current['sha256'] == row['sha256'], 'Phase A delivery changed'); frozen[str(p)] = current
    frozen.update({r['path']: r for r in groups})
    source = common.source_inventory(ROOT); native = phase['native_sources']['ward']
    native_files = common.source_inventory(Path(native['worktree']))
    need(common.head(native['worktree']) == native['commit'], 'Native ensemble source changed')
    runtime = dict(phase['runtime']); runtime['versions'] = {p: version(p) for p in common.PACKAGES}
    need(sha(sys.executable) == runtime['python_sha256'] and sha(runtime['usalign']) == runtime['usalign_sha256'], 'Runtime changed')
    plan = dict(schema_version=1, operation=OPERATION, source=dict(branch='codex/sr215-missing-figures', commit=common.head(ROOT)),
        source_files=source, native_ensembles=native, native_source_files=native_files,
        phase_a_plan=str(phase_path), phase_a_plan_sha256=sha(phase_path), phase_a_output=str(root),
        frozen_files=list(frozen.values()), runtime=runtime, resources=RESOURCE, output=str(Path(output).absolute()),
        engine=dict(root=str(Path(engine).absolute()), commit=common.head(engine), files=inventory(engine)),
        views=views, pairs=[list(p) for p in pairs], reused_pairs=[dict(models=list(p), tm=v) for p,v in sorted(reuse.items())],
        members=[members[n] for n in sorted({n for v in views.values() for n in v['medoids']})],
        feature_sha256=FEATURE_SHA, canonical_positions=POSITIONS,
        bounds=dict(Bonsai_fits=2, complete_medoid_grids=2, new_directional_USalign_calls=2*(len(pairs)-len(reuse)),
                    selected_rows={k:len(v['selections']) for k,v in views.items()}),
        settings=dict(Bonsai='all nonzero centered PCA axes; no whitening/scaling; kNN10; native silhouette edge cuts2–7',
                      TM='mean bidirectional full USalign; average-length normalization; exact selected38 Cα mask'),
        excluded=common.EXCLUDED, scientific_execution=False, publication=False)
    write(plan_path, plan)
    return plan


def validate(plan_path, approval_path):
    plan = read(common.regular(plan_path)); approval = read(common.regular(approval_path))
    need(approval.get('status') == 'approved' and approval.get('user_message')
         and approval.get('approved_plan_sha256') == sha(plan_path), 'Fresh explicit approval of exact plan is required')
    need(plan['operation'] == OPERATION and plan['resources'] == RESOURCE and plan['canonical_positions'] == POSITIONS
         and plan['feature_sha256'] == FEATURE_SHA and plan['bounds']['Bonsai_fits'] == 2
         and plan['bounds']['new_directional_USalign_calls'] == 19244, 'Approved scope differs')
    need(common.head(ROOT) == plan['source']['commit'] and common.source_inventory(ROOT) == plan['source_files'], 'Source changed')
    need(common.head(plan['native_ensembles']['worktree']) == plan['native_ensembles']['commit']
         and common.source_inventory(Path(plan['native_ensembles']['worktree'])) == plan['native_source_files'], 'Native source changed')
    common.verify(plan['frozen_files'])
    views, _ = frozen_views(plan['phase_a_output'], read(plan['phase_a_plan']))
    need(pair_union(views) == list(map(tuple, plan['pairs'])) and set(plan['views']) == set(VIEWS), 'Pair union changed')
    for view, info in views.items():
        need(all(plan['views'][view][key] == value for key,value in info.items()), 'Saved selections changed')
    need(common.head(plan['engine']['root']) == plan['engine']['commit']
         and inventory(plan['engine']['root']) == plan['engine']['files'], 'Bonsai engine changed')
    runtime = plan['runtime']
    need(sha(sys.executable) == runtime['python_sha256'] and sha(runtime['usalign']) == runtime['usalign_sha256']
         and all(version(k)==v for k,v in runtime['versions'].items()), 'Runtime changed')
    common.fresh(plan['output'])
    return plan


def worker(plan_path, approval_path):
    from scripts.run_regional_comparison import require_controller
    require_controller(); common.limits(); plan = validate(plan_path, approval_path)
    root = Path(plan['output']); root.mkdir(parents=True, exist_ok=False)
    scratch = root/'scratch'; scratch.mkdir(); os.environ['TMPDIR'] = str(scratch)
    import tempfile
    tempfile.tempdir = str(scratch)
    import numpy as np
    import bonsai_clustering as bonsai
    from src.analysis.bonsai_interactive import run_ensemble_bonsai
    importlib.import_module('ruamel.yaml')
    bonsai.bonsai_submodule_root = lambda: Path(plan['engine']['root'])
    def no_install(executable, status_callback=None):
        need(sha(executable) == plan['runtime']['python_sha256'], 'Bonsai Python changed')
        importlib.import_module('ruamel.yaml')
    bonsai._ensure_ruamel_yaml = no_install
    phase = read(plan['phase_a_plan']); matrix = features(phase); trees = {}
    keep = np.zeros(phase['mask']['source_feature_count'], dtype=bool); keep[phase['mask']['feature_columns']] = True
    for view, info in plan['views'].items():
        selected = np.ascontiguousarray(matrix[[r['index'] for r in info['selections']]])
        need(hashlib.sha256(selected.tobytes()).hexdigest()==info['selected_feature_sha256'], 'Selected rows changed')
        source = dict(kind='frozen_models_by_features', retained_reference_positions=[p-1 for p in POSITIONS],
                      pair_mask_sha256=hashlib.sha256(keep.tobytes()).hexdigest(), feature_sha256=FEATURE_SHA,
                      feature_definition='Exact selected rows of frozen raw703 Cα-distance features; no scaling.')
        trees[view] = run_ensemble_bonsai(selected, info['selections'], root/'trees'/view,
            identifier='SR215_selected38_'+view, feature_source=source, log=print)
    del matrix
    native = common.load_ensembles(plan['native_ensembles']); names = [r['model'] for r in plan['members']]
    store = native.EnsembleStore(names, plan['members'], None, None, [p-1 for p in POSITIONS], root/'canonical-inputs', count=1)
    for i in range(len(names)): store.canonical_file(i)
    tm = native.TMCache(store, root/'native-cache', plan['runtime']['usalign'], plan['runtime']['usalign_sha256'], 19244, 0)
    scores = {tuple(r['models']): r['tm'] for r in plan['reused_pairs']}; lookup = {n:i for i,n in enumerate(names)}
    with ThreadPoolExecutor(max_workers=8) as pool:
        tasks = {pool.submit(tm.score, lookup[a], lookup[b]): (a,b) for a,b in plan['pairs'] if (a,b) not in scores}
        try:
            for task in as_completed(tasks):
                value = float(task.result()); need(math.isfinite(value) and 0<=value<=1, 'Invalid TM value')
                scores[tasks[task]] = value
        except BaseException:
            tm.failed.set()
            for task in tasks: task.cancel()
            raise
    need(len(scores)==len(plan['pairs']) and tm.attempted<=19244, 'Incomplete grid or expanded budget')
    delivery = root/'delivery'; old = Path(plan['phase_a_output'])/'delivery'
    shutil.copytree(old, delivery)
    for view, info in plan['views'].items():
        tree_path = delivery/'data'/f'{view}-bonsai.json'; write(tree_path, trees[view])
        ns = info['medoids']; grid = dict(labels=info['labels'], models=ns,
            matrix=[[1. if a==b else scores[tuple(sorted((a,b)))] for b in ns] for a in ns],
            title='TM similarity across cluster medoids', csv=f'grids/{view}.csv', canonical_positions=POSITIONS,
            note='Saved ensemble medoids; exact canonical38 Cα residues; mean bidirectional full USalign, average-length normalization.')
        write(delivery/'grids'/f'{view}.json', grid)
        with (delivery/'grids'/f'{view}.csv').open('x', newline='') as f:
            writer=csv.writer(f); writer.writerow(['cluster',*grid['labels']]); writer.writerows([label,*row] for label,row in zip(grid['labels'],grid['matrix']))
        path = delivery/'data'/f'{view}.json'; data = read(path)
        data['bonsai'] = dict(file=f'data/{view}-bonsai.json', sha256=sha(tree_path), selected_models=len(trees[view]['models']))
        data['medoid_tm'] = grid
        data['medoid_tm_note'] = grid['note']
        data['provenance']['export_stage'] = 'Frozen Phase A plus approved native Bonsai and complete medoid grids; coordinate ensembles/PSEs remain unavailable.'
        path.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
    common.verify(plan['frozen_files'])
    need(common.source_inventory(ROOT)==plan['source_files']
         and common.source_inventory(Path(plan['native_ensembles']['worktree']))==plan['native_source_files']
         and inventory(plan['engine']['root'])==plan['engine']['files']
         and sha(plan['runtime']['usalign'])==plan['runtime']['usalign_sha256'], 'Source changed during execution')
    write(root/'delivery-manifest.json', dict(files=[dict(path=p.relative_to(delivery).as_posix(),bytes=p.stat().st_size,sha256=sha(p)) for p in sorted(delivery.rglob('*')) if p.is_file()]))
    write(root/'complete.json', dict(status='selected38_figures_complete',plan_sha256=sha(plan_path),
          directional_USalign_calls=tm.attempted,reused_pairs=len(plan['reused_pairs']),publication=False))


def controller(plan, plan_path, approval_path):
    import fcntl
    import psutil
    from scripts.run_regional_comparison import monitor, stop_group
    parent = Path(plan['output']).parent
    while not parent.exists(): parent = parent.parent
    need(shutil.disk_usage(parent).free >= 55*2**30, 'Output would breach working reserve')
    with (plan_path.parent/'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env = {**os.environ, 'REGIONAL_CONTROLLER_PID': str(os.getpid()), 'PYTHONDONTWRITEBYTECODE': '1',
               **{k:'8' for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS','BLIS_NUM_THREADS']}}
        child = None
        try:
            with (plan_path.parent/'execution.log').open('x') as log, (plan_path.parent/'resource-telemetry.jsonl').open('x') as telemetry:
                child = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'execute','--plan',str(plan_path),
                    '--approval-file',str(approval_path),'--worker'], env=env, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    process=psutil.Process(child.pid); process.cpu_affinity(process.cpu_affinity()[:8])
                    reason, elapsed=monitor(child, plan, process, psutil, lambda _:shutil.disk_usage(parent), telemetry)
                except psutil.NoSuchProcess:
                    reason, elapsed=None, 0.
                code=child.wait()
                write(plan_path.parent/'execution-receipt.json', dict(exit_code=code,stop_reason=reason,
                      elapsed_seconds=elapsed,plan_sha256=sha(plan_path)))
                if code or reason: raise RuntimeError(reason or 'Figure batch failed; preserve diagnostics; no automatic retry')
        finally:
            if child is not None and child.poll() is None: stop_group(child)


def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare')
    for name in ['phase-a-plan','engine','output','plan']: prep.add_argument('--'+name,type=Path,required=True)
    run=sub.add_parser('execute');run.add_argument('--plan',type=Path,required=True);run.add_argument('--approval-file',type=Path,required=True);run.add_argument('--worker',action='store_true')
    a=p.parse_args()
    if a.action=='prepare':
        common.limits();plan=prepare(a.phase_a_plan,a.engine,a.output,a.plan)
        print(json.dumps(dict(plan=str(a.plan),sha256=sha(a.plan),bounds=plan['bounds'],resources=plan['resources'],scientific_execution=False),indent=2))
    elif a.worker: worker(a.plan,a.approval_file)
    else:
        plan=validate(a.plan,a.approval_file)
        controller(plan,a.plan,a.approval_file)


if __name__=='__main__': main()
