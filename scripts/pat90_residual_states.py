#!/usr/bin/env python3
"""Explicitly approved, bounded PaT90 geometry-only residual-state pilot."""
from __future__ import annotations

import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.analysis.pa_residual_plan import (
    BOUNDS, FEATURE_COUNT, RESOURCES, SETTINGS, prepare, validate, load_saved_geometry,
    need, read, write, record, verify,
)
from src.analysis.tm_state_geometry import CanonicalCAStore, NativeTMScorer
from src.analysis.tm_state_resources import tree_bytes
from scripts.tm_state_sampling import save, score_pairs


class PairOracle:
    """Read saved symmetric scores; calculate only reserved unknown pairs."""
    def __init__(self, models, scope, saved, scorer):
        self.models = models
        self.scorer = scorer
        self.columns = saved['cached_columns']
        self.grid = saved['candidate_matrix']
        self.candidate_rows = {}
        lookup = {name: i for i, name in enumerate(models)}
        candidate_lookup = {name: j for j, name in enumerate(saved['candidate_names'])}
        for candidate in scope['candidates']:
            j = candidate_lookup[candidate['canonical_model']]
            for i in candidate.get('cohort_indices', [lookup[candidate['canonical_model']]]):
                need(i not in self.candidate_rows, 'Overlapping saved candidate aliases')
                self.candidate_rows[i] = j
        self.memo = {}
        self.events = []
        self.new_pair_records = 0
        self.reused_unique_pairs = 0

    def known(self, i, j):
        key = tuple(sorted((i, j)))
        if key in self.memo:
            return self.memo[key]
        a, b = self.models[i], self.models[j]
        if i == j:
            value = 1.
        elif a in self.columns:
            value = float(self.columns[a][j])
        elif b in self.columns:
            value = float(self.columns[b][i])
        elif i in self.candidate_rows and j in self.candidate_rows:
            value = float(self.grid[self.candidate_rows[i], self.candidate_rows[j]])
        else:
            return None
        self.memo[key] = value
        self.reused_unique_pairs += 1
        return value

    def __call__(self, pairs):
        pairs = list(pairs)
        unknown = {}
        for i, j in pairs:
            need(type(i) is int and type(j) is int and 0 <= i < len(self.models)
                 and 0 <= j < len(self.models), 'Invalid original model index pair')
            key = tuple(sorted((i, j)))
            if self.known(i, j) is None:
                unknown[key] = (self.models[key[0]], self.models[key[1]])
        before = self.scorer.directional_calls
        need(2 * len(unknown) <= BOUNDS['usalign_calls'] - before,
             'Pilot native reservation ceiling exceeded before scoring')
        reverse = {value: key for key, value in unknown.items()}
        for pair, result in score_pairs(self.scorer, reverse, len(reverse)):
            self.memo[reverse[pair]] = float(result['score'])
        self.new_pair_records += len(unknown)
        self.events.append({'requested_pairs': len(pairs), 'new_unique_pair_records': len(unknown),
                            'directional_calls_before': before,
                            'directional_calls_after': self.scorer.directional_calls})
        need(self.scorer.directional_calls <= BOUNDS['usalign_calls'], 'Pilot native ceiling exceeded')
        result = [self.memo[tuple(sorted((i, j)))] for i, j in pairs]
        need(all(0 <= value <= 1 for value in result), 'Invalid native/reused TM score')
        return result


def distance_features(store, models, output):
    """Derive proposal descriptors from the same frozen native CA inputs."""
    import numpy as np
    from Bio.PDB.MMCIF2Dict import MMCIF2Dict
    positions = SETTINGS['canonical_positions']
    coords = np.empty((len(models), len(positions), 3), dtype=np.float64)
    for i, name in enumerate(models):
        row = store.canonical_record(name)
        raw = MMCIF2Dict(row['path'])
        coords[i] = np.column_stack([np.asarray(raw['_atom_site.Cartn_' + axis], dtype=float)
                                    for axis in ('x', 'y', 'z')])
    need(np.isfinite(coords).all(), 'Nonfinite canonical CA coordinates')
    pair_i, pair_j = np.triu_indices(len(positions), 1)
    expected = len(positions) * (len(positions) - 1) // 2
    need(expected == FEATURE_COUNT and len(pair_i) == expected, 'PaT90 feature mask changed')
    destination = output / 'ca-distance-features.npy'
    need(not destination.exists(), 'Feature output must be fresh')
    features = np.lib.format.open_memmap(destination, mode='w+', dtype=np.float32,
                                         shape=(len(models), len(pair_i)))
    for start in range(0, len(models), 256):
        block = coords[start:start + 256]
        features[start:start + len(block)] = np.linalg.norm(block[:, pair_i] - block[:, pair_j], axis=2)
    features.flush()
    need(features.shape == (len(models), expected) and np.isfinite(features).all(),
         'Nonfinite pair-distance proposal features or unexpected feature width')
    save(output / 'feature-provenance.json', {
        'purpose': 'Energy-independent candidate proposal/screen ordering only; TM remains the membership certificate.',
        'models': len(models), 'canonical_positions': positions, 'features': expected,
        'native_CA_precision_decimal_places': 6, 'distance_units': 'angstrom',
        'scaling': 'Unscaled pair distances; squared Euclidean descriptor ranking.',
        'dtype': 'float32', 'record': record(destination), 'new_projection_or_clustering_fits': 0,
    })
    return features


def candidate_groups(cohort):
    groups = {'Primary': {}, 'HDBSCAN': {}, 'method': {}}
    for partition in cohort['partitions']:
        if partition['range_id'] != 'all':
            continue
        family = partition['procedure']
        need(family in ('Primary', 'HDBSCAN'), 'Unexpected PaT90 partition')
        for i, label in enumerate(partition['labels']):
            groups[family].setdefault(str(label), []).append(i)
    for i, method in enumerate(cohort['methods']):
        groups['method'].setdefault(str(method), []).append(i)
    return groups


def audit_pairs(assignment, models):
    """Bounded deterministic selected-pair diagnostics, without an RNG."""
    import itertools
    states = [s for s in assignment['states'] if s['supported']]
    ordered = {s['id']: sorted(s['indices'], key=lambda i: (hashlib.sha256(models[i].encode()).hexdigest(), models[i]))
               for s in states}
    result = []
    for state in states:
        ids = ordered[state['id']]
        selected = set()
        for offset in range(1, len(ids)):
            for j, i in enumerate(ids):
                pair = tuple(sorted((i, ids[(j + offset) % len(ids)])))
                if pair[0] != pair[1]:
                    selected.add(pair)
                if len(selected) == 500:
                    break
            if len(selected) == 500:
                break
        result.extend({'i': i, 'j': j, 'relation': 'within', 'states': [state['id']]} for i, j in sorted(selected))
    for a, b in itertools.combinations(states, 2):
        left, right = ordered[a['id']], ordered[b['id']]
        selected = set()
        for offset in range(len(right)):
            for j, i in enumerate(left):
                selected.add(tuple(sorted((i, right[(j + offset) % len(right)]))))
                if len(selected) == 500:
                    break
            if len(selected) == 500:
                break
        result.extend({'i': i, 'j': j, 'relation': 'between', 'states': [a['id'], b['id']]} for i, j in sorted(selected))
    need(len(result) <= 3000 and len({(r['i'], r['j']) for r in result}) == len(result),
         'Pair audit selection exceeded its bound or duplicated pairs')
    return result


def worker(plan_path, approval_path, expected_sha):
    need(os.environ.get('PA_RESIDUAL_CONTROLLER_PID') == str(os.getppid()), 'Worker requires approved controller')
    plan = validate(ROOT, plan_path, approval_path, expected_sha, output_may_exist=True)
    intent = read(plan_path.parent / 'execution-intent.json')
    need(intent['controller_pid'] == os.getppid() and intent['plan_sha256'] == expected_sha
         and intent['source_commit'] == plan['source']['commit'], 'Controller intent differs')
    from src.analysis.pa_residual_geometry import run_search, DEFAULT_SETTINGS
    from src.analysis.nested_cluster_candidates import canonical_ca_arrays
    import numpy as np
    inputs = read(plan['inputs']['path']); cohort, scope = inputs['cohort'], inputs['scope']
    models = cohort['models']; output = Path(plan['output'])
    need(SETTINGS['search'] == DEFAULT_SETTINGS, 'Frozen search implementation settings differ')
    saved = load_saved_geometry(plan, inputs)
    store = CanonicalCAStore(cohort['members'], SETTINGS['canonical_positions'], scope['sequence_sha256'],
                             output / 'canonical-ca', canonicalizer=canonical_ca_arrays)
    scorer = NativeTMScorer(store, plan['executable']['path'], output / 'native-tm',
                            maximum_directional_calls=BOUNDS['usalign_calls'],
                            timeout=180, executable_sha256=plan['executable']['sha256'])
    oracle = PairOracle(models, scope, saved, scorer)
    features = distance_features(store, models, output)
    lookup = {name: i for i, name in enumerate(models)}
    cached_columns = {lookup[name]: values for name, values in saved['cached_columns'].items()}
    search = run_search(models, features, candidate_groups(cohort),
                        [lookup[name] for name in saved['candidate_names']], cached_columns, oracle,
                        settings=SETTINGS['search'])
    assignment = search['assignment']; anchors = search['anchors']; scores = np.asarray(search['scores'])
    need(len(anchors) <= 3 and scores.shape == (11000, len(anchors)), 'Final state shape changed')
    for state in assignment['states']:
        need(state['supported'] and state['count'] >= 50, 'Unsupported state was retained')
        j = anchors.index(lookup[state['anchor']])
        need(all(scores[i, j] >= .80 for i in state['indices']), 'Final representative membership certificate failed')
    selected = audit_pairs(assignment, models)
    audit_values = oracle([(r['i'], r['j']) for r in selected])
    for row, score in zip(selected, audit_values):
        row['tm_score'] = score
    save(output / 'pair-audit.json', {'selection': 'Deterministic SHA256 model ordering and circular offsets; selected pairs only.',
         'all_pairs_certified': False, 'acceptance_gate': False, 'pairs': selected})
    np.savez_compressed(output / 'scores.npz', anchors=np.asarray([models[i] for i in anchors]), model_to_anchor=scores)
    save(output / 'search.json', search)
    save(output / 'membership.json', assignment)
    save(output / 'pair-query-ledger.json', {'events': oracle.events, 'new_pair_records': oracle.new_pair_records,
         'reused_unique_pairs': oracle.reused_unique_pairs, 'new_directional_calls': scorer.directional_calls})
    methods = sorted(set(cohort['methods']))
    sensitivity = [{'excluded_method': method, 'rediscovery': False,
                    'state_counts': {s['id']: sum(cohort['methods'][i] != method for i in s['indices'])
                                     for s in assignment['states']}}
                   for method in methods]
    save(output / 'fixed-anchor-method-sensitivity.json', sensitivity)
    catalog = {'schema_version': 1, 'kind': 'pat90_residual_geometry_pilot', 'status': 'complete',
         'plan_sha256': expected_sha, 'source_commit': plan['source']['commit'], 'target': 'PaT90_bmr7191',
         'canonical_positions': SETTINGS['canonical_positions'], 'models': models,
         'anchors': [models[i] for i in anchors], 'states': assignment['states'],
         'coverage': {'supported_models': assignment['assigned_models'], 'unassigned_models': assignment['unassigned_models']},
         'stop_reason': search['stop_reason'], 'baseline': search['baseline'],
         'new_directional_calls': scorer.directional_calls, 'pair_audit_pairs': len(selected),
         'no_new_sampling_or_coordinate_exports': True, 'biological_population_claim': False,
         'interpretation': 'Supported representative-relative structural neighborhoods under a finite search. Unresolved models and budget limits remain explicit.'}
    save(output / 'catalog.json', catalog)
    with (output / 'state-summary.csv').open('x') as stream:
        writer = csv.DictWriter(stream, fieldnames=['state', 'representative', 'members', 'minimum_member_TM'])
        writer.writeheader()
        for s in assignment['states']:
            j = anchors.index(lookup[s['anchor']])
            writer.writerow({'state': s['id'], 'representative': s['anchor'], 'members': s['count'],
                             'minimum_member_TM': float(scores[s['indices'], j].min())})
    validate(ROOT, plan_path, approval_path, expected_sha, output_may_exist=True)
    save(output / 'output-manifest.json', {'plan_sha256': expected_sha, 'source_commit': plan['source']['commit'],
         'files': [record(p) for p in sorted(output.rglob('*')) if p.is_file()]})
    save(output / 'worker-completion.json', {'status': 'complete', 'plan_sha256': expected_sha,
         'source_commit': plan['source']['commit'], 'catalog': record(output / 'catalog.json'),
         'output_manifest': record(output / 'output-manifest.json'), 'native_directional_calls': scorer.directional_calls,
         'supported_states': len(anchors), 'publication_authorized': False, 'ui_deployment_authorized': False,
         'new_sampling': False, 'new_coordinate_exports': 0})


def controller(plan_path, approval_path, expected_sha):
    import psutil
    from scripts.run_regional_comparison import stop_group
    started = time.monotonic(); own = psutil.Process(os.getpid())
    own.cpu_affinity(own.cpu_affinity()[:RESOURCES['cpus']])
    plan = validate(ROOT, plan_path, approval_path, expected_sha)
    metadata = plan_path.parent; parent = Path(plan['resource_accounting_root']); child = None
    previous_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    def cancelled(signum, frame):
        raise InterruptedError('Approved PaT90 pilot cancelled by signal ' + str(signum))
    def check_limits(rss, size, free):
        need(rss <= RESOURCES['memory_gib'] * 2**30 and size <= RESOURCES['output_gib'] * 2**30
             and free >= RESOURCES['reserve_gib'] * 2**30
             and time.monotonic() - started <= RESOURCES['wall_seconds'], 'Approved pilot resource limit reached')
    with (metadata / 'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        write(metadata / 'execution-intent.json', {'plan_sha256': expected_sha,
              'source_commit': plan['source']['commit'], 'controller_pid': os.getpid(), 'automatic_retries': False})
        try:
            for sig in previous_handlers:
                signal.signal(sig, cancelled)
            need(shutil.disk_usage(parent).free >= (RESOURCES['reserve_gib'] + RESOURCES['output_gib']) * 2**30,
                 'Insufficient free reserve')
            Path(plan['output']).mkdir()
            env = {**os.environ, **{k: '1' for k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                    'NUMBA_NUM_THREADS', 'BLIS_NUM_THREADS')}, 'PA_RESIDUAL_CONTROLLER_PID': str(os.getpid())}
            with (metadata / 'execution.log').open('x') as log, (metadata / 'telemetry.jsonl').open('x') as telemetry:
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', '--plan', str(plan_path),
                        '--approval', str(approval_path), '--expected-sha', expected_sha], env=env,
                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    proc = psutil.Process(child.pid); proc.cpu_affinity(proc.cpu_affinity()[:RESOURCES['cpus']])
                except psutil.NoSuchProcess:
                    need(child.poll() is not None, 'Worker identity disappeared while still running')
                while child.poll() is None:
                    rss = 0; cpu = 0.
                    try:
                        family = [own, *own.children(recursive=True)]
                    except psutil.NoSuchProcess:
                        family = []
                    for member in family:
                        try:
                            rss += member.memory_info().rss
                            times = member.cpu_times(); cpu += times.user + times.system
                        except psutil.NoSuchProcess:
                            pass
                    size = tree_bytes(parent); free = shutil.disk_usage(parent).free
                    telemetry.write(json.dumps({'elapsed_seconds': time.monotonic() - started,
                        'rss_bytes': rss, 'cpu_seconds': cpu, 'output_bytes': size, 'free_bytes': free}) + '\n')
                    telemetry.flush(); check_limits(rss, size, free); time.sleep(3)
                need(child.wait() == 0, 'Worker failed; no automatic retry')
            completed = read(Path(plan['output']) / 'worker-completion.json')
            verify([completed['catalog'], completed['output_manifest']])
            validate(ROOT, plan_path, approval_path, expected_sha, output_may_exist=True)
            check_limits(own.memory_info().rss, tree_bytes(parent), shutil.disk_usage(parent).free)
            write(metadata / 'execution-receipt.json', {'status': 'complete', 'exit_code': 0,
                'plan_sha256': expected_sha, 'elapsed_seconds': time.monotonic() - started, 'automatic_retry': False})
            write(metadata / 'completion.json', {**completed, 'execution_receipt': record(metadata / 'execution-receipt.json')})
        except BaseException as error:
            if child is not None and child.poll() is None:
                stop_group(child)
            if not (metadata / 'execution-receipt.json').exists():
                write(metadata / 'execution-receipt.json', {'status': 'failed', 'exit_code': None,
                    'plan_sha256': expected_sha, 'error': str(error)[:2048], 'automatic_retry': False,
                    'elapsed_seconds': time.monotonic() - started})
            raise
        finally:
            if child is not None and child.poll() is None:
                stop_group(child)
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    for name in ('parent-plan', 'parent-completion', 'metadata', 'output', 'executable'):
        p.add_argument('--' + name, type=Path, required=True)
    for command in ('run', 'worker'):
        p = sub.add_parser(command)
        for name in ('plan', 'approval'):
            p.add_argument('--' + name, type=Path, required=True)
        p.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        print(json.dumps(prepare(ROOT, args.parent_plan, args.parent_completion,
                                args.metadata, args.output, args.executable), indent=2))
    elif args.command == 'run':
        controller(args.plan.absolute(), args.approval.absolute(), args.expected_sha)
    else:
        worker(args.plan.absolute(), args.approval.absolute(), args.expected_sha)


if __name__ == '__main__':
    main()
