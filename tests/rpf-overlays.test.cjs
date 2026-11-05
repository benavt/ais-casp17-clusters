'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../rpf.js');
const hash=n=>n.toString(16).padStart(64,'0');
function payload(){return {schema_version:1,target:api.TARGET,sequence_sha256:api.SEQUENCE,score_context:'independent_single_model',models:Array.from({length:2000},(_,i)=>{
 const af=i<1000,ordinal=i%1000;return {model_id:api.TARGET+'__'+(af?'AFSample3':'BioEMU2')+'__'+String(ordinal).padStart(4,'0'),target:api.TARGET,method:af?'afsample3':'bioemu2',ordinal,
  source_sha256:hash(i+1),prepared_sha256:hash(i+2001),recall:.9,precision:.8,dp:i===1999?-.2:.7,ptm:af?.65:null,ptm_source_sha256:af?hash(i+4001):null,seed:af?101:null,sample:af?ordinal:null};})};}
test('RPF joins exact model IDs without changing projections, labels or original arrays; missing methods remain null',()=>{
 const saved=payload(),models=[saved.models[1000].model_id,'unscored_other_method',saved.models[0].model_id],data={target:api.TARGET,models,schemes:[],clusters:['B','X','A'],projections:{umap:{xy:[[1,2],[3,4],[5,6]]}},_source_sha:hash(9)};
 const before=JSON.stringify(data),enriched=api.enrich(data,saved,{source_data_sha256:hash(9),scored_models:2});
 assert.equal(JSON.stringify(data),before);assert.equal(enriched.projections,data.projections);assert.equal(enriched.clusters,data.clusters);
 assert.deepEqual(enriched.schemes.find(s=>s.key==='rpf_dp').values,[.7,null,.7]);
 assert.deepEqual(enriched.schemes.find(s=>s.key==='rpf_dp').range,[-.2,.7]);
 assert(enriched.schemes.every(s=>s.name.includes('full construct')));assert.equal(enriched.rpf_scored_models,2);
 const subset=api.enrich({...data,models:[saved.models[1999].model_id]},saved,{source_data_sha256:hash(9),scored_models:1});
 assert.deepEqual(subset.schemes.find(s=>s.key==='rpf_dp').range,[-.2,.7]);assert.equal(subset.schemes.find(s=>s.key==='rpf_dp').values[0],-.2);
});
test('unknown view bytes, altered source IDs, truncated coverage and invented BioEMU2 confidence fail closed',async()=>{
 const saved=payload(),data={target:api.TARGET,models:saved.models.map(r=>r.model_id),schemes:[],_source_sha:hash(9)};
 const loader=api.createLoader({schema_version:1,observations:{file:'metrics/sr215-rpf.json',sha256:hash(5)},bindings:[{source_data_sha256:hash(8),scored_models:2000}]},async()=>saved);
 const result=await loader.enrich(data);assert.equal(result.rpf_overlay_status,'unavailable');assert.equal(result.schemes,data.schemes);
 for(const altered of [ {...saved,models:saved.models.slice(1)}, {...saved,models:[{...saved.models[0],model_id:'renamed'},...saved.models.slice(1)]}, {...saved,models:saved.models.map((row,i)=>i===1000?{...row,ptm:.8}:row)} ])assert.throws(()=>api.validate(altered));
});
test('coincident printed values are an exact-position count-aware scatter, not jittered confidence substitutes',()=>{
 const saved=payload(),trace=api.scatterTraces(saved,'dp')[0];
 assert.deepEqual(trace.x,[.65]);assert.deepEqual(trace.y,[.7]);assert.deepEqual(trace.marker.size,[1000]);assert.equal(trace.marker.sizemode,'area');
 assert.equal(trace.meta.models,1000);assert.equal(trace.meta.exact_positions,1);assert.equal(trace.meta.maximum_coincident_models,1000);assert.equal(trace.customdata[0][2],null);
 saved.models[1].ptm=.66;const split=api.scatterTraces(saved,'dp')[0];assert.deepEqual(split.marker.size,[999,1]);assert.equal(split.customdata[1][2],saved.models[1].model_id);
 assert.deepEqual(api.ptmRange(saved),[.64,.67]);
});
test('pooled cohort is a distinct, complete three-mask selection while existing target metadata remain unchanged',()=>{
 const original={id:api.TARGET,residue_ranges:[{id:'all',data:'old.json'}]},before=JSON.stringify(original);
 const catalog={cohort:{id:api.COHORT,available:true,residue_ranges:['all','res5-95','res32-47-plus78-99'].map(id=>({id,data:'rpf-sr215/'+id+'/primary.json'}))}};
 assert.equal(api.cohortTarget(original,catalog,'all'),original);const result=api.cohortTarget(original,catalog,api.COHORT);
 assert.equal(result.cohort_id,api.COHORT);assert.equal(result.residue_ranges.length,3);assert.equal(JSON.stringify(original),before);
 assert.throws(()=>api.cohortTarget(original,{cohort:{...catalog.cohort,available:false}},api.COHORT));
});
test('paired violins retain all 2,000 native scores, their source identities and negative DP',()=>{
 const saved=payload(),traces=api.distributionTraces(saved,'dp',{'AFSample3':'#112233'});
 assert.equal(traces.length,2);assert.equal(traces[0].line.color,'#112233');
 for(let i=0;i<2;i++){assert.equal(traces[i].y.length,1000);assert.equal(traces[i].customdata.length,1000);assert.equal(traces[i].spanmode,'hard');assert.equal(traces[i].points,false);}
 assert.equal(traces[1].y[999],-.2);assert.equal(traces[1].customdata[999],saved.models[1999].model_id);
});
test('comparison tabs render only the visible plots and retain focused exact-score axes',async()=>{
 const plots=[],bodies=['distributions','ptm'].map(name=>({dataset:{rpfBody:name}}));
 const buttons=['distributions','ptm'].map(name=>({dataset:{rpfPanel:name},attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}}));
 const nodes=Object.fromEntries(api.METRICS.flatMap(([key])=>['violin','scatter'].map(kind=>[kind+'-'+key,{kind,key,removeAllListeners(){},on(){}}]))),note={};
 const container={dataset:{},querySelector(selector){if(selector==='[data-rpf-note]')return note;const m=selector.match(/data-rpf-(violin|scatter)="([a-z]+)"/);return m?nodes[m[1]+'-'+m[2]]:null;},querySelectorAll(selector){return selector==='[data-rpf-body]'?bodies:buttons;}};
 const render=async(node,traces,layout)=>plots.push({node,traces,layout});
 await api.renderScatters(container,{target:api.TARGET,rpf_overlay_status:'available',rpf_payload:payload(),schemes:[]},render);
 assert.equal(plots.length,3);assert(plots.every(p=>p.node.kind==='violin'));assert.equal(bodies[0].hidden,false);assert.equal(bodies[1].hidden,true);
 await buttons[1].onclick();assert.equal(plots.length,6);assert(plots.slice(3).every(p=>p.node.kind==='scatter'));
 assert.deepEqual(plots[3].layout.xaxis.range,[.64,.66]);assert.equal(buttons[1].tabIndex,0);assert.equal(buttons[0].tabIndex,-1);
 assert(note.textContent.includes('circle area')&&note.textContent.includes('observed score ranges'));
});
