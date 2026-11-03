#!/usr/bin/env python3
"""Six independent saved-clustering TM0.80 searches; exact-approval batch only.

Preparation replays saved float16 distance bytes and hashes slices. It performs
no fit, TM scoring, RNG draw or coordinate export. All cases execute sequentially
inside one owned worker; any failure ends the immutable, nonresumable attempt.
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

OPERATION = 'Four-target saved-clustering TM0.80 residual states and HDB-prior MCMC50/DISCO50'
INVENTORY_SHA256 = '0c503f09d75582436bfed884c8b268b3eaab41ebf05ab4477b6cec5e0fdccf55'
PRODUCER_COMMIT = '4ce56b6b313b8403f7b589d53e323a4a8e5b85fd'
MODEL_COUNT = 11000
SPECS = {'BhR2_bmr6717': (107, [7,84]), 'CmR116_bmr17022': (131, [1,86]),
         'StR82_bmr15386': (77, [22,54]), 'SR215_bmr6366': (139, [15,72])}
MASKS = {(t,'all'):list(range(1,s[0]+1)) for t,s in SPECS.items()}
MASKS['SR215_bmr6366','res5-95'] = list(range(5,96))
MASKS['SR215_bmr6366','res32-47-plus78-99'] = list(range(32,48))+list(range(78,100))
CASE_ORDER = (('SR215_bmr6366','all'),('SR215_bmr6366','res5-95'),
              ('SR215_bmr6366','res32-47-plus78-99'),('CmR116_bmr17022','all'),
              ('StR82_bmr15386','all'),('BhR2_bmr6717','all'))
RESOURCES = {'cpus':8,'memory_gib':32,'wall_seconds':43200,'output_gib':6,'reserve_gib':40,'startup_free_gib':46}
BOUNDS = {'targets':4,'contexts':6,'models_per_target':11000,'native_directional_calls_per_case':186800,
          'total_native_directional_calls':1120800,'supported_states_per_case':3,'supported_state_bindings':18,
          'MH_proposals':720000,'DISCO50_panels':18,'PDB_exports':36,'PSE_exports':36,'coordinate_instances':1800,
          'clustering_fits':0,'projection_fits':0,'landmark_TM_calls':0,'historical_TM_columns':0,
          'paid_calls':0,'cost_usd':0,'package_installs':0,'automatic_retries':0}
SETTINGS = {'conditioning_t':.1,'energy_scope':'full_construct','reuse_saved_fine_labels':True,
            'reuse_saved_projections':True,'geometry_feature_scope':'effective_TM_core',
            'independent_search_per_saved_range':True,'baseline_columns':0,'candidate_representatives':0,
            'geometry':{'cutoff':.8,'min_support':50,'max_states':3,'max_trials':12,'screen_size':200,'max_new_columns':8},
            'prior':'Original HDBSCAN fine labels, full target-cohort cluster sizes and global noise mass; condition on certified state.',
            'Primary_labels':'Candidate proposal strata and reporting only; no second sampling prior.',
            'sampling':{'alpha':.5,'tau_iqr_multiplier':1.,'panel_size':50,'chains':4,'mh_steps':10000,
                        'burn':1000,'production_chain':0,'uniform_mixture':.1},
            'seed_base':202611300,'case_seed_stride':100000,'coverage_stop':False,'anchor_refinement':False,
            'short_core_threshold':30,'sampling_law':'Product-weight distinct50 subset; exploratory fixed-budget MH and DISCO50 control.'}
EXCLUDED = ['PaT90 or other targets/masks','New clustering/projection/landmark fits or scores',
            'Historical/shared TM columns or anchors as baseline','New energy scoring','Forced state counts or all-pairs certification',
            'Additional sampling conditions or priors','Fine-cluster representative exports','Bonsai/report figures',
            'GPU jobs, paid services or package installation','Automatic retry, resumption or resource extensions',
            'Cleanup of original inputs/results','UI deployment or public publication','Git merges or branch distribution']
PARENT_COMMIT = '53145b5c16ee6549934a313bdf075e8c2c842319'
PARENT_PLAN_SHA = 'ac8ce14209e10571075ac770fd1cfc8f603d9cafc88e8e5426a0778016038b2b'
FAILED_RECOVERY_COMMIT = '3cc9090f6083582df476282af78c4148a3160420'
FAILED_RECOVERY_PLAN_SHA = 'eaf3591e09121cb96fb215183485035abb30d1c485e45e0aad73e0e1f926479e'
PACKAGES = ('numpy','scipy','psutil','biopython')
THREAD_ENV = {k:'8' for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS','BLIS_NUM_THREADS','VECLIB_MAXIMUM_THREADS')}


def physical(path):
    p = Path(path).absolute()
    need('..' not in p.parts and not any(x.is_symlink() for x in [p, *p.parents]), 'Symlink or dotdot path forbidden')
    return p.resolve(strict=False)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


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


def protected_run_roots(records, planner_owned_files=()):
    roots = set()
    owned = {physical(p) for p in planner_owned_files}
    for row in records:
        path = physical(row['path'])
        if path in owned:
            roots.add(path)
            continue
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



def replay_source(workflow, names, source, check=lambda: None):
    """Replay original float16 cache/reference order; never compute CA distances."""
    import numpy as np
    from scripts.casp17_hdbscan import materialize
    values = materialize(deepcopy(workflow), names, check)
    need(values.dtype == np.float32 and list(values.shape) == source['source_feature_shape']
         and np.isfinite(values).all(), 'Saved raw feature geometry differs')
    actual = hashlib.sha256(np.ascontiguousarray(values).tobytes()).hexdigest()
    need(actual == source['saved_expected_raw_float32_array_sha256'], 'Original saved raw feature hash differs')
    return values


def extract_case(raw, case):
    import numpy as np
    clustered = np.ascontiguousarray(raw[:,case['clustering_mask']['feature_columns']], dtype=np.float32)
    need(hashlib.sha256(clustered.tobytes()).hexdigest() == case['clustering_feature_sha256'],
         'Saved clustering-mask feature bytes differ')
    del clustered
    core = np.ascontiguousarray(raw[:,case['tm_mask']['feature_columns']], dtype=np.float32)
    need(list(core.shape) == [MODEL_COUNT,len(case['tm_positions'])*(len(case['tm_positions'])-1)//2], 'TM-core feature shape differs')
    return core, hashlib.sha256(core.tobytes()).hexdigest()


def check_inventory(inventory_path):
    need(sha(inventory_path) == INVENTORY_SHA256, 'Use the exact independently verified input inventory')
    inv = read(inventory_path)
    need(inv['status'] == 'PASS_SAVED_INPUTS_AND_FEATURE_LINEAGE_INVENTORY'
         and inv['counts'] == {'targets':4,'saved_clustering_masks':6,'fine_views':12,'unique_TM_cores':5,
                              'models_per_target':11000,'source_cache_binary_files':44000,'source_cache_file_records':44012},
         'Verified inventory status/counts differ')
    need({(c['target'],c['range_id']) for c in inv['analysis_contexts']} == set(MASKS)
         and len(inv['analysis_contexts']) == len(MASKS), 'Exactly six saved contexts required')
    return inv


def build_inputs(inventory_path):
    from src.analysis.residue_range_plan import plan_residue_range
    from src.analysis.residual_state_sampling import CASE_ORDER as stage_order
    need(CASE_ORDER==stage_order,'Driver/stage case seed order differs')
    inv = check_inventory(inventory_path)
    verify([inv['source_inputs'],inv['original_distance_cache_inventory'],*inv['source_plans']])
    cache_rows = read(inv['original_distance_cache_inventory']['path'])['files']
    need(len(cache_rows)==44012 and len({r['path']for r in cache_rows})==44012, 'Exact original cache inventory required')
    verify(cache_rows)
    saved = read(inv['source_inputs']['path'])
    rows = [record(inventory_path),*cache_rows,inv['source_inputs'],inv['original_distance_cache_inventory'],*inv['source_plans']]
    cohorts, sources, cases, clustering = {}, {}, [], {}
    for ordinal, context in enumerate(sorted(inv['analysis_contexts'],key=lambda c:CASE_ORDER.index((c['target'],c['range_id'])))):
        target, rid = context['target'], context['range_id']
        positions, (construct, window) = MASKS[target,rid], SPECS[target]
        tm = [p for p in positions if window[0] <= p <= window[1]]
        need(context['clustering_canonical_positions']==positions and context['TM_canonical_positions']==tm
             and context['TM_residues']==len(tm) and context['short_TM_core']==(len(tm)<30), 'Saved clustering/TM intersection differs')
        if target not in cohorts:
            c = deepcopy(saved['cohorts'][target]); c.pop('partitions',None)
            names = c['models']
            need(c['target']==target and len(names)==len(set(names))==MODEL_COUNT
                 and [m['model']for m in c['members']]==names and len(c['methods'])==MODEL_COUNT
                 and digest(names)==c['model_order_sha256']==context['model_order_sha256'], 'Exact ordered target cohort differs')
            need(len(set(c['methods']))==11 and set(Counter(c['methods']).values())=={1000}, 'Eleven1000-model methods required')
            need(c['scoring_residues']==construct and c['energy_scope']=='full_construct'
                 and c['conditioning_t']==.1 and c['metric_key']=='protein_ebm_energy_t10'
                 and len(c['energies'])==MODEL_COUNT and all(type(e)in(int,float)and math.isfinite(e)for e in c['energies']),
                 'Saved full-construct t0.10 energies differ')
            need(digest(c['members'])==context['ordered_members_identity_sha256'], 'Ordered coordinate identity inventory differs')
            for m in c['members']:
                r=record(physical(m['source_path']));need(r['sha256']==m['sha256'],'Saved coordinate source changed');rows.append(r)
            source = context['feature_source']; verify([source['workflow_manifest'],source['distogram_manifest']])
            workflow = read(source['workflow_manifest']['path'])
            sequence = ''.join(r[0]for r in workflow['terminal_detection']['residue_labels'])
            need(len(sequence)==construct and hashlib.sha256(sequence.encode()).hexdigest()==c['sequence_sha256']==context['sequence_sha256'], 'Construct sequence differs')
            source_positions = workflow['terminal_detection']['retained_reference_positions']
            need(source_positions == [p-1 for p in source['source_positions']] and physical(workflow['distogram_dir'])==physical(source['distogram_directory']), 'Original saved raw mask/path differs')
            folders = {physical(workflow['distogram_dir'])}
            expected = {r['path']for r in cache_rows if physical(r['path']).parent in folders}
            present = set()
            for folder in folders:
                for p in folder.iterdir():
                    need(not p.is_symlink(), 'Symlink in original cache')
                    if p.is_file():present.add(str(physical(p)))
            need(present==expected, 'Original cache file inventory changed')
            rows.extend([source['workflow_manifest'],source['distogram_manifest']])
            sources[target]={'workflow':workflow,'feature_source':source,'sequence':sequence}
            cohorts[target]=c
        c,s = cohorts[target],sources[target]
        need(context['feature_source']==s['feature_source'], 'One target must use one exact original feature source')
        sequence=s['sequence'];source_positions=s['workflow']['terminal_detection']['retained_reference_positions']
        ranges=[]
        for p in positions:
            if not ranges or p!=ranges[-1][1]+1:ranges.append([p,p])
            else:ranges[-1][1]=p
        tm_ranges=[]
        for p in tm:
            if not tm_ranges or p!=tm_ranges[-1][1]+1:tm_ranges.append([p,p])
            else:tm_ranges[-1][1]=p
        caseid=target.lower()+'--'+rid
        case={'id':caseid,'target':target,'range_id':rid,'clustering_positions':positions,'tm_positions':tm,
              'sequence_sha256':c['sequence_sha256'],'construct_residues':construct,'short_core':len(tm)<30,
              'clustering_feature_sha256':context['saved_expected_selected_float32_array_sha256'],
              'clustering_mask':plan_residue_range(sequence,source_positions,ranges),
              'tm_mask':plan_residue_range(sequence,source_positions,tm_ranges),
              'seed':SETTINGS['seed_base']+ordinal*SETTINGS['case_seed_stride']}
        parts={};identities={}
        for view in context['views']:
            verify([view['source_data']]); data=read(view['source_data']['path']); rows.append(view['source_data'])
            part=next(p for p in saved['cohorts'][target]['partitions']if p['range_id']==rid and p['procedure']==view['procedure'])
            need(data['target']==target and data['models']==c['models'] and data['methods']==c['methods']
                 and data['clusters']==part['labels'] and digest(data['clusters'])==view['labels_sha256']
                 and digest(data['projections'])==view['projections_sha256']
                 and part['canonical_positions']==positions and part['source_data_sha256']==view['source_data']['sha256'],
                 'Saved fine labels/projections/order/scope changed')
            need(isinstance(part['noise_labels'],list)and set(part['noise_labels'])<=set(part['labels']), 'Explicit saved noise labels required')
            parts[view['procedure']]=part
            identities[view['procedure']]={'data':view['source_data'],'raw_view_id':view['raw_view_id'],
                'labels_sha256':view['labels_sha256'],'projections_sha256':view['projections_sha256']}
        need(set(parts)=={'Primary','HDBSCAN'}, 'Two saved procedures required')
        clustering[caseid]={'primary_labels':parts['Primary']['labels'],'hdbscan_labels':parts['HDBSCAN']['labels'],
                            'hdbscan_noise_labels':parts['HDBSCAN']['noise_labels'],'saved_source_views':identities,
                            'historical_projections_reused_unchanged':True,'new_clustering_fits':0}
        cases.append(case)
    for target,source in sources.items():
        raw=replay_source(source['workflow'],cohorts[target]['models'],source['feature_source'])
        for case in cases:
            if case['target']==target:
                selected,h=extract_case(raw,case);del selected;case['feature_sha256']=h
        del raw
    rows=sorted({r['path']:r for r in rows}.values(),key=lambda r:r['path'])
    return {'schema_version':1,'cohorts':cohorts,'sources':sources,'cases':cases,'clustering':clustering}, rows


def prepare(args):
    need(sys.flags.optimize==0,'Unoptimized Python required')
    os.environ.update(THREAD_ENV)
    import psutil
    own=psutil.Process();own.cpu_affinity(own.cpu_affinity()[:8])
    values,rows=build_inputs(args.inventory)
    current,producer=source_snapshot(ROOT),source_snapshot(args.producer_source)
    need(producer['commit']==PRODUCER_COMMIT,'Reviewed PaT90 producer source head differs')
    metadata,output=destinations(args.metadata_output,args.output,
        protected_run_roots(rows,[args.inventory,read(args.inventory)['original_distance_cache_inventory']['path']])+[physical(args.producer_source)])
    # Native binary identity is inherited from the validated PaT90 producer.
    inventories=read(args.inventory)
    old_plan=next(r for r in inventories['source_plans']if 'five-target-hdbscan' in r['path'])
    pinned=read(old_plan['path'])['runtime']
    rt=runtime(pinned['usalign'])
    need(rt['usalign_sha256']==pinned['usalign_sha256'],'Original native USalign binary changed')
    plan={'schema_version':1,'operation':OPERATION,'source':current,'producer_source':producer,
          'frozen_files':rows,'runtime':rt,'settings':deepcopy(SETTINGS),'resources':deepcopy(RESOURCES),
          'bounds':deepcopy(BOUNDS),'excluded':list(EXCLUDED),'cases':values['cases'],
          'metadata':str(metadata),'output':str(output),'resource_root':str(metadata.parent),
          'scientific_execution':False,'publication_authorized':False,'ui_deployment_authorized':False,
          'inventory':record(args.inventory),'coordinate_exports':'Only selected MCMC50/DISCO50 full-construct PDB/PSE panels; no fine-cluster representatives.'}
    metadata.mkdir();write(metadata/'inputs.json',values);plan['inputs']=record(metadata/'inputs.json')
    write(metadata/'execution-plan.json',plan)
    return plan


def recovery_spec(plan):
    """One explicitly approved recovery; original science and cumulative caps."""
    value = plan.get('recovery')
    if value is None:
        return None
    need(value.get('schema_version') == 1 and value.get('parent_plan', {}).get('sha256') == PARENT_PLAN_SHA
         and value.get('parent_source', {}).get('commit') == PARENT_COMMIT,
         'Recovery must name the exact interrupted parent')
    verify([value['parent_plan'], value['parent_approval'], value['interruption'], value['audit']])
    parent = read(value['parent_plan']['path'])
    interrupted = read(value['interruption']['path'])
    additional_wall = preflight_failure_history(value, parent)
    if additional_wall:
        prior_observation = read(value['preflight_failure']['path'])
        prior = read(prior_observation['failed_plan']['path'])
        need(physical(plan['metadata']) != physical(prior['metadata'])
             and physical(plan['output']) != physical(prior['output']), 'Fresh destinations required after failed preflight')
    need(parent['source'] == value['parent_source'] and source_snapshot(parent['source']['worktree']) == parent['source']
         and parent['settings'] == SETTINGS and parent['resources'] == RESOURCES and parent['bounds'] == BOUNDS
         and parent['cases'] == plan['cases'] and parent['inputs'] == plan['inputs'],
         'Parent source, masks, seeds, saved inputs or original envelope changed')
    need(interrupted['original_plan_sha256'] == PARENT_PLAN_SHA
         and interrupted['status'] == 'interrupted_no_completion' and interrupted['automatic_retry'] is False
         and interrupted['conservative_historical_wall_seconds']+additional_wall == value['historical_wall_seconds']
         and 0 < value['historical_wall_seconds'] < RESOURCES['wall_seconds'],
         'Interrupted attempt wall charge differs')
    need(value['case_id'] == 'sr215_bmr6366--all'
         and type(value['historical_directional_calls_charged']) is int
         and 0 < value['historical_directional_calls_charged'] < 186800
         and value['pending_recalculation_authorized_by_new_plan'] is True,
         'Recovery call reservation/case differs')
    audit = read(value['audit']['path'])
    need(audit['historical_directional_calls_charged'] == value['historical_directional_calls_charged'],
         'Historical native charge differs from the audited durable reservations')
    need(audit['parent_plan_sha256'] == PARENT_PLAN_SHA and audit['parent_source_commit'] == PARENT_COMMIT
         and audit['case_id'] == value['case_id']
         and physical(audit['original_database']['path']) == physical(parent['output'])/'cases'/value['case_id']/'native-tm.sqlite'
         and physical(plan['resource_root']) == physical(parent['resource_root'])
         and physical(plan['output']) != physical(parent['output'])
         and physical(plan['metadata']) != physical(parent['metadata']),
         'Audited recovery evidence/destinations do not belong to the exact interrupted attempt')
    remaining = RESOURCES['wall_seconds']-value['historical_wall_seconds']
    service = value['service']
    need(re.fullmatch(r'[a-z0-9][a-z0-9-]{1,100}', service['unit']) is not None
         and service == service_contract(service['unit'], remaining), 'Recovery service resource/no-restart settings differ')
    need(value['prepared_boot_id'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
         'Host rebooted after recovery preparation; stop for review')
    return value


def service_contract(unit, remaining):
    return {'unit': unit, 'type': 'exec', 'restart': 'no', 'kill_mode': 'control-group',
        'runtime_max_seconds': remaining-30, 'timeout_stop_seconds': 30,
        'memory_max_bytes': 32*2**30, 'cpu_quota_percent': 800, 'allowed_cpus': list(range(8)),
        'process_affinity': list(range(8)),
        'tasks_max': 256}


def preflight_failure_history(recovery, parent):
    """Bind one failed launch with no worker; never reopen/resubmit that attempt."""
    row = recovery.get('preflight_failure')
    if row is None:
        return 0
    verify([row]); observation = read(row['path'])
    need(observation.get('kind') == 'four-target-recovery-preflight-failure'
         and observation.get('status') == 'verified_no_worker_or_science'
         and observation.get('scientific_calls') == 0
         and observation.get('failed_source_commit') == FAILED_RECOVERY_COMMIT
         and observation['failed_plan']['sha256'] == FAILED_RECOVERY_PLAN_SHA,
         'Exact failed preflight lineage required')
    verify(observation['frozen_files']+[observation['failed_plan'], observation['failed_approval'], observation['failure_receipt']])
    failed = read(observation['failed_plan']['path']); receipt = read(observation['failure_receipt']['path'])
    consent = read(observation['failed_approval']['path'])
    need(failed['source']['commit'] == FAILED_RECOVERY_COMMIT and source_snapshot(failed['source']['worktree']) == failed['source']
         and failed['cases'] == parent['cases'] and failed['inputs'] == parent['inputs']
         and failed['settings'] == parent['settings'] and failed['resources'] == parent['resources']
         and failed['bounds'] == parent['bounds'] and failed['recovery']['parent_plan']['sha256'] == PARENT_PLAN_SHA
         and physical(failed['resource_root']) == physical(parent['resource_root']), 'Failed preflight source/scientific scope differs')
    need(receipt['status'] == 'failed' and receipt['exit_code'] is None
         and receipt['error'] == 'Recovery service must be confined to the approved eight CPUs'
         and receipt['source_commit'] == FAILED_RECOVERY_COMMIT and receipt['plan_sha256'] == FAILED_RECOVERY_PLAN_SHA
         and not physical(failed['output']).exists()
         and not (physical(failed['metadata'])/'execution.log').exists()
         and not (physical(failed['metadata'])/'telemetry.jsonl').exists(), 'Prior attempt must have stopped before worker launch')
    need(consent['status'] == 'approved' and consent['user_message']
         and consent['approved_source_commit'] == FAILED_RECOVERY_COMMIT
         and consent['approved_plan_sha256'] == FAILED_RECOVERY_PLAN_SHA,
         'Failed attempt approval does not match')
    charged = observation['additional_wall_seconds_charged']
    need(type(charged) is int and charged == 11 and charged >= math.ceil(receipt['elapsed_seconds'])
         and observation['conservative_historical_wall_seconds'] == 4163
         and observation['remaining_wall_seconds'] == 39037
         and observation['historical_directional_calls_charged'] == recovery['historical_directional_calls_charged'] == 36750,
         'Failed preflight charge/reservation differs')
    return charged


def prepare_recovery(args):
    """Freeze already validated inputs and audited evidence; no science/retry."""
    need(sys.flags.optimize == 0 and sha(args.parent_plan) == PARENT_PLAN_SHA, 'Exact interrupted parent plan required')
    parent, interrupted = read(args.parent_plan), read(args.interruption)
    parent_approval = read(args.parent_approval)
    need(parent_approval.get('status') == 'approved' and bool(parent_approval.get('user_message'))
         and parent_approval.get('approved_plan_sha256') == PARENT_PLAN_SHA
         and parent_approval.get('approved_source_commit') == PARENT_COMMIT, 'Exact parent approval record required')
    need(parent['source']['commit'] == PARENT_COMMIT and source_snapshot(parent['source']['worktree']) == parent['source'],
         'Interrupted frozen source changed')
    need(runtime(parent['runtime']['usalign']) == parent['runtime'], 'Scientific runtime changed after interruption')
    verify(parent['frozen_files'] + [parent['inputs'], parent['inventory']])
    metadata, output = physical(args.metadata_output), physical(args.output)
    root = physical(parent['resource_root'])
    need(metadata.parent == output.parent == root and metadata != output
         and not metadata.exists() and not output.exists(), 'Fresh sibling recovery destinations required')
    from src.analysis.tm_state_recovery import validate_recovery_receipt
    receipt = validate_recovery_receipt(args.audit, approved_receipt_sha256=sha(args.audit))
    recovery = {'schema_version': 1, 'parent_plan': record(args.parent_plan),
        'parent_approval': record(args.parent_approval), 'parent_source': parent['source'],
        'interruption': record(args.interruption), 'audit': record(args.audit),
        'case_id': 'sr215_bmr6366--all',
        'historical_wall_seconds': interrupted['conservative_historical_wall_seconds'],
        'historical_directional_calls_charged': receipt['historical_directional_calls_charged'],
        'pending_recalculation_authorized_by_new_plan': True,
        'prepared_boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'service': service_contract(args.service_unit, RESOURCES['wall_seconds']-interrupted['conservative_historical_wall_seconds']),
        'execution': 'One fresh no-restart transient user service; no automatic restart or retry after failure/reboot.',
        'cache_policy': 'Reuse only independently audited COMPLETE proofs; preserve original and copy evidence; replay deterministic searches from empty anchor baseline.'}
    observation_path = getattr(args, 'preflight_observation', None)
    additional_records = []
    if observation_path is not None:
        recovery['preflight_failure'] = record(observation_path)
        additional = preflight_failure_history(recovery, parent)
        recovery['historical_wall_seconds'] += additional
        recovery['service'] = service_contract(args.service_unit, RESOURCES['wall_seconds']-recovery['historical_wall_seconds'])
        additional_records = [record(observation_path)]+read(observation_path)['frozen_files']
    plan = deepcopy(parent)
    plan.update(source=source_snapshot(ROOT), metadata=str(metadata), output=str(output), recovery=recovery)
    rows = parent['frozen_files'] + receipt['frozen_files'] + parent['source']['files'] + additional_records
    plan['frozen_files'] = sorted({r['path']: r for r in rows}.values(), key=lambda r: r['path'])
    recovery_spec(plan)
    metadata.mkdir(); write(metadata/'execution-plan.json', plan)
    return plan


def submission_command(plan, plan_path, approval_path, expected_sha):
    service = plan['recovery']['service']
    props = {'Type': 'exec', 'Restart': 'no', 'KillMode': 'control-group',
        'RuntimeMaxSec': service['runtime_max_seconds'], 'TimeoutStopSec': service['timeout_stop_seconds'],
        'MemoryMax': service['memory_max_bytes'], 'CPUQuota': str(service['cpu_quota_percent'])+'%',
        'AllowedCPUs': ','.join(map(str, service['allowed_cpus'])), 'TasksMax': service['tasks_max'],
        'CPUAffinity': str(service['process_affinity'][0])+'-'+str(service['process_affinity'][-1]),
        'UMask': '0077', 'StandardOutput': 'append:'+str(physical(plan['metadata'])/'service.log'),
        'StandardError': 'inherit'}
    command = ['systemd-run', '--user', '--unit='+service['unit'], '--working-directory='+str(ROOT)]
    command += ['--property='+key+'='+str(value) for key, value in props.items()]
    env = {'PYTHONOPTIMIZE': '0', 'PYTHONPATH': '', 'PYTHONDONTWRITEBYTECODE': '1',
           'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'core.fsmonitor', 'GIT_CONFIG_VALUE_0': 'false'}
    command += ['--setenv='+key+'='+value for key, value in env.items()]
    return command+[sys.executable, str(Path(__file__).resolve()), 'run', '--plan', str(plan_path),
                    '--approval', str(approval_path), '--expected-sha', expected_sha]


def submit(plan_path, approval_path, expected_sha):
    """One approved submission, independent of this terminal; never auto-retry."""
    plan = validate(plan_path, approval_path, expected_sha)
    need(plan.get('recovery') is not None, 'This submit entry point is only for the reviewed recovery')
    metadata = physical(plan['metadata']); unit = plan['recovery']['service']['unit']
    state = subprocess.run(['systemctl', '--user', 'show', unit+'.service', '--property=LoadState', '--value'],
                           capture_output=True, text=True, timeout=20)
    need(state.stdout.strip() == 'not-found', 'Unit already exists or its state is ambiguous; do not resubmit')
    command = submission_command(plan, plan_path, approval_path, expected_sha)
    write(metadata/'submission-intent.json', {'plan_sha256': expected_sha,
        'source_commit': plan['source']['commit'], 'argv': command, 'automatic_retry': False,
        'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except BaseException as error:
        write(metadata/'submission-response.json', {'status': 'unknown', 'error': str(error)[:2048], 'automatic_retry': False})
        raise
    write(metadata/'submission-response.json', {'status': 'accepted' if result.returncode == 0 else 'failed_or_ambiguous',
        'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'automatic_retry': False})
    need(result.returncode == 0, 'Submission was not confirmed; inspect unit and receipts, never blindly retry')


def verify_service_context(plan):
    """Reject a detached/manual controller or mismatched service before science."""
    service = plan['recovery']['service']; unit = service['unit']+'.service'
    fields = ['InvocationID', 'MainPID', 'ControlGroup', 'Type', 'TasksMax', 'Restart', 'KillMode', 'MemoryMax', 'CPUAffinity',
              'RuntimeMaxUSec', 'TimeoutStopUSec', 'ExecStart', 'ExecMainStartTimestampMonotonic']
    result = subprocess.run(['systemctl', '--user', 'show', unit]+['--property='+p for p in fields],
                            capture_output=True, text=True, timeout=20)
    need(result.returncode == 0, 'Cannot verify owning recovery service')
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    invocation = os.environ.get('INVOCATION_ID')
    group = next(line.split(':', 2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    need(invocation and values['InvocationID'] == invocation and values['MainPID'] == str(os.getpid())
         and values['ControlGroup'] == group and group.endswith('/'+unit)
         and values['Type'] == service['type'] and int(values['TasksMax']) == service['tasks_max']
         and values['Restart'] == 'no' and values['KillMode'] == 'control-group'
         and int(values['MemoryMax']) == service['memory_max_bytes'], 'Recovery service identity or policy differs')
    def seconds(text):
        scales = {'d':86400, 'h':3600, 'min':60, 's':1, 'ms':.001, 'us':.000001, 'µs':.000001}
        tokens = re.findall(r'(\d+(?:\.\d+)?)\s*(min|ms|us|µs|d|h|s)', text)
        need(tokens and re.sub(r'\d+(?:\.\d+)?\s*(?:min|ms|us|µs|d|h|s)', '', text).strip() == '',
             'Unrecognized service time limit')
        return sum(float(number)*scales[unit] for number, unit in tokens)
    need(seconds(values['RuntimeMaxUSec']) == service['runtime_max_seconds']
         and seconds(values['TimeoutStopUSec']) == service['timeout_stop_seconds'], 'Recovery service time limits differ')
    cg = physical('/sys/fs/cgroup'+group)
    memory = int((cg/'memory.max').read_text().strip())
    tasks = int((cg/'pids.max').read_text().strip())
    quota, period = map(int, (cg/'cpu.max').read_text().split())
    need(memory == service['memory_max_bytes'] and quota/period <= 8 and tasks == service['tasks_max'], 'Recovery cgroup limits differ')
    import psutil
    affinity = psutil.Process().cpu_affinity()
    configured = []
    for token in re.split(r'[,\s]+', values['CPUAffinity'].strip()):
        need(re.fullmatch(r'\d+(?:-\d+)?', token) is not None, 'Invalid service CPU-affinity property')
        bounds = list(map(int, token.split('-')))
        configured.extend(range(bounds[0], bounds[-1]+1))
    need(sorted(set(configured)) == service['process_affinity'] == service['allowed_cpus']
         and affinity == service['process_affinity'], 'Recovery service must be confined to the approved eight CPUs')
    return {'boot_id': plan['recovery']['prepared_boot_id'], 'controller_pid': os.getpid(),
            'properties': values, 'cgroup_memory_max': memory, 'cgroup_cpu_max': [quota, period],
            'cgroup_pids_max': tasks, 'affinity': affinity}


def approval(plan_path,approval_path,expected_sha):
    need(sys.flags.optimize==0 and sha(plan_path)==expected_sha,'Exact plan SHA/unoptimized Python required')
    plan,approved=read(plan_path),read(approval_path)
    need(approved.get('status')=='approved'and bool(approved.get('user_message'))
         and approved.get('approved_plan_sha256')==expected_sha
         and approved.get('approved_source_commit')==plan['source']['commit'],'Fresh exact user approval required')
    need(plan.get('schema_version')==1 and plan.get('operation')==OPERATION and plan.get('settings')==SETTINGS
         and plan.get('resources')==RESOURCES and plan.get('bounds')==BOUNDS and plan.get('excluded')==EXCLUDED
         and plan.get('scientific_execution')is False and plan.get('publication_authorized')is False
         and plan.get('ui_deployment_authorized')is False and physical(plan['source']['worktree'])==ROOT,
         'Approved source/settings/resources/exclusions differ')
    cases=plan.get('cases',[])
    need(tuple((c['target'],c['range_id'])for c in cases)==CASE_ORDER,'Approved six-case inventory/order differs')
    for ordinal,c in enumerate(cases):
        positions=MASKS[c['target'],c['range_id']];window=SPECS[c['target']][1]
        need(c['clustering_positions']==positions and c['tm_positions']==[p for p in positions if window[0]<=p<=window[1]]
             and c['construct_residues']==SPECS[c['target']][0]and c['seed']==SETTINGS['seed_base']+ordinal*SETTINGS['case_seed_stride'],
             'Approved mask/TM intersection/seed namespace differs')
    need(physical(plan['metadata'])==physical(plan_path).parent
         and physical(plan['resource_root'])==physical(plan['metadata']).parent
         and physical(plan['output']).parent==physical(plan['resource_root']),'Accounting root/destination differs')
    recovery_spec(plan)
    return plan


def validate(plan_path,approval_path,expected_sha,*,output_may_exist=False):
    plan=approval(plan_path,approval_path,expected_sha)
    need(source_snapshot(ROOT)==plan['source'],'Current source differs from approved source')
    need(plan['producer_source']['commit']==PRODUCER_COMMIT and source_snapshot(plan['producer_source']['worktree'])==plan['producer_source'],'Frozen producer source changed')
    need(runtime(plan['runtime']['usalign'])==plan['runtime'],'Pinned Python/native/export runtime changed')
    verify(plan['frozen_files']+[plan['inputs'],plan['inventory']])
    need(output_may_exist or not physical(plan['output']).exists(),'Output already exists; no retry/resume')
    return plan



def check_limits(plan, started, rss, size, free):
    r = plan['resources']
    historical = (plan.get('recovery') or {}).get('historical_wall_seconds', 0)
    need(historical+time.monotonic()-started <= r['wall_seconds'], 'Cumulative wall limit exceeded')
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
            if plan.get('recovery'):
                write(metadata/'service-context.json', verify_service_context(plan))
            own = psutil.Process(); own.cpu_affinity(own.cpu_affinity()[:RESOURCES['cpus']])
            need(shutil.disk_usage(root).free >= RESOURCES['startup_free_gib']*2**30, 'Startup requires46GiB free (proposed40GiB reserve plus6GiB output)')
            check_limits(plan, started, own.memory_info().rss, tree_bytes(root), shutil.disk_usage(root).free)
            output.mkdir()
            env = {**os.environ, **THREAD_ENV, 'PYTHONDONTWRITEBYTECODE': '1',
                   'FOUR_TARGET_RESIDUAL_CONTROLLER_PID': str(os.getpid())}
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




def execute_cases(values, plan, output, check, *, replay=replay_source, extract=extract_case, stage=None, exporter=None,
                  recovery_authorization=None, new_plan_sha256=None):
    """Sequential, independent searches; replay each original target cache once."""
    if stage is None:
        from src.analysis.residual_state_sampling import run_case as stage
    if exporter is None:
        from src.analysis.state_panel_exports import export_panel as exporter
    totals={'native_directional_calls':0,'supported_states':0,'mh_proposals':0,'pdb_exports':0,'pse_exports':0}
    recovery = plan.get('recovery')
    historical_calls = recovery['historical_directional_calls_charged'] if recovery else 0
    results=[]
    for target,source in values['sources'].items():
        check();cohort=values['cohorts'][target];names=cohort['models']
        raw=replay(source['workflow'],names,source['feature_source'],check)
        try:
            for case in values['cases']:
                if case['target']!=target:continue
                check();features,h=extract(raw,case)
                need(h==case['feature_sha256'],'Exact approved TM-core feature hash changed')
                folder=output/'cases'/case['id']
                need(not folder.exists(),'Fresh independent case output required')
                adapters = {'export_panel': exporter}
                if recovery and case['id'] == recovery['case_id']:
                    from src.analysis.tm_state_recovery import RecoveryTMScorer
                    from src.analysis.tm_state_sqlite import SQLiteNativeTMScorer
                    def recover_scorer(store, executable, database, maximum, **kwargs):
                        fresh = SQLiteNativeTMScorer(store, executable, database,
                            maximum-historical_calls, **kwargs)
                        try:
                            return RecoveryTMScorer(fresh, recovery['audit']['path'],
                                folder/'reused-native-evidence.jsonl',
                                approved_receipt_sha256=recovery['audit']['sha256'],
                                case_id=case['id'], recovery_authorization=recovery_authorization,
                                new_plan_sha256=new_plan_sha256, new_source_commit=plan['source']['commit'])
                        except BaseException:
                            fresh.close(require_complete=False)
                            raise
                    adapters['scorer_factory'] = recover_scorer
                result=stage(features,names,cohort,values['clustering'][case['id']],folder,plan,case,check,
                             adapters=adapters)
                del features
                summary=result['summary']
                need(type(summary['native_directional_calls'])is int and 0<=summary['native_directional_calls']<=186800
                     and type(summary['supported_states'])is int and 0<=summary['supported_states']<=3
                     and type(summary['mh_proposals'])is int and 0<=summary['mh_proposals']<=120000
                     and summary['pdb_exports']==summary['pse_exports']==2*summary['supported_states'],
                     'Independent case operation envelope differs')
                for key in totals:totals[key]+=summary[key]
                need(historical_calls+totals['native_directional_calls']<=BOUNDS['total_native_directional_calls']
                     and totals['supported_states']<=18 and totals['mh_proposals']<=720000
                     and totals['pdb_exports']<=36 and totals['pse_exports']<=36,'Aggregate scientific envelope exceeded')
                results.append({'case':case,'catalog':record(folder/'catalog.json'),'summary':summary,
                                'saved_clustering':values['clustering'][case['id']]['saved_source_views']})
                write(output/('case-completed-'+case['id']+'.json'),results[-1])
                check()
        finally:
            del raw
    need(len(results)==6 and len({r['case']['id']for r in results})==6,'Complete six-case batch coverage required')
    if recovery:
        totals['historical_native_calls_charged'] = historical_calls
        totals['cumulative_native_calls_charged'] = historical_calls+totals['native_directional_calls']
    return {'schema_version':1,'kind':'four-target-independent-residual-states','status':'complete',
            'cases':results,'summary':totals,'settings':plan['settings'],'baseline_TM_columns':0,
            'clustering_fits':0,'projection_fits':0,'publication_authorized':False,'ui_deployment_authorized':False,
            'interpretation':'NativeTM0.80 representative stars, not biological populations or all-pairs certificates. Six bounded searches may miss states; short16-CA SR core remains explicit.'}


def worker(plan_path, approval_path, expected_sha):
    need(os.environ.get('FOUR_TARGET_RESIDUAL_CONTROLLER_PID')==str(os.getppid()),'Worker requires its owning controller')
    plan=validate(plan_path,approval_path,expected_sha,output_may_exist=True)
    intent=read(Path(plan['metadata'])/'execution-intent.json')
    need(intent['controller_pid']==os.getppid()and intent['plan_sha256']==expected_sha
         and intent['source_commit']==plan['source']['commit'],'Active exact controller intent required')
    output=physical(plan['output']);need(output.is_dir()and not any(output.iterdir()),'Fresh empty controller-created output required')
    scratch=output/'scratch';scratch.mkdir()
    for key in ('TMPDIR','NUMBA_CACHE_DIR','JOBLIB_TEMP_FOLDER','MPLCONFIGDIR'):
        p=scratch/key.lower();p.mkdir();os.environ[key]=str(p)
    os.environ.update(THREAD_ENV)
    import tempfile
    tempfile.tempdir=os.environ['TMPDIR']
    import psutil
    own=psutil.Process();own.cpu_affinity(own.cpu_affinity()[:8])
    values=read(plan['inputs']['path'])
    need(values['cases']==plan['cases'],'Worker case bindings differ from approved plan')
    def check():need(os.getppid()==intent['controller_pid'],'Owning controller disappeared')
    result=execute_cases(values,plan,output,check,recovery_authorization=read(approval_path),new_plan_sha256=expected_sha)
    write(output/'catalog.json',{**result,'plan_sha256':expected_sha,'source_commit':plan['source']['commit']})
    validate(plan_path,approval_path,expected_sha,output_may_exist=True)
    write(output/'output-manifest.json',{'schema_version':1,'plan_sha256':expected_sha,'source_commit':plan['source']['commit'],
          'files':[record(p)for p in sorted(output.rglob('*'))if p.is_file()]})
    write(output/'worker-completion.json',{'status':'complete','plan_sha256':expected_sha,'source_commit':plan['source']['commit'],
          'catalog':record(output/'catalog.json'),'output_manifest':record(output/'output-manifest.json'),
          'summary':result['summary'],'publication_authorized':False,'ui_deployment_authorized':False})


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    prep=sub.add_parser('prepare')
    for flag in ('inventory','producer-source','metadata-output','output'):prep.add_argument('--'+flag,type=Path,required=True)
    recovery=sub.add_parser('prepare-recovery')
    for flag in ('parent-plan','parent-approval','interruption','audit','metadata-output','output'):
        recovery.add_argument('--'+flag,type=Path,required=True)
    recovery.add_argument('--service-unit',required=True)
    recovery.add_argument('--preflight-observation',type=Path)
    for command in ('run','worker','submit'):
        p=sub.add_parser(command);p.add_argument('--plan',type=Path,required=True);p.add_argument('--approval',type=Path,required=True)
        p.add_argument('--expected-sha',required=True)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args)
    elif args.command=='prepare-recovery':prepare_recovery(args)
    elif args.command=='run':run(args.plan,args.approval,args.expected_sha)
    elif args.command=='submit':submit(args.plan,args.approval,args.expected_sha)
    else:worker(args.plan,args.approval,args.expected_sha)


if __name__=='__main__':main()
