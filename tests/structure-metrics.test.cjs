'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const api=require('../structure_metrics.js');
const context=vm.createContext({window:{},document:{currentScript:null,baseURI:'https://example.test/'}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rpf_structure.js'),'utf8'),context);const colors=context.window.RpfStructure.colors;
const h=x=>x.repeat(64),ids=['first','second','third'];
function fixture(){
 const models=ids.map((model_id,i)=>({model_id,source_sha256:h(String(i+1)),prepared_sha256:h(String(i+4))}));
 const data={target:'SR215_bmr6366',cohort_id:'afsample3-bioemu2',rpf_overlay_status:'available',phenix_rpf_status:'available',models:ids,
 rpf_payload:{score_context:'independent_single_model',sequence_sha256:h('a'),models,provenance:{rpf_results_sha256:h('b'),experimental_files_sha256:{'input6Q/sr215.bmrb':h('c')}}},
 schemes:['rpf_dp','rpf_recall','rpf_precision','phenix_rpf_dp'].map(key=>({key,type:'continuous',values:key==='phenix_rpf_dp'?[.9,.6,.6]:[-.1,.5,.5]}))};
 const descriptor={_frameBindings:[models[2],models[0]]};
 return {data,descriptor,colors,count:2,mode:'rpf_dp'};
}
function residueFixture(){
 const f=fixture();f.mode='legacy_rpf_heat';
 const layers=api.RESIDUE_IDS.map(id=>({id,missing_color:'#aeb4be',direction:id==='shortest_unsupported_distance'?'lower_worse':'higher_worse',domain:id==='legacy_rpf_heat'?[0,370]:[1,5],colors:['#2166ac','#f7f7f7','#b2182b']}));
 f.residues={schema_version:1,kind:'independent_model_residue_diagnostics',target:f.data.target,sequence_sha256:h('a'),preparation_variant:'reduce',score_context:'independent_single_model',scientific_calls:0,provenance:{rpf_results_sha256:h('b'),chemical_shifts_sha256:h('c')},layers,
 models:f.data.rpf_payload.models.map(r=>({...r,qp_sha256:h('d'),native_archive_sha256:h('e'),values:Array.from({length:4},()=>Array(139).fill(12)),heat_colors:Array(139).fill('#00b9ff')}))};
 return f;
}
test('per-model colors use recorded frame order and displayed ensemble bounds, including negative DP',()=>{
 const f=fixture(),p=api.plan(f);assert.deepEqual(p.domain,[-.1,.5]);assert.equal(p.frameColor(0),'#fde725');assert.equal(p.frameColor(1),'#440154');assert.equal(p.value(0),.5);assert.equal(p.value(1),-.1);
 assert.deepEqual(f.data.schemes[0].values,[-.1,.5,.5]);
});
test('Phenix preparation is an independent score source, never a replacement for Reduce',()=>{
 const f=fixture();f.preparation='phenix';const p=api.plan(f);assert.deepEqual(p.domain,[.6,.9]);assert.equal(p.value(0),.6);assert.equal(p.value(1),.9);
 f.data.phenix_rpf_status='unavailable';assert.throws(()=>api.plan(f),/preparation/);
});
test('ties have the original RPF midpoint color; missing scores remain gray',()=>{
 const f=fixture();f.descriptor._frameBindings=[f.data.rpf_payload.models[1],f.data.rpf_payload.models[2]];const p=api.plan(f);assert.equal(p.frameColor(0),colors.paletteColor(.5,.5,.5));assert.equal(p.frameColor(0),p.frameColor(1));
 f.data.schemes[0].values[1]=null;assert.equal(api.plan(f).frameColor(0),colors.MISSING);
});
test('exact source hash, uniqueness and complete frame count are required',()=>{
 for(const mutate of [f=>f.descriptor._frameBindings.pop(),f=>f.descriptor._frameBindings[0]={...f.descriptor._frameBindings[0],source_sha256:h('f')},f=>f.descriptor._frameBindings[0]=f.descriptor._frameBindings[1],f=>{delete f.descriptor._frameBindings}]){const f=fixture();mutate(f);assert.throws(()=>api.plan(f),/identit|source|ambiguous/)}
});
test('native per-residue RGB is used verbatim with canonical positions and unavailable gray',()=>{
 const f=residueFixture(),p=api.plan(f);assert.equal(p.residueColor(0,1),'#00b9ff');assert.equal(p.residueColor(0,139),'#00b9ff');assert.equal(p.residueColor(0,0),'#aeb4be');f.residues.models[2].values[0][4]=null;assert.equal(p.residueColor(0,5),'#aeb4be');assert.deepEqual(p.domain,[0,370]);
});
test('a diagnostic for another model never leaks into a missing ensemble frame',()=>{
 const f=residueFixture();f.residues.models=f.residues.models.filter(r=>r.model_id!=='third');const p=api.plan(f);assert.equal(p.available,1);assert.equal(p.residueColor(0,1),'#aeb4be');assert.equal(p.residueColor(1,1),'#00b9ff');
});
test('ensemble-averaged, wrong-preparation, wrong-sequence, wrong-source and malformed residue maps fail closed',()=>{
 for(const mutate of [f=>f.residues.score_context='ensemble',f=>f.residues.preparation_variant='phenix',f=>f.residues.sequence_sha256=h('f'),f=>f.residues.models[0].prepared_sha256=h('f'),f=>f.residues.models[0].values[0].pop(),f=>f.residues.models[0].heat_colors.pop(),f=>f.preparation='phenix',f=>f.residues.models.push(f.residues.models[0])]){const f=residueFixture();mutate(f);assert.throws(()=>api.plan(f))}
});
test('RPF count ranges span all displayed model residue values; zero-count colors retain RPF convention',()=>{
 const f=residueFixture();f.mode='precision_violation_groups';f.residues.models[2].values[1][0]=50;f.residues.models[0].values[1][0]=0;const p=api.plan(f);assert.deepEqual(p.domain,[0,50]);assert.equal(p.residueColor(0,1),'#b2182b');assert.equal(p.residueColor(1,1),'#2166ac');
});
test('unmodified public RPF viewer pin keeps palette, missing values and native RGB semantics',()=>{
 const crypto=require('node:crypto'),body=fs.readFileSync(path.join(__dirname,'../assets/rpf_structure.js'));
 assert.equal(crypto.createHash('sha256').update(body).digest('hex'),'4078aca642fe3a59cb2b7ce7d7ff3530fcba6e3970872ff59fd2b861648fd650');
 assert.deepEqual(Array.from(colors.VIRIDIS),['#440154','#3b528b','#21918c','#5ec962','#fde725']);assert.equal(colors.MISSING,'#b9bec7');assert.throws(()=>colors.residueColor({value:1},{id:'legacy_rpf_heat'},[0,370],colors.VIRIDIS),/Native RPF/);
});
