#!/usr/bin/env python3
"""Prepare or explicitly execute the frozen four-target CASP17 HDBSCAN Phase A.

Preparation reads and hashes saved arrays/structures; it never fits or scores.
Execution is opt-in, sequential and private. Complete figures/ensembles and any
publication need a separately approved Phase B after actual label counts exist.
"""
import argparse
from collections import Counter
import copy
import csv
import gzip
import hashlib
import importlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TARGETS = ('BhR2_bmr6717', 'CmR116_bmr17022', 'PaT90_bmr7191', 'StR82_bmr15386')
OPERATION = 'CASP17 four-target saved-Primary 10D UMAP HDBSCAN Phase A'
PACKAGES = ('numpy','scipy','scikit-learn','umap-learn','numba','llvmlite','pynndescent','joblib','threadpoolctl','biopython','pandas','plotly','psutil')
RESOURCES = {'cpus':8,'memory_gib':32,'output_gib':20,'reserve_gib':50,
             'wall_seconds':43200,'gpus':0,'paid_calls':0,'cost_usd':0,'automatic_retries':0}
BOUNDS = {'targets':4,'maximum_HD_refinements_per_target':5,
          'maximum_selection_dimension_pairs_per_target':8,
          'maximum_UMAP_fits':96,'maximum_HDBSCAN_extractions':192,
          'maximum_landmarks_per_target':100,'maximum_directional_USalign_calls':39600,
          'maximum_feature_silhouette_queries_per_target':512,
          'maximum_selected_models_per_representative_group':5,
          'maximum_representative_groups_per_target':800,
          'maximum_representative_CA_RMSD_pairs':32000,
          'new_default_projection_fits':0,'new_default_cluster_fits':0,
          'new_Bonsai_fits':0,'complete_medoid_grid_calls':0,'ensemble_PSE_exports':0}


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(4*1024**2),b''):
            h.update(block)
    return h.hexdigest()


def read(path):
    path=Path(path)
    with (gzip.open(path,'rt') if path.suffix=='.gz' else path.open()) as stream:
        return json.load(stream)


def save(path,value):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as stream:
        json.dump(value,stream,indent=2,allow_nan=False)
        stream.write('\n')


def regular(path):
    path=Path(path).absolute()
    if any(p.is_symlink() for p in [path,*path.parents]) or not path.is_file():
        raise ValueError('Freeze regular files without symlink aliases: '+str(path))
    return path


def fresh(path):
    path=Path(path).absolute()
    if path.exists() or any(p.is_symlink() for p in [path,*path.parents]):
        raise ValueError('New immutable output required; no automatic retry: '+str(path))
    return path


def head(root):
    return subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()


def label_key(label):
    """Numeric lineage order shared with the pinned runtime tie-break."""
    return tuple(int(part) for part in label.removeprefix('C').split('.'))


def aliases(labels):
    result=[]
    for label in labels:
        match=re.fullmatch(r'(?:Cluster |C)([1-9][0-9]*)',label)
        if not match:
            raise ValueError('Unexpected frozen Primary label: '+str(label))
        result.append('C'+match[1])
    return result


def one(paths):
    paths=list(paths)
    if len(paths)!=1:
        raise ValueError('Expected one unambiguous frozen workflow manifest')
    return paths[0]


def source_inventory(roots):
    rows={}
    for root in roots:
        dirty=subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=all','--','src','scripts','config','pyproject.toml','project_support.py'],text=True)
        if dirty.strip():
            raise ValueError('Commit and review source before freezing: '+str(root))
        files=subprocess.check_output(['git','-C',str(root),'ls-files','src','scripts','config','pyproject.toml','project_support.py'],text=True).splitlines()
        for name in files:
            path=regular(root/name)
            rows[str(path)]={'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path)}
    return list(rows.values())


from src.analysis.saved_features import materialize


def prepare(args):
    from src.analysis.casp17_hdbscan import DensitySettings,identity,validate_inputs
    output,metadata=fresh(args.output),fresh(args.metadata_output)
    if not output.parent.is_dir():
        raise ValueError('Scientific output parent must already exist for storage preflight')
    if shutil.disk_usage(output.parent).free < 70*2**30:
        raise ValueError('Need20GiB output plus50GiB free reserve')
    roots=[ROOT,args.density_source.absolute(),args.ensemble_source.absolute()]
    sources=source_inventory(roots)
    inputs={}
    def freeze(path):
        path=regular(path)
        row={'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path)}
        inputs[str(path)]=row
        return row
    entries=[]
    for target in TARGETS:
        manifest=one((args.workflow_root/target/'workflow').glob('*/manifest.json'))
        primary=args.public_atlas/target/'primary.json.gz'
        child_manifest=one((args.nested_root/target/'04_analysis').glob('*/workflow/*/manifest.json'))
        child_csv=child_manifest.parent/'clustering/umap_knn_labels.csv'
        for p in [manifest,primary,child_manifest,child_csv]:freeze(p)
        parent,base,child=read(manifest),read(primary),read(child_manifest)
        names=base['models'];labels=aliases(base['clusters']); positions=parent['terminal_detection']['retained_reference_positions']
        if (base['target']!=target or len(names)!=11000 or parent['structure_count']!=11000
                or len(set(names))!=11000 or len(labels)!=11000
                or Counter(base['methods'])!=dict.fromkeys(set(base['methods']),1000)
                or len(set(base['methods']))!=11
                or child['terminal_detection']['retained_reference_positions']!=positions
                or base['provenance']['saved_workflow_manifest_sha256']!=sha(manifest)):
            raise ValueError('Frozen Primary cohort/methods/mask/provenance mismatch: '+target)
        parent_label=min(Counter(labels),key=lambda l:(-labels.count(l),label_key(l)))
        with child_csv.open() as stream:children=list(csv.DictReader(stream))
        by_name={r['model']:r['cluster_label']for r in children}
        selected={n for n,l in zip(names,labels)if l==parent_label}
        if (len(by_name)!=len(children) or set(by_name)!=selected
                or any(not value.startswith(parent_label+'.') for value in by_name.values())):
            raise ValueError('Saved nested child is not exactly the largest frozen Primary population')
        full_child=[by_name.get(n,l)for n,l in zip(names,labels)]
        child_counts=Counter(by_name.values())
        child_label=min(child_counts,key=lambda l:(-child_counts[l],label_key(l)))
        if len(child_counts)<2:
            raise ValueError('Saved nested workflow does not expose a strict matched child')
        distograms=Path(parent['distogram_dir'])
        for path in sorted(distograms.iterdir()):
            if path.is_file():freeze(path)
        structures=read(distograms/'structure_paths.json')['structures']
        source={r['basename']:r['path']for r in structures}
        if len(source)!=11000 or set(source)!=set(names):
            raise ValueError('Saved original structure inventory does not match Primary')
        members=[]
        for name in names:
            row=freeze(source[name]);members.append({'model':name,'source_path':row['path'],'sha256':row['sha256']})
        # Read-only replay of saved arrays; it calculates no new features or fits.
        features=materialize(parent,names)
        proof=validate_inputs(features,names,labels,positions)
        del features
        scores=next(s['values']for s in base['schemes']if s['key']=='mean_plddt')
        if len(scores)!=11000:
            raise ValueError('Confidence order does not match Primary')
        projections=base['projections']
        for method in ('pca','umap','tsne'):
            if len(projections[method]['xy'])!=11000:
                raise ValueError('Incomplete frozen display coordinates')
            freeze(parent['clustering'][method]['embeddings'])
        entries.append({'target':target,'parent_manifest':str(manifest.absolute()),
            'primary':str(primary.absolute()),'members':members,'scores':scores,
            'models':names,'primary_labels':labels,'feature_proof':proof,
            'display_projections_sha256':identity(projections),
            'matched_populations':[{'name':'Frozen Primary largest parent','parent':parent_label,'labels':labels},
                {'name':'Frozen saved default largest child','parent':child_label,'labels':full_child}],
            'retained_reference_positions':positions,'expected_ca_count':base['residues'],
            'primary_cluster_count':len(set(labels)),'matched_child_manifest':str(child_manifest.absolute())})
    native={'density':{'worktree':str(args.density_source.absolute()),'commit':head(args.density_source)},
            'ensembles':{'worktree':str(args.ensemble_source.absolute()),'commit':head(args.ensemble_source)}}
    freeze(args.usalign.resolve())
    plan={'schema_version':1,'operation':OPERATION,'source':{'worktree':str(ROOT),'commit':head(ROOT)},
        'native_sources':native,'source_files':sources,'frozen_files':list(inputs.values()),
        'runtime':{'host':os.uname().nodename,'python':str(regular(args.python.resolve())),'python_sha256':sha(args.python),
            'usalign':str(regular(args.usalign.resolve())),'usalign_sha256':sha(args.usalign),
            'versions':{name:version(name)for name in PACKAGES}},
        'targets':entries,'settings':DensitySettings().native(),'resources':RESOURCES,'bounds':BOUNDS,
        'output':str(output),'execution_started':False,
        'validation_baseline':'Each frozen Primary partition;512 fixed cluster-stratified feature queries and100 fixed population-weighted stratified landmarks. Unlike SR215 historical prior-recursive strata; inference unchanged. HDBSCAN groups may be unrepresented.',
        'phase_a':['Repeated10D largest nonnoise leaf inference;20D and leaf/EOM seeded diagnostics',
            'Frozen Primary coordinates/masks; no default projection/clustering refit',
            'Method-validation JSON/CSV, memberships, selected-group representative PDBs, private staging only'],
        'phase_b_not_authorized':['Complete medoid TM grids','Bonsai','aligned ensemble/PSE exports','supplementary report figures','public publication'],
        'stop_conditions':['Changed frozen source/runtime/input','Any failed stage; no automatic retry','8CPU/32GiB/20GiB/12h cap or50GiB reserve','Any inference/score/export cap exceeded'],
        'approval_required':'Exact plan SHA256 and source commit, with explicit fresh user approval before execution'}
    metadata.mkdir(parents=True,exist_ok=False)
    save(metadata/'execution-plan.json',plan)
    receipt={'status':'awaiting_exact_scientific_approval','plan_sha256':sha(metadata/'execution-plan.json'),
        'source_commit':plan['source']['commit'],'frozen_files':len(inputs),
        'frozen_bytes':sum(x['bytes']for x in inputs.values()),'resources':RESOURCES,'bounds':BOUNDS,
        'scientific_fits_started':0}
    save(metadata/'status.json',receipt)
    print(json.dumps(receipt,indent=2))


def validate(plan_path,approval_path):
    from src.analysis.casp17_hdbscan import DensitySettings
    plan,approval=read(plan_path),read(approval_path)
    if (approval.get('status')!='approved' or not approval.get('user_message')
            or approval.get('approved_plan_sha256')!=sha(plan_path)
            or approval.get('approved_source_commit')!=plan['source']['commit']):
        raise ValueError('Explicit approval must bind this exact plan SHA and source commit')
    if (plan.get('operation')!=OPERATION or plan.get('schema_version')!=1
            or [r['target']for r in plan['targets']]!=list(TARGETS)
            or plan.get('resources')!=RESOURCES or plan.get('bounds')!=BOUNDS
            or plan.get('settings')!=DensitySettings().native()):
        raise ValueError('Plan scope/settings/resources differ from the reviewed finite procedure')
    if head(ROOT)!=plan['source']['commit']:
        raise ValueError('Approved source head changed')
    for row in plan['source_files']+plan['frozen_files']:
        path=regular(row['path'])
        if path.stat().st_size!=row['bytes'] or sha(path)!=row['sha256']:
            raise ValueError('Frozen source/input changed: '+str(path))
    if plan['runtime'].get('host')!=os.uname().nodename:
        raise ValueError('Approved execution host changed')
    if sha(sys.executable)!=plan['runtime']['python_sha256']:
        raise ValueError('Approved Python changed')
    if sha(plan['runtime']['usalign'])!=plan['runtime']['usalign_sha256']:
        raise ValueError('Approved native USalign changed')
    for package,expected in plan['runtime']['versions'].items():
        if version(package)!=expected:
            raise ValueError('Approved runtime package changed: '+package)
    if set(plan['runtime']['versions'])!=set(PACKAGES):
        raise ValueError('Incomplete numeric runtime inventory')
    for kind,record in plan['native_sources'].items():
        if head(record['worktree'])!=record['commit']:
            raise ValueError('Pinned native source head changed: '+kind)
    expected_sources=source_inventory([ROOT, *[Path(record['worktree']) for record in plan['native_sources'].values()]])
    frozen_sources={row['path']:row for row in plan['source_files']}
    if (len(frozen_sources)!=len(plan['source_files'])
            or frozen_sources!={row['path']:row for row in expected_sources}):
        raise ValueError('Frozen scientific source inventory is incomplete or changed')
    fresh(plan['output'])
    return plan


def bind(plan,kind,module):
    record=plan['native_sources'][kind]
    if head(record['worktree'])!=record['commit']:
        raise ValueError('Pinned native source changed')
    package='_casp17_native_'+kind+'_'+record['commit']
    if package not in sys.modules:
        namespace=types.ModuleType(package)
        namespace.__path__=[str(Path(record['worktree'])/'src/analysis')]
        sys.modules[package]=namespace
    return importlib.import_module(package+'.'+module)


def export_target(plan,entry,result,features,native_density,native_ensembles,root):
    import numpy as np
    from Bio.PDB import PDBIO
    from src.analysis.structure_io import get_first_model
    target=entry['target'];names=entry['models'];labels=result['density'];base=read(entry['primary'])
    if base['models']!=names or len(labels)!=len(names):
        raise ValueError('Export population/order changed')
    root.mkdir(parents=True,exist_ok=False)
    (root/'models').mkdir()
    data=copy.deepcopy(base)
    for key in ['bonsai','medoid_tm','heatmaps','count_review','highlight','bounded_summary',
                'decisions','wave_summary','violin_interactive','violin_pdf','ensemble_kind',
                'representative_loading','variance_palette','variance_legend','regions']:
        data.pop(key,None)
    palette=native_density.lineage_palette(labels)
    data.update(view_id='density',view_title=target+' · HDBSCAN',
        views=[{'id':'density','name':'HDBSCAN','data':'density.json'}],
        clusters=labels,representatives=[],heatmaps=[],medoid_tm=None,
        medoid_tm_note='Complete medoid TM grids, Bonsai, ensemble exports and supplementary figures await a separate approved Phase B; this is private Phase A staging.',
        representative_kind='Selected-group Cα-RMSD medoid on the frozen Primary residue mask',
        representative_policy='Same saved≤5 confidence-selected-group policy; no exhaustive whole-cluster medoid scoring.',
        mask_note='Frozen Primary mask: '+str(len(entry['retained_reference_positions']))+' residues and '+str(features.shape[1])+' raw Cα distance pairs.',
        clustering_method_note='Saved SR21510D UMAP/HDBSCAN largest-leaf refinement procedure; original Primary2D coordinates are display coordinates only.')
    cluster_scheme=next(s for s in data['schemes']if s['key']=='clusters')
    cluster_scheme.update(values=labels,colors=palette)
    store=native_ensembles.EnsembleStore(names,entry['members'],features,entry['scores'],
        entry['retained_reference_positions'],root.parent/'representative-selection',count=5)
    groups=sorted(native_density.structural_labels(labels),key=native_density.label_key)
    if len(groups)>BOUNDS['maximum_representative_groups_per_target']:
        raise ValueError('Representative-group export cap reached')
    for label in groups:
        group=store.group(np.flatnonzero(np.asarray(labels)==label))
        index=group['medoid_index'];filename='models/'+label+'-medoid.pdb'
        scope_name='models/'+label+'-scope.json'
        save(root/scope_name,{'retained_positions':entry['retained_reference_positions'],
            'selection':'Frozen Primary zero-based canonical positions; saved full construct coordinates retained unchanged',
            'source_manifest_sha256':sha(entry['parent_manifest'])})
        writer=PDBIO();writer.set_structure(get_first_model(store.members[names[index]]['source_path']))
        writer.save(str(root/filename))
        data['representatives'].append({'cluster':label,'count':labels.count(label),
            'model':names[index],'method':data['methods'][index],'color':palette[label],
            'file':filename,'scope_file':scope_name,'format':'pdb','sha256':sha(root/filename),
            'selection_policy':group['selection_policy'],'medoid_policy':group['medoid_policy']})
    data['membership_file']='density-memberships.csv'
    with (root/data['membership_file']).open('x',newline='')as stream:
        writer=csv.writer(stream);writer.writerow(['model','cluster']);writer.writerows(zip(names,labels))
    from src.analysis.casp17_hdbscan import identity
    if identity(data['projections'])!=entry['display_projections_sha256']:
        raise ValueError('Frozen Primary display coordinates changed during export')
    data['provenance']={'original_parent_provenance':base['provenance'],
        'density_source_commit':plan['source']['commit'],'density_feature_proof':result['feature_proof'],
        'display_projections':'Unchanged saved Primary2D coordinates; new10D/20D embeddings are inference/diagnostic evidence only.',
        'displayed_cluster_count':len(groups),'unassigned_models':sum(x.endswith('.unassigned')for x in labels),
        'validation_baseline':plan['validation_baseline'],'export_stage':'Phase A private staging; full figure parity pending'}
    save(root/'density.json',data)
    positions=entry['retained_reference_positions']
    save(root/'clustering-residues.json',{'schema_version':1,'targets':{target:{'views':{'density':{
        'chain':'A','canonical_positions':[p+1 for p in positions],
        'expected_ca_count':entry['expected_ca_count'],'reference_ranges':'Saved Primary canonical positions',
        'analysis_uses_full_construct':len(positions)==entry['expected_ca_count'],
        'regions_verified':False,'note':'Exact saved Primary feature mask; no region labels inferred for this analysis.',
        'provenance':{'source_manifest_sha256':sha(entry['parent_manifest'])}}}}}})
    save(root/'atlas.json',{'targets':[{'id':target,'data':'density.json'}]})
    save(root.parent/'delivery-manifest.json',{'files':[{'path':p.relative_to(root).as_posix(),
        'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(root.rglob('*'))if p.is_file()]})


def worker(plan_path,approval_path):
    recorded=os.environ.get('CASP17_DENSITY_CONTROLLER_PID','')
    if not recorded.isdigit() or int(recorded)!=os.getppid() or int(recorded)<=1:
        raise ValueError('Scientific worker requires its approved resource controller')
    # Affinity and controller thread limits precede NumPy/native numerical imports.
    allowed=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,allowed[:RESOURCES['cpus']])
    plan=validate(plan_path,approval_path)
    import numpy as np
    from src.analysis.casp17_hdbscan import run_density,validate_inputs
    native_density=bind(plan,'density','hd_density_experiment')
    native_ensembles=bind(plan,'ensembles','bounded_ensembles')
    candidates=bind(plan,'ensembles','nested_cluster_candidates')
    root=Path(plan['output']);root.mkdir(exist_ok=False)
    scratch=root/'scratch';scratch.mkdir();os.environ['TMPDIR']=str(scratch)
    import tempfile
    tempfile.tempdir=str(scratch)
    started=time.monotonic();results=[]
    def check():
        if time.monotonic()-started>RESOURCES['wall_seconds']:
            raise TimeoutError('Approved12-hour batch limit reached')
    for entry in plan['targets']:
        check();target_root=root/entry['target'];target_root.mkdir()
        parent=read(entry['parent_manifest']);names=entry['models']
        features=materialize(parent,names,check)
        proof=validate_inputs(features,names,entry['primary_labels'],entry['retained_reference_positions'])
        if proof!=entry['feature_proof']:
            raise ValueError('Saved source feature values/order/mask changed')
        lookup={r['model']:r['source_path']for r in entry['members']}
        def landmark_score(ordered_names,pool,directory,positions):
            check()
            if len(pool)>100:
                raise ValueError('Approved native landmark scoring cap exceeded')
            return candidates.score_representative_pool([lookup[n]for n in ordered_names],ordered_names,pool,
                directory,retained_positions=positions,executable=plan['runtime']['usalign'],workers=8,log=print)
        result=run_density(features,names,entry['primary_labels'],entry['retained_reference_positions'],
            target_root/'inference',density=native_density,matched_populations=entry['matched_populations'],
            landmark_score=landmark_score,check=check)
        export_target(plan,entry,result,features,native_density,native_ensembles,target_root/'delivery')
        results.append({'target':entry['target'],'structural_clusters':len(native_density.structural_labels(result['density'])),
            'unassigned_models':sum(x.endswith('.unassigned')for x in result['density']),
            'UMAP_fits':result['UMAP_fits'],'HDBSCAN_extractions':result['HDBSCAN_extractions'],
            'maximum_directional_TM_calls':result['maximum_directional_TM_calls']})
        save(target_root/'complete.json',results[-1]);del features
    save(root/'complete.json',{'status':'private_phase_a_complete_phase_b_pending','plan_sha256':sha(plan_path),
        'source_commit':plan['source']['commit'],'targets':results,'publication_authorized':False})


def controller(plan,plan_path,approval_path):
    import fcntl
    import psutil
    from scripts.run_regional_comparison import monitor,stop_group
    if shutil.disk_usage(Path(plan['output']).parent).free<70*2**30:
        raise ValueError('Need20GiB output and50GiB free reserve')
    with (plan_path.parent/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        env={**os.environ,**{key:'8'for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS']},
             'CASP17_DENSITY_CONTROLLER_PID':str(os.getpid())}
        child=None
        try:
            with (plan_path.parent/'execution.log').open('x')as log,(plan_path.parent/'resource-telemetry.jsonl').open('x')as telemetry:
                child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'run','--plan',str(plan_path),
                    '--approval-file',str(approval_path),'--worker'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    process=psutil.Process(child.pid);process.cpu_affinity(process.cpu_affinity()[:8])
                    reason,elapsed=monitor(child,plan,process,psutil,
                        lambda _:shutil.disk_usage(Path(plan['output']).parent),telemetry)
                except psutil.NoSuchProcess:
                    reason,elapsed=None,0.0
                code=child.wait()
                save(plan_path.parent/'execution-receipt.json',{'exit_code':code,'stop_reason':reason,
                    'elapsed_seconds':elapsed,'plan_sha256':sha(plan_path)})
                if reason or code:
                    raise RuntimeError(reason or 'Phase A failed; preserve all diagnostics, no automatic retry')
        finally:
            if child is not None and child.poll()is None:stop_group(child)


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    prepare_parser=commands.add_parser('prepare')
    for name in ['workflow-root','public-atlas','nested-root','density-source','ensemble-source','usalign','python','metadata-output','output']:
        prepare_parser.add_argument('--'+name,type=Path,required=True)
    run=commands.add_parser('run');run.add_argument('--plan',type=Path,required=True)
    run.add_argument('--approval-file',type=Path,required=True);run.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args)
    elif args.worker:worker(args.plan,args.approval_file)
    else:controller(validate(args.plan,args.approval_file),args.plan,args.approval_file)


if __name__=='__main__':main()
