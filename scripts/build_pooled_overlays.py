#!/usr/bin/env python3
"""Export reviewed saved annotations, HDBSCAN subsets and native Bonsai only.

No scoring, sampling, fitting, alignment or coordinate conversion occurs here.
Native ensemble bytes use the site's existing verified gzip delivery registry.
"""
import argparse, copy, gzip, hashlib, io, json, os, shutil, tempfile
from pathlib import Path, PurePosixPath
TARGET='SR215_bmr6366';COHORT='afsample3-bioemu2'
RANGES=('all','res5-95','res32-47-plus78-99')
SCALAR_SHA='90beabf46a1e0b2c062aa0b3f223c731d9c9a5815cd5b46ab55be6c792f07676'
PHENIX_SHA='327731fe2820e57f868b29e5833aa872ecbc8d5dcd89d32146b17cf7c6432248'
REDUCE_SHA='bd09553a7e06bf1a8ed21d901ea36a1303d4706b39ff972928c30300e701a4b4'
SEQUENCE='7ab896059b4577bbcfc7cf9db00493b1bc9cea4bee282239195085658fe77f13'
sha=lambda body:hashlib.sha256(body).hexdigest()
def read_json(path):
 b=Path(path).read_bytes();return json.loads(gzip.decompress(b) if b[:2]==b'\x1f\x8b' else b)
def safe(name):
 p=PurePosixPath(name)
 if not isinstance(name,str) or p.is_absolute() or '..' in p.parts or '\\' in name or not p.parts:raise ValueError('Unsafe public relative path')
 return name
def write_new(site,name,body):
 p=site/safe(name)
 if p.is_symlink() or any(q.is_symlink() for q in p.parents):raise ValueError('Public destination is a symlink')
 p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():
  if p.read_bytes()!=body:raise ValueError('Preserve differing existing artifact: '+name)
 else:
  with p.open('xb') as f:f.write(body)
def write_catalog(site,catalog):
 name='pooled-overlays.json';body=(json.dumps(catalog,indent=2)+'\n').encode();p=site/name
 if not p.exists() or p.read_bytes()==body:return write_new(site,name,body)
 old=read_json(p)
 stable=['schema_version','kind','target','cohort_id','sequence_sha256','source_identity_sha256','model_metrics','phenix_rpf']
 if old.get('selections_ready') is not False or catalog.get('selections_ready') is not True or any(old.get(k)!=catalog.get(k) for k in stable) or any(old['ranges'].get(r,{}).get('view_bindings')!=catalog['ranges'].get(r,{}).get('view_bindings') for r in RANGES):raise ValueError('Existing catalog differs beyond the reviewed pending-to-ready transition')
 if p.is_symlink():raise ValueError('Pooled catalog is a symlink')
 tmp=p.with_name('.pooled-overlays.export.tmp')
 with tmp.open('xb') as f:f.write(body)
 os.replace(tmp,p)

def packed_bytes(body):
 out=io.BytesIO()
 with gzip.GzipFile(fileobj=out,filename='',mode='wb',mtime=0,compresslevel=9) as f:f.write(body)
 return out.getvalue()
def materialize(site,name):
 p=site/safe(name)
 return p.read_bytes() if p.is_file() else gzip.decompress(Path(str(p)+'.gz').read_bytes())
def build(site,scalar,native_root,native_manifest,expected_native_sha,receipt,phenix=None,expected_phenix_sha=None,max_site_bytes=950000000,min_free_bytes=1073741824):
 site=Path(site);native_root=Path(native_root);receipt=Path(receipt)
 if receipt.resolve().is_relative_to(site.resolve()) or receipt.exists():raise ValueError('Preserve a fresh receipt outside the served tree')
 raw_scalar=Path(scalar).read_bytes()
 if sha(raw_scalar)!=SCALAR_SHA:raise ValueError('Scalar source differs from the reviewed audited payload')
 metrics=json.loads(raw_scalar);reduce_raw=(site/'metrics/sr215-rpf.json').read_bytes()
 if sha(reduce_raw)!=REDUCE_SHA:raise ValueError('Preserve the original Reduce payload')
 baseline=json.loads(reduce_raw);source={r['model_id']:r['source_sha256'] for r in baseline['models']}
 if len(metrics['models'])!=2000 or len(set(metrics['models']))!=2000 or any(source.get(m)!=h for m,h in zip(metrics['models'],metrics['source_sha256'])):raise ValueError('Scalar IDs/source hashes do not match the exact original cohort')
 if metrics['sequence_sha256']!=SEQUENCE:raise ValueError('Pooled sequence identity differs')
 raw_phenix=None
 if phenix:
  raw_phenix=Path(phenix).read_bytes()
  if expected_phenix_sha!=PHENIX_SHA or sha(raw_phenix)!=PHENIX_SHA:raise ValueError('Phenix payload differs from accepted review')
  variant=json.loads(raw_phenix)
  if variant['kind']!='verified_phenix_rpf_annotations' or variant['preparation_variant']!='phenix.reduce' or variant['target']!=TARGET or variant['sequence_sha256']!=SEQUENCE or len(variant['models'])!=2000 or any(source.get(r['model_id'])!=r['source_sha256'] for r in variant['models']):raise ValueError('Phenix source identity differs')
 receipt.parent.mkdir(parents=True,exist_ok=True)
 site_before=sum(p.stat().st_size for p in site.rglob('*') if p.is_file())
 free_before=shutil.disk_usage(site).free
 if site_before>max_site_bytes or free_before<min_free_bytes:raise ValueError('Export quota/free-space guard failed before staging')
 manifest_body=Path(native_manifest).read_bytes()
 if sha(manifest_body)!=expected_native_sha:raise ValueError('Native public manifest differs from accepted review')
 manifest=json.loads(manifest_body)['files'];observed={};selected=set()
 def artifact(name):
  safe(name);p=native_root/name
  if p.is_symlink() or any(q.is_symlink() for q in p.parents):raise ValueError('Native source path is a symlink')
  info=manifest.get(name)
  if not info:raise ValueError('Artifact is not in the accepted public manifest: '+name)
  body=p.read_bytes()
  if len(body)!=info['bytes'] or sha(body)!=info['sha256']:raise ValueError('Native artifact changed: '+name)
  selected.add(name);observed[name]={'bytes':len(body),'sha256':sha(body)};return body
 catalog={'schema_version':1,'kind':'pooled_model_overlay_catalog','target':TARGET,'cohort_id':COHORT,'sequence_sha256':SEQUENCE,'source_identity_sha256':metrics['source_identity_sha256'],'selections_ready':True,'model_metrics':{'file':'metrics/sr215-pooled-model-metrics.json','sha256':SCALAR_SHA,'model_count':2000},'ranges':{}}
 rpf_catalog=read_json(site/'rpf-overlays.json');tree_paths=[];native_paths=[]
 for range_entry in rpf_catalog['cohort']['residue_ranges']:
  rid=range_entry['id']
  if rid not in RANGES:raise ValueError('Unexpected pooled residue selection')
  views={}
  for view in range_entry['views']:
   body=materialize(site,view['data'])
   if sha(body)!=view['source_data_sha256']:raise ValueError('Saved pooled projection bytes differ')
   views[view['id']]=sha(body)
  name=f'hdbscan-states/{TARGET}/{COHORT}/{rid}.json';body=artifact(name);p=json.loads(body)
  if (p['kind']!='hdbscan_cluster_selection_payload' or p['target']!=TARGET or p['cohort_id']!=COHORT or p['range_id']!=rid or p['sequence_sha256']!=SEQUENCE or p['construct_residues']!=139 or p['models']!=metrics['models'] or p['source_sha256']!=metrics['source_sha256'] or p['view_bindings']!=views or p['source_density_sha256']!=views['density'] or p['energy']['model_metrics_sha256']!=SCALAR_SHA):raise ValueError('HDBSCAN subset source identities differ')
  if p['bonsai_policy']['geometry_scope']!='method_selected_union' or p['bonsai_policy']['state_highlighting'] is not True:raise ValueError('Only the reviewed six overview trees are supported')
  catalog['ranges'][rid]={'file':name,'sha256':sha(body),'source_density_sha256':p['source_density_sha256'],'view_bindings':views}
  for state in p['states']:
   methods=['mcmc50','disco50'] if state['eligible_50'] else ['allmembers']
   for method in methods:
    choice=state['selections'][method];expected_count=50 if state['eligible_50'] else state['model_count']
    if choice['models_count']!=expected_count or len(choice['models'])!=expected_count or len(set(choice['models']))!=expected_count:raise ValueError('Subset count/uniqueness differs')
    for ext,field in [('pdb','ensemble'),('pse','session')]:
     item=choice[field];expected=f'hdbscan-ensembles/{TARGET}/{COHORT}/{rid}/{state["id"]}/{method}.{ext}'
     if item['file']!=expected or item['models_count']!=expected_count:raise ValueError('Ensemble binding differs')
     raw=artifact(item['file'])
     if sha(raw)!=item['sha256'] or len(raw)!=item['bytes']:raise ValueError('Ensemble descriptor differs')
     native_paths.append(item['file'])
  for method in ['mcmc50','disco50']:
   choice=p['all_states'][method];tree=choice['bonsai'];name=tree['file']
   if not name.startswith(f'hdbscan-bonsai/{TARGET}/{COHORT}/{rid}/') or not name.endswith('.json') or tree['geometry_scope']!='method_selected_union':raise ValueError('Overview tree namespace differs')
   raw=artifact(name);tree_payload=json.loads(raw)
   if sha(raw)!=tree['sha256'] or len(raw)!=tree['bytes'] or [r['model'] for r in tree_payload['models']]!=choice['models'] or len(choice['models'])!=tree['models_count']:raise ValueError('Overview geometry does not match exact method-union IDs')
   tree_paths.append(name)
 if set(catalog['ranges'])!=set(RANGES):raise ValueError('All three pooled masks are required')
 if len(tree_paths)!=6 or len(native_paths)!=188:raise ValueError('Expected six method-overview descriptors and 94 native ensemble pairs')
 packed_paths=set(native_paths+tree_paths)
 if any((site/name).exists() for name in packed_paths):raise ValueError('Preserve raw native duplicates and select a fresh served export destination')
 registry_path=site/'packed-assets.json';old_registry=read_json(registry_path);registry=copy.deepcopy(old_registry);files=registry['files'];writes=[]
 # Stage only compressed/native-delivery bytes. Raw scientific files remain on
 # their existing host/path and never get duplicated into the served namespace.
 with tempfile.TemporaryDirectory(prefix='pooled-delivery-',dir=str(receipt.parent)) as temp_dir:
  staged=[]
  for name in sorted(selected):
   body=(native_root/name).read_bytes()
   if name in packed_paths:
    if len(body)>67108864:raise ValueError('Native artifact exceeds the reviewed 64 MiB delivery bound')
    descriptor={'sha256':sha(body),'bytes':len(body),'content_type':'chemical/x-pdb' if name.endswith('.pdb') else 'application/json' if name in tree_paths else 'application/octet-stream'}
    if name in files and files[name]!=descriptor:raise ValueError('Existing packed native entry differs')
    files[name]=descriptor;physical=name+'.gz';delivery=packed_bytes(body)
    restored=gzip.decompress(delivery)
    if len(restored)!=len(body) or sha(restored)!=sha(body):raise ValueError('Packed native bytes failed exact restore verification')
    info={'path':physical,'bytes':len(delivery),'sha256':sha(delivery),'logical_file':name,'logical_sha256':sha(body),'logical_bytes':len(body),'packed_kind':'bonsai_overview' if name in tree_paths else 'native_ensemble'}
   else:physical=name;delivery=body;info={'path':name,**observed[name]}
   stage=Path(temp_dir)/physical;stage.parent.mkdir(parents=True,exist_ok=True);stage.write_bytes(delivery);staged.append((physical,stage,info))
   if shutil.disk_usage(site).free<min_free_bytes:raise ValueError('Export free-space guard failed during compressed staging')
  staged.extend([('metrics/sr215-pooled-model-metrics.json',None,{'body':raw_scalar})])
  if raw_phenix is not None:
   staged.append(('metrics/sr215-rpf-phenix.json',None,{'body':raw_phenix}));catalog['phenix_rpf']={'file':'metrics/sr215-rpf-phenix.json','sha256':expected_phenix_sha,'model_count':2000}
  catalog_body=(json.dumps(catalog,indent=2)+'\n').encode();staged.append(('pooled-overlays.json',None,{'body':catalog_body}))
  if any(registry['files'].get(k)!=v for k,v in old_registry['files'].items()):raise ValueError('Original packed registry entries changed')
  old_hash=sha(registry_path.read_bytes());registry_body=(json.dumps(registry,separators=(',',':'))+'\n').encode()
  added_bytes=sum((stage.stat().st_size if stage else len(info['body'])) for physical,stage,info in staged if not (site/physical).exists())
  projected=site_before+added_bytes+len(registry_body)-registry_path.stat().st_size
  if projected>max_site_bytes or shutil.disk_usage(site).free<added_bytes+min_free_bytes:raise ValueError('Packed site would exceed export quota/free-space reserve')
  for physical,stage,info in staged:
   delivery=stage.read_bytes() if stage else info['body'];write_catalog(site,catalog) if physical=='pooled-overlays.json' else write_new(site,physical,delivery)
   if info.get('logical_file'):
    restored=gzip.decompress((site/physical).read_bytes())
    if sha(restored)!=info['logical_sha256'] or len(restored)!=info['logical_bytes']:raise ValueError('Written native delivery failed exact restore verification')
   writes.append({k:v for k,v in info.items() if k!='body'} if stage else {'path':physical,'bytes':len(delivery),'sha256':sha(delivery)})
  if registry_path.is_symlink():raise ValueError('Packed registry is a symlink')
  temp=registry_path.with_name('.packed-assets.export.tmp')
  with temp.open('xb') as f:f.write(registry_body)
  os.replace(temp,registry_path)
 site_after=sum(p.stat().st_size for p in site.rglob('*') if p.is_file());free_after=shutil.disk_usage(site).free
 if site_after>max_site_bytes or free_after<min_free_bytes:raise ValueError('Final packed-site quota/free-space guard failed')
 proof={'status':'exported_saved_artifacts_only','scientific_execution':False,'scalar_payload_sha256':SCALAR_SHA,'original_reduce_payload_sha256':REDUCE_SHA,'accepted_native_manifest_sha256':expected_native_sha,'logical_native_ensembles':94,'native_artifacts':188,'bonsai_descriptors':6,'packed_delivery_files':194,'selected_native_source_files':sorted(selected),'unreferenced_manifest_files_not_published':sorted(set(manifest)-selected),'writes':writes,'original_packed_entries_preserved':len(old_registry['files']),'packed_registry_before_sha256':old_hash,'packed_registry_after_sha256':sha(registry_body),'storage':{'site_before_bytes':site_before,'site_after_bytes':site_after,'max_site_bytes':max_site_bytes,'free_before_bytes':free_before,'free_after_bytes':free_after,'min_free_bytes':min_free_bytes,'native_uncompressed_bytes':sum(w.get('logical_bytes',0) for w in writes if w.get('packed_kind')=='native_ensemble'),'native_delivery_gzip_bytes':sum(w['bytes'] for w in writes if w.get('packed_kind')=='native_ensemble'),'bonsai_uncompressed_bytes':sum(w.get('logical_bytes',0) for w in writes if w.get('packed_kind')=='bonsai_overview'),'bonsai_delivery_gzip_bytes':sum(w['bytes'] for w in writes if w.get('packed_kind')=='bonsai_overview'),'no_raw_native_duplicates_published':True,'all_native_restore_hashes_verified':True,'all_bonsai_restore_hashes_verified':True}}
 receipt.parent.mkdir(parents=True,exist_ok=True)
 with receipt.open('x') as f:json.dump(proof,f,indent=2);f.write('\n')
 return proof

def build_colors(site,scalar,phenix,receipt,max_site_bytes=950000000,min_free_bytes=1073741824):
 site=Path(site);receipt=Path(receipt)
 if receipt.exists() or receipt.resolve().is_relative_to(site.resolve()):raise ValueError('Select a fresh receipt outside the served tree')
 scalar_body=Path(scalar).read_bytes();phenix_body=Path(phenix).read_bytes();reduce_body=(site/'metrics/sr215-rpf.json').read_bytes()
 if sha(scalar_body)!=SCALAR_SHA or sha(phenix_body)!=PHENIX_SHA or sha(reduce_body)!=REDUCE_SHA:raise ValueError('Colors-only inputs differ from accepted scalar/Phenix/Reduce hashes')
 metrics=json.loads(scalar_body);variant=json.loads(phenix_body);baseline=json.loads(reduce_body);source={r['model_id']:r['source_sha256'] for r in baseline['models']}
 if len(metrics['models'])!=2000 or len(set(metrics['models']))!=2000 or len(variant['models'])!=2000 or any(source.get(m)!=h for m,h in zip(metrics['models'],metrics['source_sha256'])) or any(source.get(r['model_id'])!=r['source_sha256'] for r in variant['models']):raise ValueError('Colors-only model/source identity differs')
 catalog={'schema_version':1,'kind':'pooled_model_overlay_catalog','target':TARGET,'cohort_id':COHORT,'sequence_sha256':SEQUENCE,'source_identity_sha256':metrics['source_identity_sha256'],'selections_ready':False,'model_metrics':{'file':'metrics/sr215-pooled-model-metrics.json','sha256':SCALAR_SHA,'model_count':2000},'phenix_rpf':{'file':'metrics/sr215-rpf-phenix.json','sha256':PHENIX_SHA,'model_count':2000},'ranges':{}}
 for r in read_json(site/'rpf-overlays.json')['cohort']['residue_ranges']:
  views={}
  for v in r['views']:
   body=materialize(site,v['data'])
   if sha(body)!=v['source_data_sha256']:raise ValueError('Pooled source view differs')
   views[v['id']]=sha(body)
  catalog['ranges'][r['id']]={'available':False,'view_bindings':views,'source_density_sha256':views['density']}
 if set(catalog['ranges'])!=set(RANGES):raise ValueError('All six actual source view bindings are required')
 before=sum(p.stat().st_size for p in site.rglob('*') if p.is_file());free=shutil.disk_usage(site).free
 catalog_body=(json.dumps(catalog,indent=2)+'\n').encode();artifacts={'metrics/sr215-pooled-model-metrics.json':scalar_body,'metrics/sr215-rpf-phenix.json':phenix_body,'pooled-overlays.json':catalog_body}
 added=sum(len(b) for name,b in artifacts.items() if not (site/name).exists())
 if before+added>max_site_bytes or free<added+min_free_bytes:raise ValueError('Colors-only quota/free-space guard failed')
 for name,b in artifacts.items():write_new(site,name,b)
 after=sum(p.stat().st_size for p in site.rglob('*') if p.is_file())
 proof={'status':'exported_verified_colors_only','selections_ready':False,'native_files_published':0,'scientific_execution':False,'reduce_payload_unchanged_sha256':REDUCE_SHA,'scalar_payload_sha256':SCALAR_SHA,'phenix_payload_sha256':PHENIX_SHA,'bindings':6,'writes':[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in artifacts.items()],'storage':{'site_before_bytes':before,'site_after_bytes':after,'max_site_bytes':max_site_bytes,'free_before_bytes':free,'free_after_bytes':shutil.disk_usage(site).free,'min_free_bytes':min_free_bytes}}
 receipt.parent.mkdir(parents=True,exist_ok=True)
 with receipt.open('x') as f:json.dump(proof,f,indent=2);f.write('\n')
 return proof

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['site','scalar','phenix','receipt']:p.add_argument('--'+name,type=Path,required=True)
 p.add_argument('--colors-only',action='store_true');p.add_argument('--native-root',type=Path);p.add_argument('--native-manifest',type=Path);p.add_argument('--native-manifest-sha')
 p.add_argument('--max-site-bytes',type=int,default=950000000);p.add_argument('--min-free-bytes',type=int,default=1073741824);p.add_argument('--phenix-sha',default=PHENIX_SHA)
 a=p.parse_args()
 if a.colors_only:r=build_colors(a.site,a.scalar,a.phenix,a.receipt,a.max_site_bytes,a.min_free_bytes)
 else:
  if not all([a.native_root,a.native_manifest,a.native_manifest_sha]):p.error('Verified native root, manifest and accepted SHA are required to enable selections')
  r=build(a.site,a.scalar,a.native_root,a.native_manifest,a.native_manifest_sha,a.receipt,a.phenix,a.phenix_sha,a.max_site_bytes,a.min_free_bytes)
 print(json.dumps({k:r[k] for k in ['status','selections_ready'] if k in r}))
if __name__=='__main__':main()
