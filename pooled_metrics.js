/* Source-bound scalar annotations for the pooled cohort; never scores or ranks. */
(function(root){'use strict';
const TARGET='SR215_bmr6366',COHORT='afsample3-bioemu2',SEQUENCE='7ab896059b4577bbcfc7cf9db00493b1bc9cea4bee282239195085658fe77f13';
const KEYS=['protein_ebm_energy_t10','mean_plddt','ptm','tm_colabfold12_rank1_chainA_res5_95'];
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),need=(x,m)=>{if(!x)throw Error(m)};
function sourceBinding(data,catalog){
 need(data.target===TARGET&&data.cohort_id===COHORT,'Pooled metric target/cohort differs.');
 const entry=catalog?.ranges?.[data.range_id],view=data.policy_view_id||data.view_id,binding=data.views?.find(v=>v.id===view);
 need(data.visible_view_policy===true&&hash(data._source_sha)&&binding?.source_data_sha256===data._source_sha&&entry?.view_bindings?.[view]===data._source_sha,'Pooled metric view binding differs.');
 return entry;
}
function validate(payload,data){
 need(payload?.schema_version===1&&payload.kind==='verified_saved_pooled_scalar_annotations'&&payload.target===TARGET&&payload.sequence_sha256===SEQUENCE&&(payload.cohort_id===undefined||payload.cohort_id===COHORT),'Pooled metric sequence/target differs.');
 const n=2000,identity=new Map(data.rpf_payload?.models?.map(r=>[r.model_id,r])||[]);
 need(data.rpf_overlay_status==='available'&&data.models.length===n&&identity.size===n,'Verified original model identities are unavailable.');
 need(Array.isArray(payload.models)&&payload.models.length===n&&new Set(payload.models).size===n&&Array.isArray(payload.source_sha256)&&payload.source_sha256.length===n,'Pooled metric source identities are incomplete.');
 for(const [i,id]of payload.models.entries())need(identity.get(id)?.source_sha256===payload.source_sha256[i]&&hash(payload.source_sha256[i]),'Pooled metric model/source hash join differs.');
 need(data.models.every(id=>identity.has(id)&&payload.models.includes(id)),'Pooled metric cohort differs.');
 if(payload.model_order_sha256!==undefined)need(root.AISExplorerTMStates.sha256(new TextEncoder().encode(JSON.stringify(payload.models)))===payload.model_order_sha256,'Pooled metric model-order hash differs.');
 if(payload.methods!==undefined)need(Array.isArray(payload.methods)&&payload.methods.length===n&&payload.methods.every((m,i)=>m===identity.get(payload.models[i]).method),'Pooled metric method identity differs.');
 need(Array.isArray(payload.schemes)&&payload.schemes.length===KEYS.length&&new Set(payload.schemes.map(s=>s.key)).size===payload.schemes.length&&KEYS.every(key=>payload.schemes.some(s=>s.key===key)),'Pooled scalar observations are incomplete.');
 const index=new Map(payload.models.map((id,i)=>[id,i]));
 return payload.schemes.map(saved=>{
  need(KEYS.includes(saved.key)&&saved.type==='continuous'&&Array.isArray(saved.values)&&saved.values.length===n&&saved.values.every(v=>v===null||Number.isFinite(v)),'Unsupported pooled scalar values.');
  const finite=saved.values.filter(Number.isFinite);need(finite.length>0&&Array.isArray(saved.range)&&saved.range.length===2&&saved.range.every(Number.isFinite)&&saved.range[0]<=Math.min(...finite)&&saved.range[1]>=Math.max(...finite)&&typeof saved.range_scope==='string'&&saved.range_scope.length>0,'Pooled scalar color bounds are unbound.');
  if(['ptm','mean_plddt'].includes(saved.key))need(saved.values.every((v,i)=>identity.get(payload.models[i]).method==='bioemu2'?v===null:Number.isFinite(v)&&v>=0&&v<=(saved.key==='ptm'?1:100)),'Native confidence cannot be imputed to BioEMU2.');
  if(['protein_ebm_energy_t10','tm_colabfold12_rank1_chainA_res5_95'].includes(saved.key))need(finite.length===n,'Saved energy/reference similarity is incomplete.');
  if(saved.key==='protein_ebm_energy_t10')need(saved.model_version===6&&saved.time_index===10&&saved.time_value===.1&&saved.lower_is_better===true&&saved.units==='arbitrary','Saved ProteinEBM interpretation differs.');
  const values=data.models.map(id=>saved.values[index.get(id)]),energy=saved.key==='protein_ebm_energy_t10';
  const note=energy?(root.AISExplorerMetrics?.SCOPE_NOTE||'Saved ProteinEBM model 6 energy, t=0.10, full 139-residue construct; lower is better, arbitrary units.'):saved.key==='tm_colabfold12_rank1_chainA_res5_95'?'Saved TM similarity to the fixed ColabFold reference on canonical residues 5–95. The same score is reused across clustering masks; it is not prediction confidence.':saved.key==='ptm'?'Source-verified native AFSample3 pTM. BioEMU2 has no native pTM and remains gray.':saved.key==='mean_plddt'?'Source-verified native AFSample3 all-atom mean pLDDT. BioEMU2 has no native pLDDT and remains gray.':saved.metric_note||'Saved source-verified model annotation.';
  return {...saved,...(saved.key==='tm_colabfold12_rank1_chainA_res5_95'?{name:'TM to ColabFold reference · fixed 5–95',short_name:'TM · fixed 5–95'}:{}),values,colorscale:saved.colorscale||'Viridis',metric_note:note,...(energy?{metric_scope_count:139}:{}),scale_scope:saved.range_scope};
 });
}
function enrich(data,payload,catalog){
 sourceBinding(data,catalog);const added=validate(payload,data);
 need(!added.some(s=>data.schemes.some(old=>old.key===s.key)),'Pooled scalar key collides with an existing observation.');
 return {...data,schemes:[...data.schemes,...added],pooled_metric_status:'available',pooled_metric_payload:payload};
}
async function checkedBytes(file,expected,bytes=null){
 const r=await root.fetch(file,{cache:'no-cache',signal:AbortSignal.timeout(30000)});need(r.ok,'Saved pooled artifact is unavailable.');const body=new Uint8Array(await r.arrayBuffer());
 need(bytes===null||body.length===bytes,'Saved pooled artifact size differs.');need(root.AISExplorerTMStates?.sha256(body)===expected,'Saved pooled artifact hash differs.');return body;
}
function createLoader(catalog,reader=async(file,sha)=>JSON.parse(new TextDecoder().decode(await checkedBytes(file,sha)))){
 const enabled=catalog?.schema_version===1&&catalog.kind==='pooled_model_overlay_catalog'&&catalog.target===TARGET&&catalog.cohort_id===COHORT,cache=new Map();
 return {enabled,async enrich(data){if(data.cohort_id!==COHORT)return data;try{
  need(enabled,'Saved pooled scalar catalog is unavailable.');sourceBinding(data,catalog);const entry=catalog.model_metrics;
  need(entry&&entry.file==='metrics/sr215-pooled-model-metrics.json'&&hash(entry.sha256),'Pooled metric payload is unsafe or unhashed.');
  const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
  return enrich(data,await cache.get(key),catalog);
 }catch(error){return {...data,pooled_metric_status:'unavailable',pooled_metric_note:'Saved pooled metrics unavailable: '+error.message}}}};
}
const api={TARGET,COHORT,SEQUENCE,KEYS,hash,need,sourceBinding,validate,enrich,checkedBytes,createLoader};root.AISExplorerPooledMetrics=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
