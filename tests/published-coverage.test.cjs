'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{gunzipSync}=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function readFile(file){const p=path.join(root,file);return fs.existsSync(p)?fs.readFileSync(p):execFileSync('git',['-C',root,'show','HEAD:'+file],{maxBuffer:100e6})}
const inventory=JSON.parse(readFile('packed-assets.json')),tracked=new Set(execFileSync('git',['-C',root,'ls-files'],{encoding:'utf8'}).trim().split('\n'));
function artifact(file){const raw=gunzipSync(readFile(file+'.gz')),record=inventory.files[file];assert(record,'Missing inventory record: '+file);assert.equal(raw.length,record.bytes);assert.equal(digest(raw),record.sha256);return raw}
const readJSON=file=>JSON.parse(artifact(file).toString('utf8'));
test('every available analysis has complete Bonsai, medoid TM grids, distance maps and cluster ensemble downloads',async()=>{
 const ranges=readJSON('residue-ranges.json'),catalog=readJSON('figure-supplements.json'),summaries=readJSON('supplementary-metadata.json'),figures=require('../figures.js');
 const context=vm.createContext({console,AbortSignal,Uint8Array,TextDecoder,Response,AISExplorerTMStates:{sha256:digest},window:{addEventListener(){}},document:{getElementById(){}},async fetch(file){return new Response(artifact(file))}});
 vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
 const loader=figures.createLoader(catalog,async file=>readJSON(file));let cases=0;
 for(const [target,entry] of Object.entries(ranges.targets))for(const range of entry.residue_ranges){
  if(range.available===false)continue;
  for(const view of range.views){
   if(view.available===false)continue;cases++;
   context.fixtureTarget={id:target};context.fixtureRange=range;context.fixtureView=view.id;
   const {loaded}=await vm.runInContext('savedViewSelection(fixtureTarget,fixtureRange,fixtureView)',context),out=await loader.enrich(loaded);
   for(const key of ['models','methods','clusters','projections','schemes'])assert.equal(out[key],loaded[key],'Frozen array changed: '+key);
   assert.equal(out._source_sha,loaded._source_sha);assert.equal(out.representatives.length,loaded.representatives.length);
   const membership=new Map(loaded.models.map((name,i)=>[name,loaded.clusters[i]]));
   for(let i=0;i<out.representatives.length;i++){
    const row=out.representatives[i],original=loaded.representatives[i];for(const key of ['cluster','count','color'])assert.equal(row[key],original[key]);
    assert.equal(membership.get(row.model),row.cluster);if(original.file)assert.equal(row.model,original.model,'Existing medoid changed');
    for(const key of ['file','ensemble_file','ensemble_pse']){assert(row[key],target+'/'+range.id+'/'+view.id+' missing '+key+' for '+row.cluster);assert(inventory.files[row[key]],'Missing packed artifact: '+row[key]);assert(fs.existsSync(path.join(root,row[key]+'.gz'))||tracked.has(row[key]+'.gz'),'Missing physical artifact: '+row[key]);}
    if(row.ensemble_models){assert(row.ensemble_models.length>0&&row.ensemble_models.length<=5);assert(row.ensemble_models.includes(row.model));assert(row.ensemble_models.every(name=>membership.get(name)===row.cluster));}
   }
   assert(out.bonsai,target+'/'+range.id+'/'+view.id+' missing Bonsai');const tree=readJSON(out.bonsai.file);assert.equal(tree.models.length,out.bonsai.selected_models);assert.equal(tree.layouts.length,3);assert.equal(new Set(tree.models.map(row=>row.model)).size,tree.models.length);assert(tree.models.every(row=>membership.has(row.model)));
   const label=target+'/'+range.id+'/'+view.id,grid=out.medoid_tm,n=out.representatives.length;
   assert(grid,label+' missing medoid TM grid');assert.equal(JSON.stringify(grid.labels),JSON.stringify(out.representatives.map(row=>row.cluster)));assert.equal(JSON.stringify(grid.models),JSON.stringify(out.representatives.map(row=>row.model)));assert.equal(grid.matrix.length,n);
   for(let i=0;i<n;i++){assert.equal(grid.matrix[i].length,n);for(let j=0;j<n;j++){const value=grid.matrix[i][j];assert(Number.isFinite(value)&&value>=0&&value<=1);assert.equal(value,grid.matrix[j][i]);if(i===j)assert.equal(value,1);}}
   assert.equal(artifact(grid.csv).toString('utf8').trim().split(/\r?\n/).length,n+1,label+' CSV must contain every medoid');
   const summary=summaries.targets?.[target]?.ranges?.[range.id];
   if(summary?.views?.[out.view_id]){
    assert.equal(summary.sample_count,out.models.length,label+' summary population differs');const size=summary.positions.length;assert(size>0);
    const binding=out.views.find(row=>row.id===out.policy_view_id);assert.equal(JSON.stringify(summary.positions),JSON.stringify(binding.canonical_positions),label+' summary mask differs');
    for(const key of ['median_matrix','variance_matrix']){assert.equal(summary[key].length,size);assert(summary[key].every((row,i)=>row.length===size&&row.every((value,j)=>(i===j&&value===null)||(Number.isFinite(value)&&value>=0))),label+' invalid '+key);}
   }else{
    assert.equal(out.heatmaps?.length,2,label+' needs median and variance distance maps');
    for(const image of out.heatmaps){const bytes=readFile(image.file);assert(bytes.length>8);assert.equal(bytes.subarray(1,4).toString(),'PNG',label+' missing image');}
   }
  }
 }
 assert(cases>=16,'The established public views must remain available');
});
