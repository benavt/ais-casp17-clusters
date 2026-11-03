#!/usr/bin/env python3
"""One-shot, exact-approval PaT90 canonical24–91 reclustering/state experiment.

prepare replays existing distance-cache bytes and hashes a column slice only.
run is the sole worker launcher. No historical labels, projections or TM cache
are passed to the new scientific stages. A failed attempt is never resumable.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import fcntl
import hashlib
from importlib.metadata import version
from importlib.util import find_spec
import json
import math
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.analysis.ensemble_sampling_plan import need, read, write, record, verify, sha, git
from src.analysis.tm_state_resources import tree_bytes

TARGET = 'PaT90_bmr7191'
MODEL_COUNT = 11000
SOURCE_FEATURE_COUNT = 84 * 83 // 2
SELECTED_FEATURE_COUNT = 68 * 67 // 2
SEQUENCE = 'MGSSHHHHHHSSGRENLYFQGHLRELLRTNDAVLLSAVGALLDGADIGHLVLDQNMSILEGSLGVIPRRVLVHEDDLAGARRLLTDAGLAHELRSDD'
RAW_FEATURE_SHA256 = '6b16d317c90eacbcf958ed7603bf9c1f6e3298c06ed8c5340f0831905861c8a8'
POSITIONS = list(range(24, 92))
OPERATION = 'Fresh PaT90 canonical24–91 Primary/HDBSCAN, TM0.80 residual states and MCMC50/DISCO50'
RESOURCES = {'cpus': 8, 'memory_gib': 32, 'output_gib': 6, 'wall_seconds': 43200, 'reserve_gib': 45,
             'startup_free_gib': 51}
BOUNDS = {'models': 11000, 'construct_residues': 97, 'clustering_residues': 68, 'feature_columns': 2278,
          'UMAP_fits': 30, 'HDBSCAN_extractions': 48, 'PCA_fits': 2, 'tSNE_fits': 2,
          'internal_component_Ward_hierarchies': 2064, 'bounded_Ward_searches': 0,
          'validation_directional_TM_calls': 9900, 'state_directional_TM_calls': 186800,
          'total_directional_TM_calls': 196700, 'supported_states': 3, 'MH_proposals': 120000,
          'DISCO50_panels': 3, 'PDB_exports': 6, 'PSE_exports': 6, 'coordinate_instances': 300,
          'fine_cluster_representatives': 0, 'new_energy_scores': 0, 'historical_TM_reuse': 0,
          'paid_calls': 0, 'cost_usd': 0, 'automatic_retries': 0, 'package_installs': 0}
SETTINGS = {'target': TARGET, 'canonical_positions': POSITIONS, 'conditioning_t': .1,
            'energy_scope': 'full_construct', 'scoring_residues': 97,
            'fresh_clustering': True, 'old_labels_as_inputs': False, 'old_projections_as_inputs': False,
            'geometry': {'cutoff': .8, 'min_support': 50, 'max_states': 3, 'max_trials': 12,
                         'screen_size': 200, 'max_new_columns': 8, 'feature_count': 2278},
            'sampling': {'alpha': .5, 'tau_iqr_multiplier': 1., 'panel_size': 50, 'chains': 4,
                         'mh_steps': 10000, 'burn': 1000, 'seed': 202611100,
                         'production_chain': 0, 'uniform_mixture': .1},
            'feature_source': 'Original saved raw distograms, historical float16 clustering cast to float32; unscaled canonical column slice.',
            'coverage_stop': False, 'reference_refinement': False, 'bootstrap_cached_columns': 0,
            'initial_candidate_representatives': 0}
EXCLUDED = ['Other targets or masks', 'Historical labels/projections/TM as initial inputs',
            'Fine-cluster medoid or CA-RMSD representative exports', 'New energy scoring',
            'Forced state counts or all-pairs state certification', 'Additional sampling conditions',
            'Bonsai, report figures, UI deployment or publication', 'Git merges or branch distribution',
            'Automatic retries or resource extensions', 'Paid services or package installation']
PACKAGES = ('numpy', 'scipy', 'scikit-learn', 'umap-learn', 'numba', 'llvmlite', 'pynndescent',
            'joblib', 'threadpoolctl', 'biopython', 'pandas', 'plotly', 'psutil')
THREAD_ENV = {k: '8' for k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                              'NUMBA_NUM_THREADS', 'BLIS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS')}


def physical(path):
    p = Path(path).absolute()
    need('..' not in p.parts and not any(x.is_symlink() for x in [p, *p.parents]), 'Symlink or dotdot path forbidden')
    return p.resolve(strict=False)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def source_snapshot(root):
    root = physical(root)
    dirty = git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'src', 'scripts', 'config', 'tests', 'docs')
    need(not dirty, 'Commit and review source before freezing: ' + str(root))
    names = git(root, 'ls-files', 'src', 'scripts', 'config', 'pyproject.toml', 'project_support.py').splitlines()
    files = [record(physical(root/name)) for name in names if Path(name).suffix in ('.py', '.json')]
    return {'worktree': str(root), 'commit': git(root, 'rev-parse', 'HEAD'),
            'branch': git(root, 'branch', '--show-current'), 'files': files}


def runtime(usalign):
    executable = physical(usalign)
    spec = find_spec('pymol')
    need(spec is not None and spec.submodule_search_locations, 'Installed native PyMOL is required')
    native = list(Path(next(iter(spec.submodule_search_locations))).glob('_cmd*.so'))
    need(len(native) == 1, 'Exactly one installed PyMOL native runtime required')
    python = Path(sys.executable).resolve()
    return {'host': os.uname().nodename, 'python': str(python), 'python_sha256': sha(python),
            'python_version': sys.version, 'versions': {p: version(p) for p in PACKAGES},
            'usalign': str(executable), 'usalign_sha256': sha(executable), 'pymol_native': record(native[0]),
            'pymol_version': version('pymol'),
            'pymol_wrappers': [record(find_spec(name).origin) for name in ('pymol', 'pymol2')]}


def frozen_records(value):
    """Find saved metadata records, never infer that a cache/output is an input."""
    rows = []
    if isinstance(value, dict):
        if 'path' in value and 'sha256' in value:
            r = record(physical(value['path']))
            need(r['sha256'] == value['sha256'] and ('bytes' not in value or r['bytes'] == value['bytes']),
                 'Saved producer input hash changed')
            rows.append(r)
        for child in value.values():
            rows.extend(frozen_records(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(frozen_records(child))
    return rows


def protected_run_roots(records):
    roots = set()
    for row in records:
        path = physical(row['path'])
        roots.add(path.parent)
        for parent in path.parents:
            if re.match(r'^\d{4}-\d{2}-\d{2}_', parent.name) or parent.name == 'delivery':
                roots.add(parent)
            if re.fullmatch(r'(?:approval|run)[-_]\d+', parent.name):
                roots.add(parent.parent)
    return sorted(roots)


def destinations(metadata, output, protected):
    metadata, output = physical(metadata), physical(output)
    need(metadata.parent == output.parent and metadata != output and metadata.parent.is_dir(),
         'New metadata and output must be distinct siblings under an existing artifact root')
    need(not metadata.exists() and not output.exists(), 'Immutable fresh destinations required')
    protected = [physical(p) for p in protected] + [ROOT/'src', ROOT/'scripts', ROOT/'config', ROOT/'tests', ROOT/'docs']
    for dest in (metadata, output):
        for p in protected:
            need(not dest.is_relative_to(p) and not p.is_relative_to(dest), 'Destination overlaps frozen source/input')
    return metadata, output


def raw_features(parent, names, check=lambda: None):
    from scripts.casp17_hdbscan import materialize
    import numpy as np
    array = materialize(deepcopy(parent), names, check)
    need(array.dtype == np.float32 and array.shape == (MODEL_COUNT, SOURCE_FEATURE_COUNT) and np.isfinite(array).all(),
         'Original cached PaT90 features have wrong finite float32 geometry')
    need(hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest() == RAW_FEATURE_SHA256,
         'Original float16-cache/cast feature bytes differ; proposal-coordinate features are forbidden')
    return array


def selected_features(parent, names, mask, check=lambda: None):
    import numpy as np
    source = raw_features(parent, names, check)
    selected = np.ascontiguousarray(source[:, mask['feature_columns']], dtype=np.float32)
    need(selected.shape == (MODEL_COUNT, SELECTED_FEATURE_COUNT), 'Selected canonical24–91 feature shape differs')
    return selected, hashlib.sha256(selected.tobytes()).hexdigest()


def build_inputs(inputs_path, feature_provenance, old_plan_path, workflow_path, adapter_path):
    """Read identities and original cache bytes, with no fit/RNG/scoring/export."""
    from src.analysis.residue_range_plan import plan_residue_range
    saved, old_plan, workflow, adapter = map(read, [inputs_path, old_plan_path, workflow_path, adapter_path])
    cohort = deepcopy(saved['cohort'])
    cohort.pop('partitions', None)
    names = cohort['models']
    need(cohort['target'] == TARGET and len(names) == len(set(names)) == 11000
         and [m['model'] for m in cohort['members']] == names and len(cohort['methods']) == 11000
         and len(set(cohort['methods'])) == 11 and set(Counter(cohort['methods']).values()) == {1000}, 'Frozen PaT90 cohort differs')
    need(cohort['conditioning_t'] == .1 and cohort['metric_key'] == 'protein_ebm_energy_t10'
         and cohort['energy_scope'] == 'full_construct' and cohort['scoring_residues'] == 97
         and len(cohort['energies']) == 11000 and all(type(v) in (int, float) and math.isfinite(v) for v in cohort['energies']),
         'Saved full97 t0.10 energies required')
    sequence = ''.join(row[0] for row in workflow['terminal_detection']['residue_labels'])
    need(sequence == SEQUENCE and cohort['sequence_sha256'] == hashlib.sha256(sequence.encode()).hexdigest(), 'PaT90 full97 sequence differs')
    positions = workflow['terminal_detection']['retained_reference_positions']
    need(positions == list(range(7, 91)), 'Original source cache must retain canonical8–91')
    target_rows = [t for t in old_plan['targets'] if t['target'] == TARGET]
    need(len(target_rows) == 1, 'One old PaT90 clustering proof required')
    old = target_rows[0]
    need(physical(old['parent_manifest']) == physical(workflow_path) and old['models'] == names
         and old['feature_proof']['feature_array_sha256'] == RAW_FEATURE_SHA256
         and old['feature_proof']['shape'] == [MODEL_COUNT, SOURCE_FEATURE_COUNT] and old['feature_proof']['dtype'] == 'float32'
         and old['retained_reference_positions'] == positions, 'Original clustering feature/order/mask proof differs')
    primary = [v for v in saved['scope']['source_views'] if v['procedure'] == 'Primary']
    need(len(primary) == 1, 'One saved Primary confidence source required')
    data = read(primary[0]['data']['path'])
    need(data['target'] == TARGET and data['models'] == names, 'Saved confidence model order differs')
    schemes = [s for s in data['schemes'] if s['key'] == 'mean_plddt']
    need(len(schemes) == 1 and len(schemes[0]['values']) == 11000, 'Saved meanPLDDT confidence required')
    scores = schemes[0]['values']
    need(all(v is None or type(v) in (int, float) and math.isfinite(v) for v in scores), 'Nonfinite confidence')
    mask = plan_residue_range(sequence, positions, [[24, 91]])
    rows = [record(p) for p in [inputs_path, feature_provenance, old_plan_path, workflow_path, adapter_path]]
    rows += frozen_records(saved)
    for member in cohort['members']:
        row = record(physical(member['source_path'])); need(row['sha256'] == member['sha256'], 'Original source coordinate changed'); rows.append(row)
    cache = physical(workflow['distogram_dir']); need(cache.is_dir(), 'Saved original distance cache missing')
    for p in sorted(cache.rglob('*')):
        need(not p.is_symlink(), 'Symlink in original frozen distance cache')
        if p.is_file(): rows.append(record(p))
    need(len([r for r in rows if Path(r['path']).parent == cache]) >= 11000, 'Incomplete saved raw distance cache')
    selected, selected_sha = selected_features(workflow, names, mask)
    del selected
    rows = sorted({r['path']: r for r in rows}.values(), key=lambda r: r['path'])
    return {'cohort': cohort, 'workflow': workflow, 'mask': mask, 'scores': scores,
            'source_feature_proof': deepcopy(old['feature_proof']), 'selected_feature_array_sha256': selected_sha,
            'comparison_only_feature_provenance': record(feature_provenance),
            'comparison_features_used': False}, rows, adapter


def prepare(args):
    need(sys.flags.optimize == 0, 'Unoptimized Python required')
    os.environ.update(THREAD_ENV)
    import psutil
    own = psutil.Process(); own.cpu_affinity(own.cpu_affinity()[:8])
    values, records, adapter = build_inputs(args.inputs, args.feature_provenance, args.old_clustering_plan,
                                          args.workflow_manifest, args.selected_adapter_plan)
    sources = {k: deepcopy(adapter['native_sources'][k]) for k in ('density', 'ward')}
    snapshots = [source_snapshot(ROOT)] + [source_snapshot(v['worktree']) for v in sources.values()]
    for key, snapshot in zip(('density', 'ward'), snapshots[1:]):
        need(sources[key]['commit'] == snapshot['commit'], 'Frozen native adapter head changed')
    metadata, output = destinations(args.metadata_output, args.output,
        protected_run_roots(records) + [Path(s['worktree']) for s in snapshots[1:]])
    rt = runtime(adapter['runtime']['usalign'])
    need(rt['usalign_sha256'] == adapter['runtime']['usalign_sha256'], 'Frozen native USalign binary changed')
    plan = {'schema_version': 1, 'operation': OPERATION, 'source': snapshots[0], 'native_source_snapshots': snapshots[1:],
            'native_sources': sources, 'frozen_files': records, 'runtime': rt, 'settings': deepcopy(SETTINGS),
            'resources': deepcopy(RESOURCES), 'bounds': deepcopy(BOUNDS), 'excluded': list(EXCLUDED),
            'metadata': str(metadata), 'output': str(output), 'resource_root': str(metadata.parent),
            'target': TARGET, 'canonical_positions': POSITIONS, 'sequence_sha256': values['cohort']['sequence_sha256'],
            'projection_spec': deepcopy(adapter['projection_spec']), 'component_settings': deepcopy(adapter['component_settings']),
            'scores': values['scores'], 'expected_selected_feature_array_sha256': values['selected_feature_array_sha256'],
            'scientific_execution': False, 'publication_authorized': False, 'ui_deployment_authorized': False,
            'adapter_lineage': {'clustering': 'bee233ea98ac80c24967550d1d452c58f86a2ae2',
                                'state_geometry': '3aa3010ada87575824d9873d2795596905086423'}}
    # No scientific output is persisted during preparation.
    metadata.mkdir()
    write(metadata/'inputs.json', values)
    plan['inputs'] = record(metadata/'inputs.json')
    write(metadata/'execution-plan.json', plan)
    return plan


def approval(plan_path, approval_path, expected_sha):
    need(sys.flags.optimize == 0 and sha(plan_path) == expected_sha, 'Exact plan SHA/unoptimized Python required')
    plan, approved = read(plan_path), read(approval_path)
    need(approved.get('status') == 'approved' and bool(approved.get('user_message'))
         and approved.get('approved_plan_sha256') == expected_sha
         and approved.get('approved_source_commit') == plan['source']['commit'], 'Fresh exact user approval required')
    need(plan.get('operation') == OPERATION and plan.get('schema_version') == 1
         and plan.get('settings') == SETTINGS and plan.get('resources') == RESOURCES
         and plan.get('bounds') == BOUNDS and plan.get('excluded') == EXCLUDED
         and plan.get('target') == TARGET and plan.get('canonical_positions') == POSITIONS
         and plan.get('scientific_execution') is False
         and physical(plan['source']['worktree']) == ROOT
         and plan.get('publication_authorized') is False and plan.get('ui_deployment_authorized') is False,
         'Approved settings/resources/exclusions differ')
    need(physical(plan['metadata']) == physical(plan_path).parent
         and physical(plan['resource_root']) == physical(plan['metadata']).parent
         and physical(plan['output']).parent == physical(plan['resource_root']), 'Accounting root/plan destination differs')
    return plan


def validate(plan_path, approval_path, expected_sha, *, output_may_exist=False):
    plan = approval(plan_path, approval_path, expected_sha)
    need(source_snapshot(ROOT) == plan['source'], 'Current source differs from approved source')
    for pinned in plan['native_source_snapshots']:
        need(source_snapshot(pinned['worktree']) == pinned, 'Frozen native source changed')
    need(runtime(plan['runtime']['usalign']) == plan['runtime'], 'Pinned native/Python runtime changed')
    verify(plan['frozen_files'] + [plan['inputs']])
    need(output_may_exist or not physical(plan['output']).exists(), 'Output already exists; no retry or resume')
    return plan


def check_limits(plan, started, rss, size, free):
    r = plan['resources']
    need(time.monotonic()-started <= r['wall_seconds'], 'Wall limit exceeded')
    need(rss <= r['memory_gib']*2**30, 'Aggregate memory limit exceeded')
    need(size <= r['output_gib']*2**30, 'All task artifacts exceed output limit')
    need(free >= r['reserve_gib']*2**30, 'Free disk reserve violated')


def stop_group(child):
    from scripts.run_regional_comparison import stop_group as stop
    stop(child)


def family_resources(own, psutil):
    rss, cpu = 0, 0.
    for p in [own, *own.children(recursive=True)]:
        try:
            rss += p.memory_info().rss; times = p.cpu_times(); cpu += times.user+times.system
        except psutil.NoSuchProcess:
            continue
    return rss, cpu


def run(plan_path, approval_path, expected_sha):
    import psutil
    plan = approval(plan_path, approval_path, expected_sha)
    metadata, output, root = map(physical, [plan['metadata'], plan['output'], plan['resource_root']])
    child, started = None, time.monotonic()
    handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    def cancelled(sig, frame): raise InterruptedError('Controller cancelled by signal ' + str(sig))
    with (metadata/'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        write(metadata/'execution-intent.json', {'plan_sha256': expected_sha, 'source_commit': plan['source']['commit'],
              'controller_pid': os.getpid(), 'automatic_retry': False})
        try:
            for sig in handlers: signal.signal(sig, cancelled)
            validate(plan_path, approval_path, expected_sha)
            own = psutil.Process(); own.cpu_affinity(own.cpu_affinity()[:RESOURCES['cpus']])
            need(shutil.disk_usage(root).free >= RESOURCES['startup_free_gib']*2**30, 'Startup requires51GiB free (proposed45GiB reserve plus6GiB output)')
            check_limits(plan, started, own.memory_info().rss, tree_bytes(root), shutil.disk_usage(root).free)
            output.mkdir()
            env = {**os.environ, **THREAD_ENV, 'PYTHONDONTWRITEBYTECODE': '1',
                   'PAT90_TRIMMED_CONTROLLER_PID': str(os.getpid())}
            with (metadata/'execution.log').open('x') as log, (metadata/'telemetry.jsonl').open('x') as telemetry:
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', '--plan', str(plan_path),
                    '--approval', str(approval_path), '--expected-sha', expected_sha], env=env, start_new_session=True,
                    stdout=log, stderr=subprocess.STDOUT)
                try:
                    proc = psutil.Process(child.pid); proc.cpu_affinity(proc.cpu_affinity()[:RESOURCES['cpus']])
                except psutil.NoSuchProcess:
                    need(child.poll() is not None, 'Early worker disappeared while still running')
                while child.poll() is None:
                    rss, cpu = family_resources(own, psutil)
                    size, free = tree_bytes(root), shutil.disk_usage(root).free
                    telemetry.write(json.dumps({'elapsed_seconds': time.monotonic()-started, 'rss_bytes': rss,
                        'cpu_seconds': cpu, 'output_bytes': size, 'free_bytes': free})+'\n'); telemetry.flush()
                    check_limits(plan, started, rss, size, free); time.sleep(3)
                need(child.wait() == 0, 'Worker failed; no automatic retry')
            completed = read(output/'worker-completion.json')
            need(completed.get('status') == 'complete' and completed.get('plan_sha256') == expected_sha
                 and completed.get('source_commit') == plan['source']['commit'], 'Worker completion binding differs')
            verify([completed['catalog'], completed['output_manifest']])
            validate(plan_path, approval_path, expected_sha, output_may_exist=True)
            rss, _ = family_resources(own, psutil)
            check_limits(plan, started, rss, tree_bytes(root), shutil.disk_usage(root).free)
            write(metadata/'execution-receipt.json', {'status': 'complete', 'exit_code': 0, 'plan_sha256': expected_sha,
                'source_commit': plan['source']['commit'], 'elapsed_seconds': time.monotonic()-started, 'automatic_retry': False})
            write(metadata/'completion.json', {**completed, 'execution_receipt': record(metadata/'execution-receipt.json')})
        except BaseException as error:
            cleanup_error = None
            if child is not None:
                try: stop_group(child)
                except BaseException as stop_error: cleanup_error = str(stop_error)[:1024]
            if not (metadata/'execution-receipt.json').exists():
                write(metadata/'execution-receipt.json', {'status': 'failed', 'exit_code': child.poll() if child else None,
                    'plan_sha256': expected_sha, 'source_commit': plan['source']['commit'], 'error': str(error)[:2048],
                    'elapsed_seconds': time.monotonic()-started, 'automatic_retry': False, 'cleanup_error': cleanup_error})
            raise
        finally:
            if child is not None and child.poll() is None: stop_group(child)
            for sig, handler in handlers.items(): signal.signal(sig, handler)


def worker(plan_path, approval_path, expected_sha):
    need(os.environ.get('PAT90_TRIMMED_CONTROLLER_PID') == str(os.getppid()), 'Worker requires its owning controller')
    plan = validate(plan_path, approval_path, expected_sha, output_may_exist=True)
    intent = read(Path(plan['metadata'])/'execution-intent.json')
    need(intent['controller_pid'] == os.getppid() and intent['plan_sha256'] == expected_sha
         and intent['source_commit'] == plan['source']['commit'], 'Active exact controller intent required')
    output = physical(plan['output'])
    need(output.is_dir() and not any(output.iterdir()), 'Fresh empty controller-created output required')
    scratch = output/'scratch'; scratch.mkdir()
    for name in ('TMPDIR', 'NUMBA_CACHE_DIR', 'JOBLIB_TEMP_FOLDER', 'MPLCONFIGDIR'):
        p = scratch/name.lower(); p.mkdir(); os.environ[name] = str(p)
    os.environ.update(THREAD_ENV)
    # All numerical/scientific imports happen after temp/thread containment.
    import tempfile
    tempfile.tempdir = os.environ['TMPDIR']
    import numpy as np
    import psutil
    own = psutil.Process(); own.cpu_affinity(own.cpu_affinity()[:8])
    values = read(plan['inputs']['path']); cohort = values['cohort']; names = cohort['models']
    def check():
        need(os.getppid() == intent['controller_pid'], 'Owning controller disappeared')
    features, selected_sha = selected_features(values['workflow'], names, values['mask'], check)
    need(selected_sha == plan['expected_selected_feature_array_sha256'], 'Selected original feature hash changed')
    np.save(output/'selected-features.npy', features, allow_pickle=False)
    write(output/'feature-proof.json', {'source': values['source_feature_proof'], 'mask': values['mask'],
          'selected_array_sha256': selected_sha, 'file': record(output/'selected-features.npy'),
          'proposal_coordinate_features_used': False})
    from src.analysis.pat90_recluster import run_reclustering
    from src.analysis.pat90_trimmed_states import run_states_and_sampling
    from src.analysis.pat90_state_exports import export_panel
    clustering = run_reclustering(features, names, cohort, output/'clustering', plan, check)
    result = run_states_and_sampling(features, names, cohort, clustering, output/'states', plan, check,
                                    adapters={'export_panel': export_panel})
    need(clustering['summary']['maximum_directional_TM_calls'] <= BOUNDS['validation_directional_TM_calls']
         and result['summary']['native_directional_calls'] <= BOUNDS['state_directional_TM_calls'], 'Aggregate native bound differs')
    validate(plan_path, approval_path, expected_sha, output_may_exist=True)
    files = [record(p) for p in sorted(output.rglob('*')) if p.is_file()]
    write(output/'output-manifest.json', {'schema_version': 1, 'plan_sha256': expected_sha,
          'source_commit': plan['source']['commit'], 'files': files})
    write(output/'worker-completion.json', {'status': 'complete', 'plan_sha256': expected_sha,
          'source_commit': plan['source']['commit'], 'catalog': record(output/'states/catalog.json'),
          'output_manifest': record(output/'output-manifest.json'), 'supported_states': result['summary']['supported_states'],
          'validation_directional_TM_calls': clustering['partition_validation']['USalign_calls'],
          'state_directional_TM_calls': result['summary']['native_directional_calls'],
          'total_directional_TM_calls': clustering['partition_validation']['USalign_calls'] + result['summary']['native_directional_calls'],
          'publication_authorized': False, 'ui_deployment_authorized': False})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    for flag in ('inputs', 'feature-provenance', 'old-clustering-plan', 'workflow-manifest', 'selected-adapter-plan', 'metadata-output', 'output'):
        prep.add_argument('--'+flag, type=Path, required=True)
    for command in ('run', 'worker'):
        p = sub.add_parser(command)
        p.add_argument('--plan', type=Path, required=True); p.add_argument('--approval', type=Path, required=True)
        p.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args)
    elif args.command == 'run': run(args.plan, args.approval, args.expected_sha)
    else: worker(args.plan, args.approval, args.expected_sha)


if __name__ == '__main__':
    main()
