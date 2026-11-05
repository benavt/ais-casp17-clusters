/* Saved HDBSCAN-cluster subsets/trees for the pooled cohort. No browser fitting. */
(function(root){'use strict';
const TARGET='SR215_bmr6366',COHORT='afsample3-bioemu2',METHODS=['mcmc50','disco50'],DEFAULTS={state_id:'none',method:'mcmc50'};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=v=>typeof v==='string'&&/^H[0-9]{2,4}$/.test(v),need=(v,m)=>{if(!v)throw Error(m)};
const digest=value=>root.AISExplorerTMStates.sha256(new TextEncoder().encode(JSON.stringify(value)));
function unique(indices,n,count=null){need(Array.isArray(indices)&&(count===null||indices.length===count)&&indices.every((v,i)=>Number.isInteger(v)&&v>=0&&v<n&&(i===0||v>indices[i-1])),'Saved cluster indices are not unique canonical source order.');}
function sourceBinding(data,catalog){const range=catalog?.ranges?.[data.range_id],view=data.policy_view_id||data.view_id,binding=data.views?.find(v=>v.id===view);need(data.cohort_id===COHORT&&data.target===TARGET&&data.visible_view_policy===true&&hash(data._source_sha)&&binding?.source_data_sha256===data._source_sha&&range?.view_bindings?.[view]===data._source_sha,'HDBSCAN subset view binding differs.');return range;}
function artifact(a,range,state,method,ext){
 need(a&&a.file===`hdbscan-ensembles/${TARGET}/${COHORT}/${range}/${state}/${method}.${ext}`&&hash(a.sha256)&&Number.isInteger(a.bytes)&&a.bytes>0&&a.bytes<=67108864&&Number.isInteger(a.models_count)&&a.models_count>0,'Unsafe or unhashed HDBSCAN ensemble artifact.');return a;
}
function bonsaiDescriptor(a,p,models){
 need(a&&typeof a.file==='string'&&a.file.startsWith(`hdbscan-bonsai/${TARGET}/${COHORT}/${p.range_id}/`)&&/^[A-Za-z0-9_./-]+\.json$/.test(a.file)&&!a.file.split('/').includes('..')&&hash(a.sha256)&&Number.isInteger(a.bytes)&&a.bytes>0&&a.models_count===models.length,'Invalid saved selection Bonsai descriptor.');
 need(a.geometry_scope==='method_selected_union'&&a.model_order_sha256===digest(models)&&a.selected_set_sha256===digest([...models].sort())&&a.source_density_sha256===p.source_density_sha256&&JSON.stringify(a.canonical_positions)===JSON.stringify(p.canonical_positions),'Bonsai selected-set or mask binding differs.');return a;
}
function choice(value,p,members,count,method,state){
 need(value&&value.models_count===count,'Saved subset count differs.');unique(value.indices,p.models.length,count);need(value.indices.every(i=>members.has(i)),'Saved subset crosses a HDBSCAN cluster.');
 need(Array.isArray(value.models)&&Array.isArray(value.source_sha256)&&value.models.every((v,i)=>v===p.models[value.indices[i]])&&value.models.length===count&&value.source_sha256.length===count&&value.source_sha256.every((v,i)=>v===p.source_sha256[value.indices[i]]),'Saved subset coordinate identities differ.');
 if(state){artifact(value.ensemble,p.range_id,state,method,'pdb');artifact(value.session,p.range_id,state,method,'pse');need(value.ensemble.models_count===count&&value.session.models_count===count,'Ensemble/model count differs.');}
 if(state===null)bonsaiDescriptor(value.bonsai,p,value.models);return value;
}
function selectionFor(state,method){need(METHODS.includes(method),'Unknown HDBSCAN sampling method.');return state.selections[state.eligible_50?method:'allmembers'];}
function validatePayload(p,entry,catalog,data){
 const binding=sourceBinding(data,catalog),n=2000;
 need(p?.schema_version===1&&p.kind==='hdbscan_cluster_selection_payload'&&p.target===TARGET&&p.cohort_id===COHORT&&p.range_id===data.range_id&&p.construct_residues===139&&p.sequence_sha256===data.rpf_payload?.sequence_sha256,'HDBSCAN subset scope differs.');
 need(hash(p.source_density_sha256)&&p.source_density_sha256===binding.source_density_sha256&&p.source_density_sha256===p.view_bindings?.density&&['primary','density'].every(v=>p.view_bindings[v]===binding.view_bindings[v]),'HDBSCAN density-source binding differs.');
 need(JSON.stringify(p.canonical_positions)===JSON.stringify(data.clustering_positions),'HDBSCAN clustering mask differs.');
 need(data.pooled_metric_status==='available'&&p.energy?.scheme_key==='protein_ebm_energy_t10'&&p.energy.model_version===6&&p.energy.conditioning_t===.1&&p.energy.energy_scope==='full_construct'&&p.energy.scoring_residues===139&&p.energy.model_metrics_sha256===catalog.model_metrics.sha256,'Sampled energy source differs from the verified scalar annotations.');
 need(Array.isArray(p.models)&&p.models.length===n&&p.models.every((m,i)=>m===data.models[i])&&p.model_order_sha256===digest(p.models)&&Array.isArray(p.source_sha256)&&p.source_sha256.length===n,'HDBSCAN model order differs.');
 const identity=new Map(data.rpf_payload.models.map(r=>[r.model_id,r.source_sha256]));need(p.source_sha256.every((h,i)=>hash(h)&&identity.get(p.models[i])===h),'HDBSCAN original coordinate identity differs.');
 need(p.bonsai_policy?.geometry_scope==='method_selected_union'&&p.bonsai_policy.state_highlighting===true,'Bonsai geometry must use the saved active-method selection union.');
 need(Array.isArray(p.states)&&p.states.length>0,'No saved HDBSCAN cluster subsets.');const used=new Set(),ids=new Set();
 for(const state of p.states){
  need(id(state.id)&&!ids.has(state.id)&&typeof state.cluster_label==='string'&&state.cluster_label.startsWith(`RPF2K:${p.range_id}:density:`)&&!state.cluster_label.endsWith('.unassigned'),'HDBSCAN state namespace differs.');ids.add(state.id);
  unique(state.member_indices,n);need(state.model_count===state.member_indices.length&&state.model_count>=1&&state.eligible_50===(state.model_count>=50),'Cluster count/eligibility differs.');
  for(const i of state.member_indices){need(!used.has(i),'HDBSCAN cluster memberships overlap.');used.add(i);if(data.view_id==='density')need(data.clusters[i]===state.cluster_label,'HDBSCAN state label/membership differs.');}
  const members=new Set(state.member_indices);
  if(state.eligible_50){need(Object.keys(state.selections).length===2,'Eligible clusters require both saved methods.');for(const method of METHODS)choice(state.selections[method],p,members,50,method,state.id);}
  else{need(Object.keys(state.selections).length===1,'Undersized clusters expose one All members subset.');const saved=choice(state.selections.allmembers,p,members,state.model_count,'allmembers',state.id);need(saved.indices.every((v,i)=>v===state.member_indices[i]),'All members cannot omit or duplicate a model.');}
 }
 need(p.noise_models===n-used.size,'HDBSCAN noise count differs from the full cohort.');
 if(data.view_id==='density')need(data.clusters.every((label,i)=>used.has(i)?!label.endsWith('.unassigned'):label.endsWith('.unassigned')),'Noise cannot enter HDBSCAN cluster ensembles.');
 for(const method of METHODS){const expected=p.states.flatMap(s=>selectionFor(s,method).indices).sort((a,b)=>a-b);const all=choice(p.all_states?.[method],p,used,expected.length,method,null);need(all.indices.every((v,i)=>v===expected[i]),'All-state Bonsai union differs from active selected subsets.');}
 return p;
}
function settings(value={}){const s={...DEFAULTS,...value};need((['none','all'].includes(s.state_id)||id(s.state_id))&&METHODS.includes(s.method),'Invalid HDBSCAN subset link.');return s;}
function parseSettings(params){try{return settings({state_id:params.get('hdb_state')||'none',method:params.get('hdb_method')||'mcmc50'})}catch{return{...DEFAULTS,invalid:true}}}
function routeParams(value){const s=settings(value);return s.state_id==='none'?'':new URLSearchParams({hdb_state:s.state_id,hdb_method:s.method}).toString();}
function select(payload,value={}){
 if(!payload||value.invalid)return{active:false,indices:new Set(),orderedIndices:[],groups:[],panels:[],note:value.invalid?'Invalid HDBSCAN subset link.':''};
 const s=settings(value);if(s.state_id==='none')return{active:false,indices:new Set(),orderedIndices:[],groups:[],panels:[],note:'Saved HDBSCAN subset highlights are off.'};
 const states=s.state_id==='all'?payload.states:payload.states.filter(row=>row.id===s.state_id);need(states.length>0,'Requested HDBSCAN cluster is unavailable.');
 const groups=states.map(state=>{const saved=selectionFor(state,s.method);return {state_id:state.id,cluster_label:state.cluster_label,color:state.color||'#196a8b',indices:saved.indices,small:!state.eligible_50,degenerate:state.model_count===50,models_count:saved.models_count,method:state.eligible_50?s.method:'allmembers',choice:saved}});
 const indices=groups.flatMap(g=>g.indices).sort((a,b)=>a-b),tree=payload.all_states[s.method],smallOnly=groups.every(g=>g.small),label=smallOnly?'All members':(s.method==='mcmc50'?'MCMC50':'DISCO50')+(groups.some(g=>g.small)?' plus All members of small clusters':'');
 return {active:true,indices:new Set(indices),orderedIndices:indices,groups,panels:groups,method:s.method,state_id:s.state_id,bonsai:tree.bonsai,models:indices.map(i=>payload.models[i]),geometry_models:tree.models,geometry_scope:'method_selected_union',
  note:`${label} · ${indices.length.toLocaleString()} selected models · ${states.length} HDBSCAN cluster${states.length===1?'':'s'}.`+(groups.some(g=>g.small)?' Clusters below 50 use all members, with their actual counts.':'')+(groups.some(g=>g.degenerate)?' Exactly 50-member clusters have one possible subset.':'')+' Noise remains in the projections and has no state ensemble.'};
}
async function checkedBytes(file,sha,bytes){return root.AISExplorerPooledMetrics.checkedBytes(file,sha,bytes);}
function createLoader(catalog,reader=async(file,sha)=>JSON.parse(new TextDecoder().decode(await checkedBytes(file,sha,null)))){
 const enabled=catalog?.schema_version===1&&catalog.kind==='pooled_model_overlay_catalog'&&catalog.cohort_id===COHORT,cache=new Map();
 return{enabled:enabled&&catalog.selections_ready===true,async load(data){if(data.cohort_id!==COHORT)return{status:'unavailable',payload:null,note:''};if(enabled&&catalog.selections_ready===false)return{status:'pending',payload:null,note:'Saved MCMC/DISCO ensembles and their six method-overview Bonsai trees are being prepared and verified. Model colors are available; no sampling runs in this page.'};try{
  need(enabled,'Saved HDBSCAN subset catalog is unavailable.');const entry=sourceBinding(data,catalog);need(entry.file===`hdbscan-states/${TARGET}/${COHORT}/${data.range_id}.json`&&hash(entry.sha256),'Unsafe or unhashed HDBSCAN subset payload.');
  const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
  return{status:'available',payload:validatePayload(await cache.get(key),entry,catalog,data),note:''};
 }catch(error){return{status:'unavailable',payload:null,note:'Saved HDBSCAN subsets unavailable: '+error.message}}}};
}
async function readBonsai(descriptor,models){const p=JSON.parse(new TextDecoder().decode(await checkedBytes(descriptor.file,descriptor.sha256,descriptor.bytes)));need(p.schema_version===1&&Array.isArray(p.models)&&p.models.length===models.length&&p.models.every((r,i)=>r.model===models[i])&&digest(p.models.map(r=>r.model))===descriptor.model_order_sha256,'Loaded Bonsai tree does not match the exact active selected models.');if(root.BonsaiEnsemble)root.BonsaiEnsemble.validate(p,models);return p;}
async function readArtifact(a){need(hash(a?.sha256)&&Number.isInteger(a?.bytes)&&a.bytes>0&&a.bytes<=67108864&&typeof a.file==='string'&&a.file.startsWith(`hdbscan-ensembles/${TARGET}/${COHORT}/`)&&/^[A-Za-z0-9_./-]+\.(?:pdb|pse)$/.test(a.file)&&!a.file.split('/').includes('..'),'Unverified HDBSCAN artifact.');return checkedBytes(a.file,a.sha256,a.bytes);}
const api={TARGET,COHORT,METHODS,DEFAULTS,validatePayload,sourceBinding,selectionFor,settings,parseSettings,routeParams,select,createLoader,readBonsai,readArtifact};root.AISExplorerHDBStates=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
