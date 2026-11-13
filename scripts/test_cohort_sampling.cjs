'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
process.chdir(path.join(__dirname,'..'));
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,setAttribute(k,v){this[k]=v},replaceChildren(...children){this.children=children}});return nodes.get(id)}
global.document={getElementById:node,createElement:()=>({})};global.location={hash:''};global.history={replaceState(_a,_b,hash){global.location.hash=hash}};
global.AISUploadedStates={starMeta(data,i){return data.models[i].includes('__260State')?{medoid:data.uploaded_state_medoids?.some(row=>row.model===data.models[i])}:null}};
const api=require('../cohort_sampling.js');
function read(file){return JSON.parse(fs.existsSync(file)?fs.readFileSync(file):zlib.gunzipSync(fs.readFileSync(file+'.gz')))}
const original=read('rpf-overlays.json'),expanded=read('sr215-260-states/catalog.json');
function catalogs(value){if(!value||typeof value!=='object')return [];let out=[];if(value.id==='afsample3-bioemu2'&&value.residue_ranges)out.push(value);for(const child of Object.values(value))if(typeof child==='object')out.push(...catalogs(child));return out}
const legacy=catalogs(original)[0];assert(legacy,'Original cohort catalog missing');
let panelCases=0,projectionCases=0;
for(const [catalog,root,scoresFile]of [[legacy,'analysis-2000','model-scores-2000.json'],[expanded,'analysis','model-scores-2150.json']]){
 const summary=read(root+'/summary.json'),scores=read(root+'/'+scoresFile);assert.equal(summary.masks.length,4);
 for(const range of catalog.residue_ranges)for(const view of range.views){
  const data=read(view.data);data.cohort_id=summary.cohort_id;data.range_id=range.id;
  const context=api.validate(data,summary,scores);
  const fakeSummary=structuredClone(summary);fakeSummary.panels.find(p=>p.mask===range.id).models[0]='outside-cohort';assert.throws(()=>api.validate(data,fakeSummary,scores),/50 distinct models/);
  for(const panel of context.panels){
   const chosen=api.select(context,{state:panel.state,method:panel.method,repeat:panel.repeat});assert.equal(chosen.indices.size,50);assert.deepEqual(chosen.orderedIndices.map(i=>data.models[i]),panel.models);panelCases++;
   global.location.hash='#SR215_bmr6366?sampleState='+panel.state+'&sampleMethod='+panel.method+'&sampleRepeat='+panel.repeat;
   api.mount(data,context,()=>{});assert.deepEqual(api.highlight.orderedIndices.map(i=>data.models[i]),panel.models);assert.equal(node('cohortSampleRepeat').value,String(panel.repeat));
   const scheme={type:'categorical',values:data.models.map(()=> 'hidden')};
   for(const method of ['pca','umap','tsne']){const trace=api.overlay(data,method,scheme,()=>true,new Set());assert.deepEqual(trace.customdata.map(i=>data.models[i]),panel.models);assert(chosen.orderedIndices.every(i=>data.projections[method].xy[i].every(Number.isFinite)));projectionCases++}
   const filtered=api.overlay(data,'umap',scheme,()=>false,new Set(['hidden']));assert.deepEqual(filtered.customdata,chosen.orderedIndices.filter(i=>data.models[i].includes('__260State')));
   api.setBusy(true);assert(node('cohortMCMC').disabled);api.setBusy(false);assert(!node('cohortMCMC').disabled);
   api.clear();assert.equal(api.highlight.active,false);assert.equal(api.overlay(data,'umap',scheme,()=>true,new Set()),null);assert(!global.location.hash.includes('sampleMethod'));
  }
  for(const badRoute of ['sampleMethod=none','sampleMethod=bad','sampleMethod=mcmc50&sampleState=S2&sampleRepeat=1']){global.location.hash='#SR215_bmr6366?'+badRoute;api.mount(data,context,()=>{});assert.equal(api.highlight.active,false);assert.equal(node('cohortSampleState').value,'S1');node('cohortMCMC').onclick();assert.equal(api.highlight.indices.size,50);api.clear()}
  assert.equal(api.select(context,{method:'none'}).active,false);assert.throws(()=>api.select(context,{state:'S2',method:'mcmc50',repeat:1}),/unavailable/);
  if(summary.cohort_models===2000)assert.throws(()=>api.select(context,{state:'S1',method:'mcmc50',repeat:2}),/unavailable/);
 }
}
assert.equal(panelCases,64);assert.equal(projectionCases,192);
console.log(`PASS: ${panelCases} exact panel/view memberships, ${projectionCases} projection render memberships, deep links/repeats, uploaded-star filter policy, busy controls, clear, and invalid IDs/states/repeats.`);
