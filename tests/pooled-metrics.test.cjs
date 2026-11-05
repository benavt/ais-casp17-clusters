const test=require('node:test'),assert=require('node:assert/strict');
global.AISExplorerTMStates=require('../tm_states.js');const api=require('../pooled_metrics.js');
function fixture(){
 const models=Array.from({length:2000},(_,i)=>'SR215_bmr6366__'+(i<1000?'AFSample3':'BioEMU2')+'__'+String(i%1000).padStart(4,'0')),hashes=models.map((_,i)=>i.toString(16).padStart(64,'0')),methods=models.map((_,i)=>i<1000?'afsample3':'bioemu2');
 const schemes=[{key:'protein_ebm_energy_t10',values:models.map((_,i)=>4000+i/100),range:[4000,4019.99],model_version:6,time_index:10,time_value:.1,units:'arbitrary',lower_is_better:true},{key:'mean_plddt',values:models.map((_,i)=>i<1000?80:null),range:[80,80]},{key:'ptm',values:models.map((_,i)=>i<1000?.7:null),range:[.7,.7]},{key:'tm_colabfold12_rank1_chainA_res5_95',values:models.map(()=>.8),range:[.8,.8]}].map(s=>({...s,type:'continuous',name:s.key,range_scope:'Fixed complete pooled cohort'}));
 const payload={schema_version:1,kind:'verified_saved_pooled_scalar_annotations',target:api.TARGET,sequence_sha256:api.SEQUENCE,models,source_sha256:hashes,methods,schemes};
 const sha='a'.repeat(64),data={target:api.TARGET,cohort_id:api.COHORT,range_id:'all',view_id:'density',policy_view_id:'density',visible_view_policy:true,_source_sha:sha,views:[{id:'density',source_data_sha256:sha}],models,clusters:models.map(()=> 'C1'),projections:{},schemes:[{key:'rpf_dp',values:models.map(()=>.8)}],rpf_overlay_status:'available',rpf_payload:{models:models.map((model_id,i)=>({model_id,method:methods[i],source_sha256:hashes[i]}))}};
 const catalog={schema_version:1,kind:'pooled_model_overlay_catalog',target:api.TARGET,cohort_id:api.COHORT,model_metrics:{file:'metrics/sr215-pooled-model-metrics.json',sha256:'b'.repeat(64)},ranges:{all:{view_bindings:{density:sha}}}};
 return{data,payload,catalog};
}
test('source-verified pooled scalar annotations retain all values, nulls, RPF and original scientific arrays',()=>{
 const {data,payload,catalog}=fixture(),before=JSON.stringify(data),out=api.enrich(data,payload,catalog);assert.equal(JSON.stringify(data),before);assert.equal(out.models,data.models);assert.equal(out.clusters,data.clusters);assert.equal(out.projections,data.projections);assert.equal(out.schemes[0],data.schemes[0]);
 assert.equal(out.schemes.length,5);for(const key of ['ptm','mean_plddt']){const s=out.schemes.find(s=>s.key===key);assert.equal(s.values.filter(Number.isFinite).length,1000);assert.equal(s.values.filter(v=>v===null).length,1000)}
 assert.equal(out.schemes.find(s=>s.key==='protein_ebm_energy_t10').metric_scope_count,139);assert.match(out.schemes.find(s=>s.key==='tm_colabfold12_rank1_chainA_res5_95').metric_note,/fixed.*5–95/);
});
test('equal labels cannot replace original coordinate identity and BioEMU2 cannot acquire native confidence',()=>{
 for(const change of [p=>p.source_sha256[0]='f'.repeat(64),p=>p.models[1]=p.models[0],p=>p.schemes.find(s=>s.key==='ptm').values[1000]=0,p=>p.schemes[0].time_value=.2]){const {data,payload,catalog}=fixture();change(payload);assert.throws(()=>api.enrich(data,payload,catalog))}
 const {data,payload,catalog}=fixture();data._source_sha='d'.repeat(64);assert.throws(()=>api.enrich(data,payload,catalog),/binding/);
});
test('all six pooled views share fixed cohort bounds while original 11k loader path remains untouched',async()=>{
 const {data,payload,catalog}=fixture();for(const range of ['all','res5-95','res32-47-plus78-99'])for(const view of ['primary','density']){catalog.ranges[range]={view_bindings:{[view]:data._source_sha}};const d={...data,range_id:range,view_id:view,policy_view_id:view,views:[{id:view,source_data_sha256:data._source_sha}]};const out=api.enrich(d,payload,catalog);assert.deepEqual(out.schemes.slice(1).map(s=>s.range),payload.schemes.map(s=>s.range))}
 const old={...data,cohort_id:'all'},loader=api.createLoader(catalog,()=>{throw Error('No old-cohort read')});assert.equal(await loader.enrich(old),old);
});
