#!/usr/bin/env python3
"""Prepare or execute one explicitly approved SR215 Primary/HDBSCAN mask batch.

Prepare hashes saved input arrays/metadata only. Run requires an exact fresh user
approval and a bounded, one-shot controller. No Git merge or publication exists.
"""
from __future__ import annotations
import argparse
from collections import Counter
from dataclasses import asdict
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.casp17_hdbscan import PACKAGES,source_inventory,materialize,bind

TARGET='SR215_bmr6366'
POSITIONS=[*range(32,48),*range(78,100)]
RANGES=[[32,47],[78,99]]
RANGE_ID='res32-47-plus78-99'
OPERATION='SR215 canonical32–47 plus78–99 fresh Primary and successive10D HDBSCAN Phase A'
SEQUENCE_SHA='7ab896059b4577bbcfc7cf9db00493b1bc9cea4bee282239195085658fe77f13'
PRIMARY_SHA='7e8993089a8acac920445a4bbe5eb89a0406c86482a36b0dff904b07996901bc'
RESOURCES={'cpus':8,'memory_gib':32,'output_gib':20,'wall_seconds':43200,'reserve_gib':50}
BOUNDS={'published_procedures':2,'models':11000,'canonical_residues':38,'CA_pairs':703,
 'within_first_segment_pairs':120,'within_second_segment_pairs':231,'cross_segment_pairs':352,
 'maximum_default_projection_populations':2,'maximum_PCA_fits':2,'maximum_tSNE_fits':2,
 'maximum_UMAP_fits':30,'maximum_HD_UMAP_fits':24,'maximum_HDBSCAN_extractions':48,
 'maximum_HD_refinements':5,'maximum_HD_population_dimension_pairs':8,
 'maximum_internal_Primary_component_Ward_trees':2064,'maximum_component_candidate_k':8,
 'maximum_Primary_feature_queries_per_component':512,'maximum_fixed_HD_feature_queries':512,
 'maximum_landmarks':100,'maximum_directional_USalign_calls':9900,
 'maximum_representative_groups_per_view':800,'maximum_representative_groups':1600,
 'maximum_selected_models_per_group':5,'maximum_representative_CA_RMSD_pairs':16000,
 'maximum_representative_PDB_snapshots':1600,'bounded_Ward_searches':0,
 'published_default_recursive_procedures':0,'Bonsai_fits':0,'complete_TM_grid_calls':0,
 'coordinate_ensemble_PSE_exports':0,'gpus':0,'paid_calls':0,'cost_usd':0,'automatic_retries':0}
EXCLUDED=['Full default-recursive procedure','Bounded Ward search','Historical labels/embeddings/TM as inference inputs',
 'Complete medoid TM grids','Bonsai fits','Coordinate ensembles/PSEs','Reports/movies',
 'Folding','Paid APIs','GPU compute','Package installation','Automatic retries','Git merges/distribution','Public publication']


def need(value,message):
    if not value:raise ValueError(message)


def limits():
    for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','BLIS_NUM_THREADS','NUMBA_NUM_THREADS']:
        os.environ[key]='8'
    os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:8])


def path(value):
    p=Path(value).absolute()
    need('..'not in p.parts and not any(x.is_symlink()for x in [p,*p.parents]),'Use canonical non-symlink paths')
    return p


def regular(value):
    p=path(value);need(p.is_file(),'Frozen input must be an existing regular file: '+str(p));return p


def fresh(value):
    p=path(value);need(not p.exists(),'New immutable output required; no automatic retries: '+str(p));return p


def sha(value):
    digest=hashlib.sha256()
    with Path(value).open('rb')as stream:
        for block in iter(lambda:stream.read(4*1024**2),b''):digest.update(block)
    return digest.hexdigest()


def read(value):return json.loads(regular(value).read_text())


def record(value):
    p=regular(value);return {'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}


def save(value,data):
    p=Path(value);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x')as stream:json.dump(data,stream,indent=2,allow_nan=False);stream.write('\n')


def head(root):return subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()


def verify(rows):
    need(len({r['path']for r in rows})==len(rows),'Repeated frozen file records')
    for r in rows:need(record(r['path'])==r,'Frozen source/input changed: '+r['path'])


def validate_draft(draft,primary_sha):
    from src.analysis.residue_range_plan import identity_hash
    scope=draft.get('scope_provenance',{});analyses=draft.get('analyses',[])
    methods=['Primary','HDBSCAN (saved 10D UMAP successive largest-leaf procedure)']
    need(draft.get('schema_version')==1 and draft.get('kind')=='sr215_residue_analysis_draft'
         and draft.get('status')=='proposed_requires_review_and_execution_approval'
         and draft.get('target')==TARGET and draft.get('scientific_execution')is False
         and draft.get('execution_authorized')is False,'A proposed, unexecuted SR215 draft is required')
    need(scope.get('target')==TARGET and scope.get('schema_version')==1 and scope.get('chain')=='A'
         and scope.get('construct_residues')==139 and scope.get('models')==11000
         and scope.get('sequence_sha256')==SEQUENCE_SHA
         and scope.get('source_data_sha256')==primary_sha==PRIMARY_SHA
         and scope.get('canonical_positions')==list(range(1,140))
         and scope.get('clustering')==methods and scope.get('scientific_execution')is False,'Draft source cohort/sequence changed')
    need(len(analyses)==1,'Exactly one independent combined-mask analysis is proposed')
    item=analyses[0]
    need(item.get('id')=='analysis-1' and item.get('canonical_ranges')==[{'start':a,'end':b}for a,b in RANGES]
         and item.get('canonical_positions')==POSITIONS and item.get('retained_residue_count')==38
         and item.get('ca_distance_feature_count')==703
         and item.get('requested_clustering_procedures')==methods,'Draft residue union or two procedures changed')
    return identity_hash(draft)


def disjoint(output,metadata,protected,frozen):
    output,metadata=path(output),path(metadata)
    need(not output.is_relative_to(metadata)and not metadata.is_relative_to(output),'Metadata/output must be disjoint')
    for p in map(path,protected):
        need(not output.is_relative_to(p)and not p.is_relative_to(output)
             and not metadata.is_relative_to(p)and not p.is_relative_to(metadata),'Preserve frozen source/delivery directories')
    for r in frozen:
        p=path(r['path']);need(not p.is_relative_to(output)and not p.is_relative_to(metadata),'Output/metadata would contain frozen input')


def runtime(usalign):
    return {'host':os.uname().nodename,'python':str(Path(sys.executable).resolve()),
        'python_sha256':sha(sys.executable),'usalign':str(regular(Path(usalign).resolve())),
        'usalign_sha256':sha(usalign),'versions':{p:version(p)for p in PACKAGES}}


def comparison_scope(data,ident,role,names,methods):
    need(data.get('target')==TARGET and data.get('residues')==139
         and data.get('models')==names and data.get('methods')==methods
         and len(data.get('clusters',[]))==len(names),'Comparison cohort/order/target differs')
    provenance=data.get('provenance',{})
    original=provenance.get('original_parent_provenance',provenance)
    need(original.get('sequence_sha256')==SEQUENCE_SHA,'Comparison construct sequence differs')
    if ident=='res5-95':
        proof=provenance.get('regional_feature_proof',{})
        need(data.get('view_id')==('original'if role=='primary'else 'density')
             and provenance.get('regional_source_commit')=='98059f6e28d87f7d7b36129871574abe4d80a160'
             and provenance.get('regional_canonical_positions')==list(range(5,96))
             and proof.get('canonical_positions')==list(range(5,96))
             and proof.get('shape')==[11000,4095]and proof.get('dtype')=='float32'
             and proof.get('feature_sha256')=='f696ae0ab6a5f2a13c22e355a63ac9062f239492a7d28ab52cb5287886d5006a',
             'Comparison must be the saved 5–95 procedure, not a different residue mask')
    else:
        need(ident=='all'and not provenance.get('regional_canonical_positions')
             and not provenance.get('regional_feature_proof')
             and (role!='density'or data.get('view_id')=='density'),'Expected saved full139 comparison')


def freeze_supplementary_sources(value,freeze):
    """Pin nested saved evidence now, before an approved batch can fit anything."""
    if isinstance(value,dict):
        for key,item in value.items():
            if key=='input_source_file':
                need(isinstance(item,dict)and isinstance(item.get('path'),str)
                     and isinstance(item.get('sha256'),str)and len(item['sha256'])==64,
                     'Malformed saved supplementary source descriptor')
                freeze(item['path'],item['sha256'])
            else:freeze_supplementary_sources(item,freeze)
    elif isinstance(value,list):
        for item in value:freeze_supplementary_sources(item,freeze)


def native_sources(inventory):
    """Normalize the read-only audit's HEAD records for native callback bindings."""
    records=inventory['native_sources']
    expected={'density':'db52d611ff77546ce6839b3b8f65f5dc9c323074',
              'ward':'781417a065f7a01271ae9f77d344cd4441e30e4c'}
    need(set(records)==set(expected),'Frozen native primitives differ')
    need(all(records[k].get('head')==v for k,v in expected.items()),'Frozen native audit heads differ')
    return {k:{'worktree':str(path(row['worktree'])),'commit':row['head']}for k,row in records.items()}


def freeze_presentation(overlay,command_path,freeze):
    overlay=path(overlay);receipt_path=overlay/'presentation.json';receipt=read(receipt_path)
    need(receipt.get('kind')=='saved-atlas-presentation-overlay'and receipt.get('scientific_execution')is False,'A saved private overlay is required')
    freeze(receipt_path);freeze(command_path);freeze(overlay.parent/'input-view-policy.json')
    command=read(command_path)
    need(isinstance(command,list)and all(isinstance(v,str)for v in command),'Freeze the exact saved presentation command')
    def argument(key):
        need(command.count(key)==1,'Missing/ambiguous saved presentation argument: '+key)
        return Path(command[command.index(key)+1])
    for key in ['--projection-metadata','--supplementary-metadata']:freeze(argument(key))
    freeze_supplementary_sources(read(argument('--supplementary-metadata')),freeze)
    from src.analysis.atlas_presentation import verify_files
    protected=[overlay]
    for root,rows,manifest_sha in [(Path(receipt['source_delivery']),receipt['source_files'],receipt['source_manifest_sha256'])]+[
        (Path(r['source_delivery']),r['source_files'],r['source_manifest_sha256'])for r in receipt['additional_deliveries'].values()]:
        protected.append(root);manifest=root.parent/'delivery-manifest.json'
        freeze(manifest,manifest_sha);verify_files(root,rows)
        for r in rows:freeze(root/r['path'],r['sha256'])
    for r in receipt['presentation_files']:freeze(overlay/r['path'],r['sha256'])
    workflow=argument('--workflow-root')
    for target,r in receipt.get('target_manifests',{}).items():
        candidates=list((workflow/target/'workflow').glob('*/manifest.json'));need(len(candidates)==1,'Ambiguous target workflow')
        manifest=candidates[0];freeze(manifest,r['sha256'])
        report=read(manifest).get('cluster_ensembles',{}).get('report')
        if target in receipt.get('target_region_reports',{}):
            report=Path(report);report=report if report.is_absolute()else manifest.parent/report
            freeze(report,receipt['target_region_reports'][target]['sha256'])
    return {'source':{'worktree':str(ROOT),'commit':head(ROOT)},'source_overlay':str(overlay),
        'prepare_command':command,'prepare_command_file':str(path(command_path)),
        'source_UI_import_commit':'c18179b85c61ed1fe580d49cac06fd37a216944e'},protected


def prepare(args):
    limits()
    metadata,output=fresh(args.metadata_output),fresh(args.output)
    need(output.parent.is_dir(),'Create the empty scientific output parent before preflight')
    need(shutil.disk_usage(output.parent).free>=70*2**30,'20GiB output plus50GiB reserve required')
    inventory_path=regular(args.inventory);inventory=read(inventory_path);draft_path=regular(args.draft);draft=read(draft_path)
    need(inventory.get('status')=='read_only_originals_and_caches_verified'
         and inventory.get('scientific_fits_exports_or_TM')==0,'Read-only verified input inventory required')
    frozen={}
    def freeze(value,expected=None):
        r=record(value);need(expected is None or r['sha256']==expected,'Input differs from its frozen identity: '+str(value))
        frozen[r['path']]=r;return r
    freeze(inventory_path);freeze(draft_path)
    for key in ['historical_plan','historical_bounded_plan','primary','parent','base_atlas','cache_manifest']:
        r=inventory[key];freeze(r['path'],r['sha256'])
    for r in inventory['models']+inventory['cache_files']+inventory['runtime_files']:freeze(r['path'],r['sha256'])
    previous=read(inventory['historical_plan']['path']);parent_path=Path(inventory['parent']['path']);parent=read(parent_path)
    primary_path=Path(inventory['primary']['path']);base=read(primary_path);names=base['models']
    validate_draft(draft,sha(primary_path))
    need(len(names)==11000 and len(set(names))==11000 and names==inventory['names']
         and base['target']==TARGET and Counter(base['methods'])==dict.fromkeys(set(base['methods']),1000)
         and len(set(base['methods']))==11,'Original full SR215 model cohort/order/methods changed')
    detection=parent['terminal_detection'];sequence=''.join(s[0]for s in detection['residue_labels'])
    need(detection['retained_reference_positions']==list(range(139))and hashlib.sha256(sequence.encode()).hexdigest()==SEQUENCE_SHA,
         'Full139 native source mask/sequence changed')
    from src.analysis.residue_range_plan import plan_residue_range,identity_hash
    mask=plan_residue_range(sequence,detection['retained_reference_positions'],RANGES)
    need(mask['retained_feature_count']==703 and mask['canonical_scope']['canonical_positions']==POSITIONS,'Incorrect selected feature union')
    lookup={r['model']:r for r in previous['comparison']['models']};members=[lookup[n]for n in names]
    for m in members:freeze(m['source_path'],m['sha256'])
    need(previous['expected_source_feature_array_sha256']==inventory['source_feature_array']['sha256']
         and inventory['source_feature_array']['shape']==[11000,9591]
         and inventory['selected_feature_hash_only']['shape']==[11000,703]
         and inventory['selected_feature_hash_only']['array_saved']is False,'Verified cache geometry changed')
    for f in sorted(Path(parent['distogram_dir']).iterdir()):
        if f.is_file():freeze(f)
    comparisons={}
    full=previous['full_range_views'];regional=Path(args.regional_delivery)
    for ident,views in {'all':{'primary':primary_path,'density':Path(full['density'])},
                        'res5-95':{'primary':regional/'data/original.json','density':regional/'data/density.json'}}.items():
        comparisons[ident]={}
        for role,p in views.items():
            freeze(p);data=read(p)
            comparison_scope(data,ident,role,names,base['methods'])
            comparisons[ident][role]=str(path(p))
    native=native_sources(inventory)
    roots=[ROOT,*[Path(r['worktree'])for r in native.values()]]
    for r in native.values():need(head(r['worktree'])==r['commit'],'Native source head moved')
    sources=source_inventory(roots)
    presentation,protected=freeze_presentation(args.source_overlay,args.prepare_command,freeze)
    protected += roots+[parent_path.parent,Path(parent['distogram_dir'])]
    protected += list({str(Path(m['source_path']).parent)for m in members})
    protected=sorted(set(map(str,protected)))
    disjoint(output,metadata,protected,list(frozen.values()))
    scores=next(s['values']for s in base['schemes']if s['key']=='mean_plddt')
    need(len(scores)==11000,'Ordered observed confidence values are required')
    rt=runtime(previous['runtime']['usalign']);need(rt['python_sha256']==previous['runtime']['python_sha256']
        and rt['usalign_sha256']==previous['runtime']['usalign_sha256'],'Native numerical executables changed')
    from src.analysis.selected_residue_protocols import SelectedResidueSettings
    plan={'schema_version':1,'operation':OPERATION,'execution_started':False,
      'source':{'worktree':str(ROOT),'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),'commit':head(ROOT)},
      'source_files':sources,'frozen_files':sorted(frozen.values(),key=lambda r:r['path']),
      'draft':record(draft_path),'inventory':record(inventory_path),'native_sources':native,'runtime':rt,
      'target':TARGET,'range_id':RANGE_ID,'canonical_positions':POSITIONS,'canonical_ranges':RANGES,
      'mask':mask,'members':members,'models':names,'scores':scores,'base_atlas':str(primary_path),
      'parent_manifest':str(parent_path),'comparison_views':comparisons,'presentation':presentation,
      'expected_source_feature_array_sha256':inventory['source_feature_array']['sha256'],
      'expected_selected_feature_array_sha256':inventory['selected_feature_hash_only']['sha256'],
      'component_settings':parent['cluster_selection_settings'],'settings':json.loads(json.dumps(asdict(SelectedResidueSettings()))),
      'projection_spec':previous['projection_spec'],'resources':RESOURCES,'bounds':BOUNDS,'excluded':EXCLUDED,
      'protected_roots':protected,'output':str(output),
      'validation_baseline':'Fresh Primary-stratified512fixedfeaturequeries/100population-weightedlandmarks. Primary selection separately uses512queries PERcomponent. Descriptive TM evidence; newly formed HDB groups can be unrepresented. HistoricalSRusedrecursive strata; not identical validation sampling.',
      'phase_a_exports':['Fresh Primary andHDB memberships; shared fresh2D PCA/UMAP/tSNE with PCAvarianceexplained',
       'Up to one fresh default-largest-child diagnostic,not a published recursive procedure',
       'Exact38-residue median/variance distance summaries from frozen703features',
       'Fixed-landmark TM validation and all/5–95 crosswalks; saved5–95referenceTM colors remain comparisons only',
       'Up to five native selected candidates/group and selected-group medoid full-construct PDB snapshots/scope proofs',
       'New private residue-range menu; source saved results unchanged'],
      'phase_b_requires_count_based_approval':['Complete medoid TM grids','Bonsai','Coordinate ensemble/PSE exports','Reports','Public publication'],
      'stop_conditions':['Any changed source/input/runtime/mask','Any stage failure; no automatic retries',
       'Resource or method-count limit','Fresh Primary exceeds100strata','Representative groups exceed800/view'],
      'approval_required':'Explicit fresh user approval of exact plan SHA and source commit before any fits/scoring/export'}
    metadata.mkdir(parents=True,exist_ok=False);save(metadata/'execution-plan.json',plan)
    result={'status':'awaiting_exact_user_execution_approval','plan_sha256':sha(metadata/'execution-plan.json'),
      'source_commit':plan['source']['commit'],'frozen_files':len(frozen),'resources':RESOURCES,'bounds':BOUNDS,'scientific_fits_started':0}
    save(metadata/'status.json',result);return result


def validate(plan_path,approval_path):
    plan_path=regular(plan_path);plan,approval=read(plan_path),read(approval_path)
    need(approval.get('status')=='approved'and isinstance(approval.get('user_message'),str)and approval['user_message'].strip()
         and approval.get('approved_plan_sha256')==sha(plan_path)
         and approval.get('approved_source_commit')==plan.get('source',{}).get('commit'),'Fresh explicit approval must bind exact plan and source')
    need(plan.get('schema_version')==1 and plan.get('operation')==OPERATION and plan.get('execution_started')is False
         and plan.get('target')==TARGET and plan.get('range_id')==RANGE_ID and plan.get('canonical_positions')==POSITIONS
         and plan.get('canonical_ranges')==RANGES and plan.get('resources')==RESOURCES
         and plan.get('bounds')==BOUNDS and plan.get('excluded')==EXCLUDED,'Changed finite batch operation or bounds')
    need(plan['source']['worktree']==str(ROOT)and head(ROOT)==plan['source']['commit'],'Approved source moved')
    need(plan['presentation']['source']=={'worktree':str(ROOT),'commit':plan['source']['commit']},'Presentation source moved')
    roots=[ROOT,*[Path(r['worktree'])for r in plan['native_sources'].values()]]
    need(source_inventory(roots)==plan['source_files'],'Numerical/UI source inventory changed')
    for r in plan['native_sources'].values():need(head(r['worktree'])==r['commit'],'Pinned native source moved')
    verify(plan['source_files']);verify(plan['frozen_files'])
    need(record(plan['draft']['path'])==plan['draft']and record(plan['inventory']['path'])==plan['inventory'],'Draft/input inventory changed')
    draft=read(plan['draft']['path']);validate_draft(draft,sha(plan['base_atlas']))
    from src.analysis.residue_range_plan import _validate_mask
    from src.analysis.selected_residue_protocols import SelectedResidueSettings
    _validate_mask(plan['mask'])
    need(plan['mask']['canonical_scope']['canonical_positions']==POSITIONS
         and plan['mask']['retained_feature_count']==703
         and plan['settings']==json.loads(json.dumps(asdict(SelectedResidueSettings()))),'Effective mask/settings changed')
    need(runtime(plan['runtime']['usalign'])==plan['runtime'],'Approved host/native runtime changed')
    names=read(plan['base_atlas'])['models'];need(plan['models']==names and len(names)==11000
         and [m['model']for m in plan['members']]==names and len(plan['scores'])==11000,'Approved model order changed')
    disjoint(fresh(plan['output']),plan_path.parent,plan['protected_roots'],plan['frozen_files'])
    return plan


def worker(plan_path,approval_path):
    pid=os.environ.get('SR215_MASK_CONTROLLER_PID','')
    need(pid.isdigit()and int(pid)==os.getppid()and int(pid)>1,'Worker requires the approved bounded controller')
    limits();plan=validate(plan_path,approval_path)
    import numpy as np
    from src.analysis.selected_residue_protocols import native_callbacks,run_selected_residue_protocols,SelectedResidueSettings,feature_proof
    from src.analysis.umap_component_clusters import ComponentSettings
    from src.analysis.selected_residue_delivery import export_results
    from scripts.prepare_selected_residue_display import prepare_display
    output=Path(plan['output']);output.mkdir(parents=True,exist_ok=False);scratch=output/'scratch';scratch.mkdir()
    os.environ['TMPDIR']=str(scratch)
    import tempfile
    tempfile.tempdir=str(scratch);started=time.monotonic()
    def check():
        if time.monotonic()-started>=RESOURCES['wall_seconds']:raise TimeoutError('Approved batch wall limit reached')
    parent=read(plan['parent_manifest']);full=materialize(parent,plan['models'],check)
    need(hashlib.sha256(full.tobytes(order='C')).hexdigest()==plan['expected_source_feature_array_sha256'],'Full cached features/order changed')
    features=np.ascontiguousarray(full[:,plan['mask']['feature_columns']],dtype=np.float32);del full
    need(hashlib.sha256(features.tobytes(order='C')).hexdigest()==plan['expected_selected_feature_array_sha256'],'Selected703feature values/order changed')
    callbacks=native_callbacks(plan['native_sources'],members=plan['members'],scores=plan['scores'],
       usalign=plan['runtime']['usalign'],usalign_sha256=plan['runtime']['usalign_sha256'],
       projection_spec=plan['projection_spec'],log=print,check=check)
    component=ComponentSettings(**{**plan['component_settings'],'repeat_seeds':tuple(plan['component_settings']['repeat_seeds'])})
    result=run_selected_residue_protocols(features,plan['models'],output/'inference',callbacks=callbacks,
       component_settings=component,settings=SelectedResidueSettings())
    summary=export_results(plan,result,features,output,native_density=callbacks.density,
       native_ensembles=bind(plan,'ward','bounded_ensembles'))
    check();display=prepare_display(plan,output)
    verify(plan['frozen_files'])
    for r in plan['native_sources'].values():need(head(r['worktree'])==r['commit'],'Pinned native source moved during execution')
    need(source_inventory([ROOT,*[Path(r['worktree'])for r in plan['native_sources'].values()]])==plan['source_files']
       and head(ROOT)==plan['source']['commit']and runtime(plan['runtime']['usalign'])==plan['runtime'],'Frozen source/runtime changed during execution')
    save(output/'complete.json',{'status':'private_selected_mask_phase_a_complete','plan_sha256':sha(plan_path),
      'source_commit':plan['source']['commit'],'target':TARGET,'canonical_ranges':RANGES,'canonical_positions':POSITIONS,
      'inference':result['summary'],'export_summary':summary,'private_display':display,
      'clustering_procedures':['Primary','HDBSCAN'],'scientific_input_files_modified':0,
      'public_publication':False,'phase_b':'pending separate count-based approval'})


def final_usage(plan,start):
    import resource
    size=0
    for p in Path(plan['output']).rglob('*')if Path(plan['output']).exists()else[]:
        need(not p.is_symlink(),'Unexpected generated symlink')
        if p.is_file():size+=p.stat().st_size
    row={'elapsed_seconds':time.monotonic()-start,'output_bytes':size,'free_bytes':shutil.disk_usage(Path(plan['output']).parent).free,
         'peak_child_rss_bytes':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*1024}
    r=plan['resources'];over=row['elapsed_seconds']>r['wall_seconds']or size>r['output_gib']*2**30 or row['free_bytes']<r['reserve_gib']*2**30 or row['peak_child_rss_bytes']>r['memory_gib']*2**30
    return row,'Approved resource bound reached; no automatic retry'if over else None


def controller(plan,plan_path,approval_path):
    import fcntl,psutil
    from scripts.run_regional_comparison import monitor,stop_group
    need(shutil.disk_usage(Path(plan['output']).parent).free>=70*2**30,'20GiB output plus50GiB reserve required')
    plan_path=Path(plan_path);receipt=plan_path.parent/'execution-receipt.json'
    with (plan_path.parent/'controller.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        env={**os.environ,**{k:'8'for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','BLIS_NUM_THREADS','NUMBA_NUM_THREADS']},
             'SR215_MASK_CONTROLLER_PID':str(os.getpid()),'PYTHONDONTWRITEBYTECODE':'1'}
        child=None;start=time.monotonic()
        try:
            with (plan_path.parent/'execution.log').open('x')as log,(plan_path.parent/'resource-telemetry.jsonl').open('x')as telemetry:
                child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'run','--plan',str(plan_path),'--approval-file',str(approval_path),'--worker'],
                    env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    process=psutil.Process(child.pid);process.cpu_affinity(process.cpu_affinity()[:8])
                    reason,_=monitor(child,plan,process,psutil,lambda _:shutil.disk_usage(Path(plan['output']).parent),telemetry)
                except psutil.NoSuchProcess:reason=None
                code=child.wait();usage,last=final_usage(plan,start);reason=reason or last
                save(receipt,{'exit_code':code,'stop_reason':reason,**usage,'plan_sha256':sha(plan_path)})
                if code or reason:raise RuntimeError(reason or 'Selected-mask batch failed; preserve diagnostics, no automatic retry')
        except BaseException as error:
            if child is not None and child.poll()is None:stop_group(child)
            if not receipt.exists():save(receipt,{'exit_code':None if child is None else child.poll(),'stop_reason':'Controller exception; no automatic retry',
                'exception_type':type(error).__name__,'exception':str(error),'elapsed_seconds':time.monotonic()-start,'plan_sha256':sha(plan_path)})
            raise
        finally:
            if child is not None and child.poll()is None:stop_group(child)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    prep=sub.add_parser('prepare')
    for name in ['draft','inventory','regional-delivery','source-overlay','prepare-command','metadata-output','output']:
        prep.add_argument('--'+name,type=Path,required=True)
    run=sub.add_parser('run');run.add_argument('--plan',type=Path,required=True);run.add_argument('--approval-file',type=Path,required=True)
    run.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args(argv)
    if args.command=='prepare':print(json.dumps(prepare(args),indent=2))
    elif args.worker:worker(args.plan,args.approval_file)
    else:controller(validate(args.plan,args.approval_file),args.plan,args.approval_file)


if __name__=='__main__':main()
