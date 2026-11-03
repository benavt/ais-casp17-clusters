#!/usr/bin/env python3
"""Freeze or execute an explicitly approved coordinate-only CASP17 export batch."""
from __future__ import annotations
import argparse
from collections import Counter
import importlib.util
from importlib.metadata import version
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.casp17_hdbscan_figures import (need, sha, regular, fresh, read, record,
    write, head, source_inventory, verify, limits)
from src.analysis.casp17_ensemble_exports import checked_inventory, public_record

OPERATION = 'CASP17 frozen selected coordinate ensemble and PSE exports only'
MODEL_COUNT = 11000
PACKAGES = ('numpy', 'biopython', 'pandas', 'psutil')
ALIGNMENT = 'One proper rigid retained-canonical-CA fit per selected member directly to the first frozen medoid per analysis; no outlier pruning.'
CAMERA = 'One native camera per analysis covering union bounds of all aligned full-construct atoms.'
RESOURCES = {'cpus': 8, 'memory_gib': 16, 'output_gib': 8, 'wall_seconds': 3600, 'reserve_gib': 50}
EXCLUDED = ['New selection/ranking or medoid recomputation', 'Clustering or projection fits',
            'USalign/TM scoring', 'Bonsai or feature PCA/SVD', 'Folding', 'Images/reports',
            'Paid APIs', 'Package installation', 'Automatic retries', 'Git operations/publication']


def runtime():
    """Hash installed PyMOL source/native code without importing or launching it."""
    files = {}
    for name in ('pymol', 'pymol2'):
        spec = importlib.util.find_spec(name)
        need(spec is not None and spec.submodule_search_locations, 'Existing installed native PyMOL runtime required')
        for directory in spec.submodule_search_locations:
            for path in sorted(Path(directory).rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix in {'.py', '.so', '.pyd', '.dll'}:
                    files[str(path)] = record(path)
    native = [row for row in files.values() if Path(row['path']).suffix == '.so']
    need(native, 'Native PyMOL shared library is missing')
    dependencies = {}
    for row in native:
        result = subprocess.run(['ldd', row['path']], capture_output=True, text=True, check=True)
        need('not found' not in result.stdout, 'Native PyMOL dependency is unavailable')
        for line in result.stdout.splitlines():
            words = line.replace('=>', ' ').split()
            for word in words:
                if word.startswith('/') and Path(word).is_file():
                    resolved = Path(word).resolve()
                    dependencies[str(resolved)] = record(resolved)
    return {'host': os.uname().nodename, 'python': str(Path(sys.executable).resolve()),
        'python_sha256': sha(sys.executable), 'versions': {name: version(name) for name in PACKAGES},
        'pymol_files': sorted(files.values(), key=lambda x:x['path']),
        'native_dependencies': sorted(dependencies.values(), key=lambda x:x['path'])}


def frozen_records(inventory, inventory_path):
    rows = {str(regular(inventory_path)): record(inventory_path)}
    def add(path, expected_sha=None, expected_bytes=None):
        actual = record(path)
        need(expected_sha is None or actual['sha256'] == expected_sha, 'Frozen input hash differs: '+str(path))
        need(expected_bytes is None or actual['bytes'] == expected_bytes, 'Frozen input size differs: '+str(path))
        rows[actual['path']] = actual
    for row in inventory.get('frozen_files', []):
        add(row['path'], row['sha256'], row.get('bytes'))
    for analysis in checked_inventory(inventory):
        add(analysis['source_data']['path'], analysis['source_data']['sha256'])
        data = read(analysis['source_data']['path'])
        need(data['target'] == analysis['target'] and data['view_id'] == analysis['source_view_id']
             and len(data['models']) == MODEL_COUNT and len(set(data['models'])) == MODEL_COUNT
             and len(data['clusters']) == MODEL_COUNT, 'Frozen delivery cohort or raw view differs')
        representatives = data['representatives']
        need([r['cluster'] for r in representatives] == [g['cluster'] for g in analysis['groups']], 'Frozen group/medoid order differs from delivery')
        populations = Counter(data['clusters'])
        for group, representative in zip(analysis['groups'], representatives):
            need(group['population'] == populations[group['cluster']] == representative['count']
                 and representative['model'] == group['medoid']['model'], 'Saved delivery medoid or population differs')
        for group in analysis['groups']:
            proof = group['group_file']; add(proof['path'], proof['sha256'], proof.get('bytes'))
            selected = group['selected_members']; saved = read(proof['path'])
            need(saved['selected_models'] == [r['model'] for r in selected]
                 and saved['selected_indices'] == [r['index'] for r in selected]
                 and saved['population'] == group['population']
                 and saved['medoid_model'] == group['medoid']['model']
                 and saved['medoid_index'] == group['medoid']['index']
                 and saved['selection_policy'] == group['selection_policy'], 'Frozen native group proof differs')
            need(all(0 <= r['index'] < MODEL_COUNT and data['models'][r['index']] == r['model']
                 and data['clusters'][r['index']] == group['cluster'] for r in selected), 'Selected model index/membership differs')
            for row in group['selected_members']:
                add(row['source_path'], row['sha256'], row.get('bytes'))
    return sorted(rows.values(), key=lambda row:row['path'])


def bounds_for(analyses):
    groups = sum(len(a['groups']) for a in analyses)
    selected = sum(len(g['selected_members']) for a in analyses for g in a['groups'])
    return {'analyses': len(analyses), 'groups': groups, 'selected_member_PDBs': selected,
        'multi_model_PDBs': groups, 'aligned_medoid_PDBs': groups, 'PSE_sessions': groups, 'PSE_roundtrip_reads': groups,
        'maximum_proper_rigid_fits': selected, 'new_group_selections': 0, 'medoid_recomputations': 0,
        'clustering_fits': 0, 'projection_fits': 0, 'TM_calls': 0, 'Bonsai_fits': 0,
        'feature_SVDs': 0, 'gpus': 0, 'paid_calls': 0, 'cost_usd': 0, 'automatic_retries': 0}


def canonical_fresh(path):
    # First reject existing symlink components, then reject existing aliases via '..'.
    return fresh(fresh(path).resolve(strict=False))


def disjoint(output, metadata, frozen, analyses):
    output, metadata = Path(output).resolve(strict=False), Path(metadata).resolve(strict=False)
    need(not output.is_relative_to(metadata) and not metadata.is_relative_to(output), 'Metadata and output must be disjoint')
    need(all(not p.is_relative_to(ROOT/name) for p in (output, metadata) for name in ('src','scripts','config')), 'Generated output/metadata cannot modify source/config')
    for row in frozen:
        source = Path(row['path']).resolve(strict=False)
        need(not source.is_relative_to(output) and not source.is_relative_to(metadata), 'Output/metadata would contain frozen input')
    protected = {Path(a['source_data']['path']).resolve(strict=False).parent for a in analyses}
    protected.update(Path(a['source_delivery']).resolve(strict=False) for a in analyses)
    protected.update(Path(g['group_file']['path']).resolve(strict=False).parent for a in analyses for g in a['groups'])
    protected.update(Path(r['source_path']).resolve(strict=False).parent for a in analyses for g in a['groups'] for r in g['selected_members'])
    need(all(not output.is_relative_to(p) and not metadata.is_relative_to(p) for p in protected),
         'New output and metadata must preserve frozen scientific input directories')


def prepare(inventory_path, metadata, output):
    limits()
    inventory_path = regular(inventory_path); inventory = read(inventory_path)
    analyses = checked_inventory(inventory)
    metadata, output = canonical_fresh(metadata), canonical_fresh(output)
    frozen = frozen_records(inventory, inventory_path)
    disjoint(output, metadata, frozen, analyses)
    ancestor = output.parent
    while not ancestor.exists(): ancestor = ancestor.parent
    need(shutil.disk_usage(ancestor).free >= 58*2**30, '8GiB output plus50GiB reserve required')
    plan = {'schema_version': 1, 'operation': OPERATION,
        'source': {'worktree': str(ROOT), 'commit': head(ROOT)},
        'source_files': source_inventory(ROOT), 'inventory': record(inventory_path),
        'frozen_files': frozen, 'analyses': analyses, 'runtime': runtime(),
        'resources': RESOURCES.copy(), 'bounds': bounds_for(analyses),
        'alignment_policy': ALIGNMENT,
        'camera_policy': CAMERA,
        'excluded': EXCLUDED, 'output': str(output), 'execution_started': False}
    metadata.mkdir(parents=True, exist_ok=False)
    write(metadata/'execution-plan.json', plan)
    status = {'status': 'awaiting_fresh_exact_user_approval', 'plan': str(metadata/'execution-plan.json'),
        'plan_sha256': sha(metadata/'execution-plan.json'), 'source_commit': plan['source']['commit'],
        'resources': plan['resources'], 'bounds': plan['bounds'], 'target_exports_started': 0}
    write(metadata/'status.json', status)
    return status


def validate(plan_path, approval_path):
    plan, approval = read(plan_path), read(approval_path)
    need(approval.get('status') == 'approved' and isinstance(approval.get('user_message'), str) and approval['user_message'].strip()
         and approval.get('approved_plan_sha256') == sha(plan_path)
         and approval.get('approved_source_commit') == plan['source']['commit'], 'Fresh explicit approval must bind exact plan and source')
    need(plan.get('schema_version') == 1 and plan.get('operation') == OPERATION
         and plan.get('resources') == RESOURCES and plan.get('excluded') == EXCLUDED
         and plan.get('execution_started') is False and plan.get('alignment_policy') == ALIGNMENT
         and plan.get('camera_policy') == CAMERA, 'Changed finite export operation')
    need(plan['source'] == {'worktree': str(ROOT), 'commit': head(ROOT)}, 'Approved export source moved')
    need(source_inventory(ROOT) == plan['source_files'], 'Approved source inventory changed')
    verify(plan['frozen_files']); need(record(plan['inventory']['path']) == plan['inventory'], 'Frozen selection inventory changed')
    inventory = read(plan['inventory']['path']); analyses = checked_inventory(inventory)
    need(analyses == plan['analyses'] and bounds_for(analyses) == plan['bounds'], 'Changed selected groups, order, masks or export counts')
    need(frozen_records(inventory, plan['inventory']['path']) == plan['frozen_files'], 'Frozen file set changed')
    need(runtime() == plan['runtime'], 'Approved host/native PyMOL runtime changed')
    output = canonical_fresh(plan['output']); disjoint(output, Path(plan_path).absolute().parent, plan['frozen_files'], analyses)
    return plan


def worker(plan_path, approval_path):
    parent = os.environ.get('CASP17_ENSEMBLE_CONTROLLER_PID', '')
    need(parent.isdigit() and int(parent) == os.getppid() and int(parent)>1, 'Exports require the approved bounded controller')
    limits(); plan = validate(plan_path, approval_path)
    output = Path(plan['output']); output.mkdir(parents=True, exist_ok=False)
    scratch = output/'scratch'; scratch.mkdir(); os.environ['TMPDIR'] = str(scratch)
    import tempfile
    tempfile.tempdir = str(scratch)
    import pymol2
    from src.analysis.casp17_ensemble_exports import export_analysis
    receipts = []
    for analysis in plan['analyses']:
        result = export_analysis(analysis, output/analysis['id'], pymol2.PyMOL)
        receipts.append({'analysis_id': analysis['id'], 'groups': len(result['groups']),
            'selected_members': result['rigid_fits'], 'manifest': public_record(output, output/analysis['id']/'export-manifest.json')})
        print('COMPLETE', analysis['id'], flush=True)
    verify(plan['frozen_files']); verify(plan['source_files'])
    need(head(ROOT) == plan['source']['commit'] and source_inventory(ROOT) == plan['source_files']
         and runtime() == plan['runtime'], 'Frozen source or native runtime changed during export')
    write(output/'complete.json', {'status': 'coordinate_exports_complete', 'plan_sha256': sha(plan_path),
        'source_commit': plan['source']['commit'], 'analyses': receipts, 'bounds': plan['bounds'],
        'scientific_inference_changed': False, 'new_TM_calls': 0, 'new_selections': 0,
        'public_publication': False, 'automatic_retries': 0})


def final_usage(plan, ancestor, start):
    import resource
    size = 0
    root = Path(plan['output'])
    for path in root.rglob('*') if root.exists() else []:
        need(not path.is_symlink(), 'Unexpected symlink in generated output')
        if path.is_file(): size += path.stat().st_size
    usage = {'elapsed_seconds': time.monotonic()-start, 'output_bytes': size,
        'free_bytes': shutil.disk_usage(ancestor).free,
        'peak_child_rss_bytes': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*1024}
    r = plan['resources']
    over = (usage['elapsed_seconds'] > r['wall_seconds'] or size > r['output_gib']*2**30
        or usage['free_bytes'] < r['reserve_gib']*2**30 or usage['peak_child_rss_bytes'] > r['memory_gib']*2**30)
    return usage, 'Approved final resource bound reached; automatic retry prohibited' if over else None


def controller(plan, plan_path, approval_path):
    import fcntl
    import psutil
    from scripts.run_regional_comparison import monitor, stop_group
    ancestor = Path(plan['output']).parent
    while not ancestor.exists(): ancestor = ancestor.parent
    need(shutil.disk_usage(ancestor).free >= 58*2**30, '8GiB output plus50GiB reserve required')
    with (Path(plan_path).parent/'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        env = {**os.environ, **{key:'8' for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','BLIS_NUM_THREADS','NUMBA_NUM_THREADS']},
            'CASP17_ENSEMBLE_CONTROLLER_PID':str(os.getpid()), 'PYTHONDONTWRITEBYTECODE':'1',
            'QT_QPA_PLATFORM':'offscreen'}
        child = None; start = time.monotonic(); receipt_path = Path(plan_path).parent/'execution-receipt.json'
        try:
            with (Path(plan_path).parent/'execution.log').open('x') as log, (Path(plan_path).parent/'resource-telemetry.jsonl').open('x') as telemetry:
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'run', '--plan', str(plan_path),
                    '--approval-file', str(approval_path), '--worker'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    process = psutil.Process(child.pid); process.cpu_affinity(process.cpu_affinity()[:8])
                    reason, _ = monitor(child, plan, process, psutil, lambda _:shutil.disk_usage(ancestor), telemetry)
                except psutil.NoSuchProcess:
                    reason = None
                code = child.wait()
                usage, final_reason = final_usage(plan, ancestor, start)
                reason = reason or final_reason
                write(receipt_path, {'exit_code':code,'stop_reason':reason,
                    **usage,'plan_sha256':sha(plan_path)})
                if code or reason: raise RuntimeError(reason or 'Coordinate export failed; preserve diagnostics; no automatic retry')
        except BaseException as error:
            if child is not None and child.poll() is None: stop_group(child)
            if not receipt_path.exists():
                write(receipt_path, {'exit_code':None if child is None else child.poll(),
                    'stop_reason':'Controller startup/monitor exception; no automatic retry',
                    'exception_type':type(error).__name__, 'exception':str(error),
                    'elapsed_seconds':time.monotonic()-start,'plan_sha256':sha(plan_path)})
            raise
        finally:
            if child is not None and child.poll() is None: stop_group(child)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    for name in ['inventory', 'metadata', 'output']: prep.add_argument('--'+name, type=Path, required=True)
    run = commands.add_parser('run'); run.add_argument('--plan', type=Path, required=True)
    run.add_argument('--approval-file', type=Path, required=True); run.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.command == 'prepare': print(json.dumps(prepare(args.inventory, args.metadata, args.output), indent=2))
    elif args.worker: worker(args.plan, args.approval_file)
    else: controller(validate(args.plan, args.approval_file), args.plan, args.approval_file)


if __name__ == '__main__': main()
