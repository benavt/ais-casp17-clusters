'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
require('../phenix_rpf.js');
const api=require('../rpf.js'),root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name))),baseline=read('metrics/sr215-rpf.json'),phenix=read('metrics/sr215-rpf-phenix.json'),catalog=read('pooled-overlays.json');
const pair=()=>api.matchedPreparations(baseline,phenix),context=()=>({target:api.TARGET,rpf_overlay_status:'available',rpf_payload:baseline,schemes:[],models:baseline.models.map(r=>r.model_id)});

test('both exact preparations retain all matched rows, distinct provenance and the unchanged native pTM source',()=>{
 const before=[JSON.stringify(baseline),JSON.stringify(phenix)],p=pair(),lookup=new Map(phenix.models.map(r=>[r.model_id,r]));
 assert.equal(p.payloads.reduce,baseline);assert.equal(p.payloads.phenix.preparation,phenix.preparation);assert.equal(p.payloads.phenix.native_RPF_engine,phenix.native_RPF_engine);assert.equal(p.payloads.phenix.provenance,phenix.provenance);
 assert.notEqual(phenix.native_RPF_engine.binary_sha256,baseline.provenance.native_rpf_binary_sha256);
 for(const [i,row]of p.payloads.phenix.models.entries()){
  const old=baseline.models[i],saved=lookup.get(old.model_id);assert.equal(row.model_id,old.model_id);assert.equal(row.source_sha256,old.source_sha256);assert.equal(row.prepared_sha256,saved.prepared_sha256);
  for(const key of ['recall','precision','dp'])assert.equal(row[key],saved[key]);
  assert.equal(row.ptm,old.ptm);assert.equal(row.ptm_source_sha256,old.ptm_source_sha256);
 }
 for(const prep of ['reduce','phenix'])for(const [key]of api.METRICS){
  const traces=api.distributionTraces(p.payloads[prep],key);assert.deepEqual(traces.map(t=>t.y.length),[1000,1000]);
  for(const [i,method]of ['afsample3','bioemu2'].entries())assert.deepEqual(traces[i].y,p.payloads[prep].models.filter(r=>r.method===method).map(r=>r[key]));
 }
 assert.deepEqual(before,[JSON.stringify(baseline),JSON.stringify(phenix)]);
});

test('shared violin bounds include both methods; pTM score/color bounds include only matched AFSample3 rows',()=>{
 const p=pair();assert.deepEqual(p.bounds.violin,{recall:[.92,.97],precision:[.88,.95],dp:[.61,.83]});assert.deepEqual(p.bounds.ptm,{recall:[.95,.97],precision:[.9,.95],dp:[.7,.83]});assert.deepEqual(p.native_ptm_range,[.63,.76]);
 for(const prep of ['reduce','phenix'])for(const [key]of api.METRICS){const t=api.scatterTraces(p.payloads[prep],key,{range:p.bounds.ptm[key]})[0];assert.deepEqual([t.marker.cmin,t.marker.cmax],p.bounds.ptm[key]);}
 assert(Math.abs(api.axisRange(p.bounds.ptm.dp,'ptm')[0]-.6883)<1e-12);assert(Math.abs(api.axisRange(p.bounds.violin.dp)[0]-.577)<1e-12);
});

test('native confidence is never deduplicated or imputed; exact-position bubble counts follow the selected scores',()=>{
 const p=pair(),expected={reduce:[24,43,68],phenix:[24,41,67]},maxima={reduce:[225,220,123],phenix:[237,182,165]};
 for(const prep of ['reduce','phenix'])for(const [index,[key]]of api.METRICS.entries()){
  const t=api.scatterTraces(p.payloads[prep],key)[0];assert.equal(t.x.length,expected[prep][index]);assert.equal(t.meta.maximum_coincident_models,maxima[prep][index]);assert.equal(t.marker.size.reduce((a,b)=>a+b,0),1000);assert.equal(t.marker.sizemode,'area');
  const groups=new Map();for(const row of p.payloads[prep].models.filter(r=>r.method==='afsample3')){const id=JSON.stringify([row.ptm,row[key]]);groups.set(id,(groups.get(id)||0)+1)}
  t.x.forEach((x,i)=>assert.equal(t.marker.size[i],groups.get(JSON.stringify([x,t.y[i]]))));
 }
 const missing=structuredClone(baseline);missing.models[0].ptm=null;const result=api.matchedPreparations(missing,phenix);
 for(const prep of ['reduce','phenix'])assert.equal(api.scatterTraces(result.payloads[prep],'dp')[0].meta.models,999);
 assert(result.payloads.phenix.models.filter(r=>r.method==='bioemu2').every(r=>r.ptm===null));
});

test('cached comparison loading works in both cohorts and rejects mismatched source/prepared/engine identities',async()=>{
 let reads=0;const loader=api.createComparisonLoader(catalog,async(file,sha)=>{reads++;assert.equal(file,'metrics/sr215-rpf-phenix.json');assert.equal(sha,'327731fe2820e57f868b29e5833aa872ecbc8d5dcd89d32146b17cf7c6432248');return phenix});
 for(const cohort of ['all','afsample3-bioemu2']){const data={...context(),cohort_id:cohort,models:Array(cohort==='all'?11000:2000).fill('view model')};assert.equal((await loader.load(data)).status,'available')}
 assert.equal(reads,1);
 for(const mutate of [p=>p.models[0].source_sha256=baseline.models[1].source_sha256,p=>p.models[0].baseline_prepared_sha256='f'.repeat(64),p=>p.models[0].model_id=p.models[1].model_id,p=>p.native_RPF_engine.output_contract='old-contract',p=>p.experimental_input_sha256[Object.keys(p.experimental_input_sha256)[0]]='f'.repeat(64)]){
  const altered=structuredClone(phenix);mutate(altered);assert.throws(()=>api.matchedPreparations(baseline,altered));
  const bad=await api.createComparisonLoader(catalog,async()=>altered).load(context());assert.equal(bad.status,'unavailable');assert.match(bad.note,/unavailable/i);
 }
});

function controls(){
 const notes={preparation:{},distribution:{},scatter:{},title:{}},links={observations:{}};for(const kind of ['distribution','ptm'])for(const ext of ['svg','png'])links[kind+'-'+ext]={};
 const bodies=['distributions','ptm'].map(rpfBody=>({dataset:{rpfBody}})),tabs=['distributions','ptm'].map(rpfPanel=>({dataset:{rpfPanel},setAttribute(){},focus(){}})),choices=['reduce','phenix'].map(rpfPreparation=>({dataset:{rpfPreparation},checked:rpfPreparation==='reduce'}));
 const nodes=Object.fromEntries(api.METRICS.flatMap(([key])=>['violin','scatter'].map(kind=>[kind+'-'+key,{kind,key,removeAllListeners(){},on(){}}])));
 const c={dataset:{},querySelector(q){
  if(q==='[data-rpf-preparation-note]')return notes.preparation;if(q==='[data-rpf-distribution-note]')return notes.distribution;if(q==='[data-rpf-note]')return notes.scatter;if(q==='#rpfComparisonTitle')return notes.title;if(q==='[data-rpf-observation-download]')return links.observations;
  let m=q.match(/data-rpf-(distribution|ptm)-download="(svg|png)"/);if(m)return links[m[1]+'-'+m[2]];m=q.match(/data-rpf-(violin|scatter)="([a-z]+)"/);return m?nodes[m[1]+'-'+m[2]]:null;
 },querySelectorAll(q){return q==='[data-rpf-body]'?bodies:q==='[data-rpf-preparation]'?choices:tabs}};
 return {c,notes,links,bodies,tabs,choices};
}

test('one independent preparation choice changes both panels, exact arrays, labels and selected exports while retaining view state',async()=>{
 const f=controls(),p=pair(),plots=[],data=context(),before=JSON.stringify(data),loader={load:async()=>p},render=async(node,traces,layout)=>plots.push({node,traces,layout});
 await api.renderScatters(f.c,data,render,null,loader);assert.equal(f.c.dataset.rpfPreparation,'reduce');assert.deepEqual(plots[0].traces[0].y,baseline.models.filter(r=>r.method==='afsample3').map(r=>r.recall));const violinRange=plots[2].layout.yaxis.range;
 f.choices[1].checked=true;await f.choices[1].onchange();assert.equal(f.c.dataset.rpfPreparation,'phenix');assert.match(f.notes.title.textContent,/phenix.reduce/);assert.match(f.notes.preparation.textContent,/different recorded RPF scorers/);assert.match(f.notes.preparation.textContent,/cannot be attributed solely/);assert.equal(f.links.observations.href,'metrics/sr215-rpf-phenix.json');assert.match(f.links.observations.textContent,/phenix.reduce.*JSON/);
 assert.deepEqual(plots[3].traces[0].y,p.payloads.phenix.models.filter(r=>r.method==='afsample3').map(r=>r.recall));assert.deepEqual(plots[5].layout.yaxis.range,violinRange);assert.match(f.links['distribution-svg'].href,/sr215-rpf-preparation-violin.svg$/);
 await f.tabs[1].onclick();assert.equal(f.c.dataset.rpfPreparation,'phenix');const scatterRange=plots.at(-1).layout.yaxis.range;assert.match(f.links['ptm-svg'].href,/sr215-afsample3-ptm-rpf-phenix.svg$/);assert.match(f.links['ptm-svg'].textContent,/phenix.reduce/);assert.match(f.notes.scatter.textContent,/BioEMU2.*excluded/);
 f.choices[0].checked=true;await f.choices[0].onchange();assert.equal(f.c.dataset.rpfView,'ptm');assert.deepEqual(plots.at(-1).layout.yaxis.range,scatterRange);assert.match(f.links['ptm-png'].href,/reduce-matched.png$/);assert.equal(f.links.observations.href,'metrics/sr215-rpf.json');
 f.choices[1].checked=true;await f.choices[1].onchange();await api.renderScatters(f.c,{...data,range_id:'res5-95',models:data.models.slice(0,50)},render,null,loader);assert.equal(f.c.dataset.rpfPreparation,'phenix');assert.equal(plots.at(-1).traces[0].meta.models,1000);assert.equal(JSON.stringify(data),before);
});

test('URL state is shareable without rewriting point-color or HDBSCAN parameters',async()=>{
 const oldLocation=global.location,oldHistory=global.history;let url;
 try{global.location={href:'https://example.org/atlas/?color=ptm#SR215_bmr6366?range=all&hdb_state=H03',search:'?color=ptm'};global.history={replaceState(a,b,value){url=new URL(value,global.location.href);global.location.href=url.href;global.location.search=url.search}};
  const f=controls(),loader={load:async()=>pair()};await api.renderScatters(f.c,context(),async()=>{},null,loader);f.choices[1].checked=true;await f.choices[1].onchange();assert.equal(url.searchParams.get('rpf_preparation'),'phenix');assert.equal(url.searchParams.get('color'),'ptm');assert.equal(url.hash,'#SR215_bmr6366?range=all&hdb_state=H03');assert.equal(api.preparationFromSearch(url.search),'phenix');
  f.choices[0].checked=true;await f.choices[0].onchange();assert(!url.searchParams.has('rpf_preparation'));assert.equal(url.searchParams.get('color'),'ptm');
 }finally{global.location=oldLocation;global.history=oldHistory;}
});

test('a stale async render cannot replace a newer choice; unmatched Phenix never renders foreign values',async()=>{
 const f=controls(),p=pair(),pending=[],plots=[],loader={load:()=>new Promise(resolve=>pending.push(resolve))},render=async(node,traces)=>plots.push(traces);
 const old=api.renderScatters(f.c,context(),render,null,loader);f.c.dataset.rpfPreparation='phenix';const current=api.renderScatters(f.c,context(),render,null,loader);pending[1](p);await current;pending[0](p);await old;assert.equal(plots.length,3);
 const unavailable=controls();unavailable.c.dataset.rpfPreparation='phenix';await api.renderScatters(unavailable.c,context(),()=>assert.fail('Foreign Phenix values rendered'),null,{load:async()=>({status:'unavailable',note:'Preparation comparison unavailable: source mismatch'})});assert(unavailable.bodies.every(b=>b.hidden));assert(unavailable.choices[1].disabled);assert.match(unavailable.notes.preparation.textContent,/source mismatch/);
});
