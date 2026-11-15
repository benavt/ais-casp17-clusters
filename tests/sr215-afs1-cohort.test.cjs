'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{gunzipSync}=require('node:zlib');
const root=path.resolve(__dirname,'..'),packed=JSON.parse(fs.readFileSync(path.join(root,'packed-assets.json'))),external=JSON.parse(fs.readFileSync(path.join(root,'external-assets.json')));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(logical){const raw=gunzipSync(fs.readFileSync(path.join(root,logical+'.gz'))),record=packed.files[logical];assert(record);assert.equal(raw.length,record.bytes);assert.equal(digest(raw),record.sha256);return JSON.parse(raw)}

test('the relaxed AFS1 plus AFS3 catalog binds all accepted 7,000-model views and assets',()=>{
 const catalog=read('sr215-afs1-afs3/catalog.json');assert.equal(catalog.id,'afs1-relaxed-afs3-7000');assert.equal(catalog.models,7000);
 assert.deepEqual(catalog.residue_ranges.map(row=>row.id),['all','res5-95','res32-47-plus78-99','res32-47-plus78-99-plus121-139']);
 let representatives=0,parts=0;
 for(const range of catalog.residue_ranges){assert.equal(range.views.length,2);for(const view of range.views){
  const data=read(view.data);assert.equal(data.cohort_id,catalog.id);assert.equal(data.range_id,range.id);assert.equal(data.view_id,view.source_view_id);assert.equal(data.models.length,7000);assert.equal(data.models.length,new Set(data.models).size);assert.equal(packed.files[view.data].sha256,view.source_data_sha256);
  assert.equal(data.schemes.find(row=>row.key==='ais_method').values.length,7000);assert.equal(data.schemes.find(row=>row.key==='protein_ebm_energy_t10').values.length,7000);
  assert(external.files[view.asset_root+'/'+data.membership_file]);assert(external.files[view.asset_root+'/'+data.bonsai.file]);
  for(const row of data.representatives){representatives++;assert(external.files[view.asset_root+'/'+row.file]);for(const part of row.ensemble_downloads||[]){parts++;assert.equal(part.sha256.length,64);assert(part.bytes>0);}}
 }}
 assert.equal(representatives,376);assert.equal(parts,507);
});

test('multipart ensemble links resolve to immutable, scope-unique release assets',()=>{
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8'),context=vm.createContext({console,URLSearchParams,location:{hash:''},window:{addEventListener(){}},document:{getElementById(){}}});vm.runInContext(source,context);
 context.location.hash='#SR215_bmr6366?range=res32-47-plus78-99-plus121-139&view=density&cohort=afs1-relaxed-afs3-7000';assert.equal(vm.runInContext('hashSelection().cohort',context),'afs1-relaxed-afs3-7000');
 const catalog=read('sr215-afs1-afs3/catalog.json'),range=catalog.residue_ranges[3],view=range.views.find(row=>row.id==='density'),raw=read(view.data);context.raw=raw;context.range=range;
 const prepared=vm.runInContext('prepareRangeAnalysis(raw,{...range,asset_root:range.views[1].asset_root})',context),files=prepared.representatives.flatMap(row=>row.ensemble_downloads||[]).map(row=>row.file);
 assert(files.length>0);assert.equal(files.length,new Set(files).size);assert(files.every(file=>file.startsWith('https://github.com/benavt/sr215-cohort-atlas/releases/download/sr215-afs1-afs3-7000-v1/')));assert(files.every(file=>file.includes(encodeURIComponent(range.id+'--density--'))));
});
