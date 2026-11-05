import copy, gzip, hashlib, importlib.util, json, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
SPEC=importlib.util.spec_from_file_location('pooled_export',Path(__file__).resolve().parents[1]/'scripts/build_pooled_overlays.py')
mod=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(mod)
sha=lambda b:hashlib.sha256(b).hexdigest()
enc=lambda v:(json.dumps(v,separators=(',',':'))+'\n').encode()
class ExportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);r=Path(self.tmp.name);self.site=r/'site';self.native=r/'native';self.site.mkdir();self.native.mkdir();self.receipt=r/'receipt.json';self.manifest={}
  self.models=['model-'+str(i) for i in range(2000)];self.hashes=[format(i,'064x') for i in range(2000)]
  def write(base,name,body):p=base/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
  self.write=write
  baseline=enc({'models':[{'model_id':m,'source_sha256':h} for m,h in zip(self.models,self.hashes)]});write(self.site,'metrics/sr215-rpf.json',baseline)
  scalar=enc({'models':self.models,'source_sha256':self.hashes,'source_identity_sha256':'c'*64,'sequence_sha256':mod.SEQUENCE});self.scalar=r/'scalar.json';self.scalar.write_bytes(scalar)
  self.phenix=r/'phenix.json';self.phenix.write_bytes(enc({'kind':'verified_phenix_rpf_annotations','preparation_variant':'phenix.reduce','target':mod.TARGET,'sequence_sha256':mod.SEQUENCE,'models':[{'model_id':m,'source_sha256':h} for m,h in zip(self.models,self.hashes)]}));old_phenix=mod.PHENIX_SHA;mod.PHENIX_SHA=sha(self.phenix.read_bytes());self.addCleanup(setattr,mod,'PHENIX_SHA',old_phenix)
  old_reduce,old_scalar=mod.REDUCE_SHA,mod.SCALAR_SHA;mod.REDUCE_SHA=sha(baseline);mod.SCALAR_SHA=sha(scalar);self.addCleanup(setattr,mod,'REDUCE_SHA',old_reduce);self.addCleanup(setattr,mod,'SCALAR_SHA',old_scalar)
  self.old_native=gzip.compress(b'original native bytes',mtime=0);write(self.site,'old/structure.pdb.gz',self.old_native);self.old_registry={'schema_version':1,'files':{'old/structure.pdb':{'sha256':sha(b'original native bytes'),'bytes':21,'content_type':'chemical/x-pdb'}}};write(self.site,'packed-assets.json',enc(self.old_registry))
  def register(name,body):write(self.native,name,body);self.manifest[name]={'sha256':sha(body),'bytes':len(body)}
  catalog={'cohort':{'residue_ranges':[]}}
  for rid,nstates,eligible in [('all',20,10),('res5-95',21,11),('res32-47-plus78-99',26,6)]:
   views={};entries=[]
   for view in ['primary','density']:
    name=f'rpf-sr215/{rid}/{view}.json';body=enc({'target':mod.TARGET,'view_id':view,'models':self.models});write(self.site,name,body);views[view]=sha(body);entries.append({'id':view,'data':name,'source_data_sha256':sha(body)})
   catalog['cohort']['residue_ranges'].append({'id':rid,'views':entries})
   p={'kind':'hdbscan_cluster_selection_payload','target':mod.TARGET,'cohort_id':mod.COHORT,'range_id':rid,'sequence_sha256':mod.SEQUENCE,'construct_residues':139,'models':self.models,'source_sha256':self.hashes,'view_bindings':views,'source_density_sha256':views['density'],'energy':{'model_metrics_sha256':mod.SCALAR_SHA},'bonsai_policy':{'geometry_scope':'method_selected_union','state_highlighting':True},'states':[],'all_states':{}}
   cursor=0
   for s in range(nstates):
    state={'id':'H'+str(s+1).zfill(2),'model_count':60 if s<eligible else 15,'eligible_50':s<eligible,'selections':{}};members=list(range(cursor,cursor+state['model_count']));cursor+=state['model_count']
    for method in (['mcmc50','disco50'] if s<eligible else ['allmembers']):
     ids=members[:50] if s<eligible else members;choice={'models':[self.models[i] for i in ids],'models_count':len(ids)}
     for ext,field in [('pdb','ensemble'),('pse','session')]:
      name=f'hdbscan-ensembles/{mod.TARGET}/{mod.COHORT}/{rid}/{state["id"]}/{method}.{ext}';body=(name+'\n').encode();register(name,body);choice[field]={'file':name,**self.manifest[name],'models_count':len(ids)}
     state['selections'][method]=choice
    p['states'].append(state)
   for method in ['mcmc50','disco50']:
    models=[m for s in p['states'] for m in s['selections'][method if s['eligible_50'] else 'allmembers']['models']];name=f'hdbscan-bonsai/{mod.TARGET}/{mod.COHORT}/{rid}/{method}.json';body=enc({'models':[{'model':m} for m in models]});register(name,body);p['all_states'][method]={'models':models,'bonsai':{'file':name,**self.manifest[name],'models_count':len(models),'geometry_scope':'method_selected_union'}}
   register(f'hdbscan-states/{mod.TARGET}/{mod.COHORT}/{rid}.json',enc(p))
  write(self.site,'rpf-overlays.json',enc(catalog));self.manifest_path=r/'manifest.json';self.manifest_path.write_bytes(enc({'files':self.manifest}));self.manifest_sha=sha(self.manifest_path.read_bytes())
 def build(self,**kwargs):return mod.build(self.site,self.scalar,self.native,self.manifest_path,self.manifest_sha,self.receipt,min_free_bytes=0,**kwargs)
 def test_native_gzip_delivery_restores_every_byte_and_preserves_original_assets(self):
  out=self.build();self.assertEqual(out['native_artifacts'],188);self.assertEqual(out['bonsai_descriptors'],6);self.assertEqual((self.site/'old/structure.pdb.gz').read_bytes(),self.old_native);registry=json.loads((self.site/'packed-assets.json').read_bytes());self.assertEqual(registry['files']['old/structure.pdb'],self.old_registry['files']['old/structure.pdb'])
  for name,entry in self.manifest.items():
   if name.endswith(('.pdb','.pse')) or name.startswith('hdbscan-bonsai/'):
    self.assertFalse((self.site/name).exists());body=gzip.decompress((self.site/(name+'.gz')).read_bytes());self.assertEqual(sha(body),entry['sha256']);self.assertEqual(len(body),entry['bytes']);self.assertEqual(registry['files'][name]['sha256'],entry['sha256'])
  self.assertEqual(out['packed_delivery_files'],194);self.assertEqual(len(registry['files']),195);self.assertTrue(out['storage']['all_native_restore_hashes_verified']);self.assertTrue(out['storage']['all_bonsai_restore_hashes_verified']);self.assertTrue(out['storage']['no_raw_native_duplicates_published'])
  trees=[name for name in self.manifest if name.startswith('hdbscan-bonsai/')];self.assertEqual(len(trees),6)
  for name in trees:self.assertEqual(registry['files'][name]['content_type'],'application/json')
  self.assertEqual(out['storage']['bonsai_uncompressed_bytes'],sum(self.manifest[name]['bytes'] for name in trees))
  for name in trees:self.assertEqual((self.site/(name+'.gz')).read_bytes(),mod.packed_bytes((self.native/name).read_bytes()))
 def test_bad_native_hash_and_quota_fail_without_mutating_old_served_assets(self):
  native=next(name for name in self.manifest if name.endswith('.pdb'));(self.native/native).write_bytes(b'changed');before=(self.site/'packed-assets.json').read_bytes()
  with self.assertRaisesRegex(ValueError,'changed'):self.build()
  self.assertEqual((self.site/'packed-assets.json').read_bytes(),before);self.assertFalse((self.site/'hdbscan-ensembles').exists());self.assertFalse(self.receipt.exists())
 def test_export_quota_is_checked_before_new_public_files_are_written(self):
  with self.assertRaisesRegex(ValueError,'quota'):self.build(max_site_bytes=1)
  self.assertFalse((self.site/'hdbscan-ensembles').exists());self.assertFalse(self.receipt.exists())
 def test_source_mutation_between_manifest_validation_and_staging_preserves_served_site(self):
  target=next(name for name in self.manifest if name.endswith('.pdb'));before={str(p.relative_to(self.site)):p.read_bytes() for p in self.site.rglob('*') if p.is_file()};pack=mod.packed_bytes;mutated=False
  def mutate_then_pack(body):
   nonlocal mutated
   if not mutated:
    source=self.native/target;source.write_bytes(source.read_bytes()+b'changed after validation');mutated=True
   return pack(body)
  with patch.object(mod,'packed_bytes',mutate_then_pack):
   with self.assertRaisesRegex(ValueError,'changed after manifest verification'):self.build()
  self.assertTrue(mutated);self.assertEqual({str(p.relative_to(self.site)):p.read_bytes() for p in self.site.rglob('*') if p.is_file()},before);self.assertFalse(self.receipt.exists())
 def test_colors_only_phase_has_no_native_paths_or_reads_and_keeps_original_bytes(self):
  before_registry=(self.site/'packed-assets.json').read_bytes();baseline=(self.site/'metrics/sr215-rpf.json').read_bytes()
  out=mod.build_colors(self.site,self.scalar,self.phenix,self.receipt,min_free_bytes=0);catalog=json.loads((self.site/'pooled-overlays.json').read_bytes())
  self.assertFalse(catalog['selections_ready']);self.assertEqual(out['native_files_published'],0);self.assertFalse((self.site/'hdbscan-ensembles').exists());self.assertTrue(all(not r['available'] and set(r['view_bindings'])=={'primary','density'} and 'file' not in r for r in catalog['ranges'].values()));self.assertEqual((self.site/'packed-assets.json').read_bytes(),before_registry);self.assertEqual((self.site/'metrics/sr215-rpf.json').read_bytes(),baseline)
 def test_pending_to_ready_transition_requires_same_accepted_scalars_and_source_bindings(self):
  mod.build_colors(self.site,self.scalar,self.phenix,self.receipt,min_free_bytes=0);old_scalar=(self.site/'metrics/sr215-pooled-model-metrics.json').read_bytes();old_phenix=(self.site/'metrics/sr215-rpf-phenix.json').read_bytes();self.receipt=self.receipt.with_name('full-receipt.json')
  out=self.build(phenix=self.phenix,expected_phenix_sha=mod.PHENIX_SHA);catalog=json.loads((self.site/'pooled-overlays.json').read_bytes());self.assertTrue(catalog['selections_ready']);self.assertEqual(out['native_artifacts'],188);self.assertEqual((self.site/'metrics/sr215-pooled-model-metrics.json').read_bytes(),old_scalar);self.assertEqual((self.site/'metrics/sr215-rpf-phenix.json').read_bytes(),old_phenix)
  bad=copy.deepcopy(catalog);bad['model_metrics']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'catalog differs'):mod.write_catalog(self.site,bad)

if __name__=='__main__':unittest.main()
