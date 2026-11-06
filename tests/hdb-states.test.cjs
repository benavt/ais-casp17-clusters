const test=require('node:test'),assert=require('node:assert/strict');
global.AISExplorerTMStates=require('../tm_states.js');global.AISExplorerPooledMetrics=require('../pooled_metrics.js');const api=require('../hdb_states.js');
const sha=v=>global.AISExplorerTMStates.sha256(new TextEncoder().encode(JSON.stringify(v)));
function fixture(view='density'){
 const models=Array.from({length:2000},(_,i)=>'M'+String(i).padStart(4,'0')),hashes=models.map((_,i)=>i.toString(16).padStart(64,'0')),pos=Array.from({length:139},(_,i)=>i+1),primary='a'.repeat(64),density='d'.repeat(64),metric='9'.repeat(64);
 const p={schema_version:1,kind:'hdbscan_cluster_selection_payload',target:api.TARGET,cohort_id:api.COHORT,range_id:'all',sequence_sha256:'s',construct_residues:139,noise_models:1873,canonical_positions:pos,models,source_sha256:hashes,model_order_sha256:sha(models),bonsai_policy:{geometry_scope:'method_selected_union',state_highlighting:true},source_density_sha256:density,view_bindings:{primary,density},energy:{scheme_key:'protein_ebm_energy_t10',model_version:6,conditioning_t:.1,energy_scope:'full_construct',scoring_residues:139,model_metrics_sha256:metric}};
 function choice(indices,method,state){const selected=indices.map(i=>models[i]),source=indices.map(i=>hashes[i]),base=`hdbscan-ensembles/${api.TARGET}/${api.COHORT}/all/${state}/${method}`;return{indices,models:selected,source_sha256:source,models_count:indices.length,ensemble:{file:base+'.pdb',sha256:'f'.repeat(64),bytes:100,models_count:indices.length},session:{file:base+'.pse',sha256:'f'.repeat(64),bytes:100,models_count:indices.length},bonsai:{file:`hdbscan-bonsai/${api.TARGET}/${api.COHORT}/all/${state}-${method}.json`,sha256:'f'.repeat(64),bytes:100,models_count:indices.length,geometry_scope:'method_selected_union',model_order_sha256:sha(selected),selected_set_sha256:sha([...selected].sort()),source_density_sha256:density,canonical_positions:pos}}}
 const a=Array.from({length:60},(_,i)=>i),b=Array.from({length:50},(_,i)=>i+60),c=Array.from({length:17},(_,i)=>i+110);
 p.states=[{id:'H01',cluster_label:'RPF2K:all:density:C1',member_indices:a,model_count:60,eligible_50:true,selections:{mcmc50:choice(a.slice(0,50),'mcmc50','H01'),disco50:choice(a.slice(10),'disco50','H01')}},{id:'H02',cluster_label:'RPF2K:all:density:C2',member_indices:b,model_count:50,eligible_50:true,selections:{mcmc50:choice(b,'mcmc50','H02'),disco50:choice(b,'disco50','H02')}},{id:'H03',cluster_label:'RPF2K:all:density:C3',member_indices:c,model_count:17,eligible_50:false,selections:{allmembers:choice(c,'allmembers','H03')}}];
 p.all_states=Object.fromEntries(api.METHODS.map(method=>{const indices=p.states.flatMap(s=>s.selections[s.eligible_50?method:'allmembers'].indices).sort((a,b)=>a-b);return [method,choice(indices,method,'all')]}));
 const clusters=models.map(()=> 'RPF2K:all:density:C1.unassigned');for(const s of p.states)for(const i of s.member_indices)clusters[i]=s.cluster_label;
 const data={target:api.TARGET,cohort_id:api.COHORT,range_id:'all',view_id:view,policy_view_id:view,visible_view_policy:true,_source_sha:p.view_bindings[view],views:['primary','density'].map(id=>({id,source_data_sha256:p.view_bindings[id]})),models,clusters:view==='density'?clusters:models.map(()=> 'RPF2K:all:primary:C1'),clustering_positions:pos,pooled_metric_status:'available',rpf_payload:{sequence_sha256:'s',models:models.map((model_id,i)=>({model_id,source_sha256:hashes[i]}))}};
 const entry={file:`hdbscan-states/${api.TARGET}/${api.COHORT}/all.json`,sha256:'e'.repeat(64),source_density_sha256:density,view_bindings:p.view_bindings};const catalog={schema_version:1,kind:'pooled_model_overlay_catalog',target:api.TARGET,cohort_id:api.COHORT,selections_ready:true,model_metrics:{sha256:metric},ranges:{all:entry}};
 return{p,data,entry,catalog};
}
test('exact selected sets work on both displayed partitions, preserve small clusters and exclude noise',()=>{
 for(const view of ['primary','density']){const {p,data,entry,catalog}=fixture(view),before=JSON.stringify(p);assert.equal(api.validatePayload(p,entry,catalog,data),p);for(const method of api.METHODS){const h=api.select(p,{state_id:'all',method});assert.equal(h.orderedIndices.length,117);assert.equal(new Set(h.orderedIndices).size,117);assert(h.orderedIndices.every(i=>i<127));assert.equal(h.groups[2].method,'allmembers');assert.equal(h.groups[2].models_count,17);assert.match(h.note,/actual counts/);const one=api.select(p,{state_id:'H03',method});assert.equal(one.models.length,17);assert.equal(one.bonsai,p.all_states[method].bonsai);assert.equal(one.geometry_models.length,117);assert.match(one.note,/All members/)}assert.equal(JSON.stringify(p),before)}
 const {p}=fixture();assert.notDeepEqual(api.select(p,{state_id:'all',method:'mcmc50'}).models,api.select(p,{state_id:'all',method:'disco50'}).models);assert.deepEqual(p.states[1].selections.mcmc50.models,p.states[1].selections.disco50.models);
});
test('wrong source, original TM namespaces, membership substitutions and falsely padded small states reject',()=>{
 for(const change of [f=>f.p.source_density_sha256='0'.repeat(64),f=>f.p.source_sha256[0]='1'.repeat(64),f=>f.p.energy.model_metrics_sha256='0'.repeat(64),f=>f.p.states[0].selections.mcmc50.indices[0]=1500,f=>f.p.states[2].selections.allmembers.models_count=50,f=>f.p.states[1].member_indices[0]=0,f=>f.p.all_states.mcmc50.indices.pop(),f=>f.p.states[0].cluster_label='RPF2K:all:primary:C1',f=>f.p.noise_models=0,f=>f.p.all_states.mcmc50.bonsai.selected_set_sha256='0'.repeat(64)]){const f=fixture();change(f);assert.throws(()=>api.validatePayload(f.p,f.entry,f.catalog,f.data))}
 const f=fixture();f.p.kind='tm_state_selection_payload';assert.throws(()=>api.validatePayload(f.p,f.entry,f.catalog,f.data));
});
test('state routes are independent of old TM-state routes and no adapter reads occur on old cohorts',async()=>{
 assert.deepEqual(api.parseSettings(new URLSearchParams('tm_state=S1&tm_method=disco50')),{state_id:'none',method:'mcmc50'});assert.deepEqual(api.parseSettings(new URLSearchParams('hdb_state=H03&hdb_method=disco50')),{state_id:'H03',method:'disco50'});assert.equal(api.routeParams({state_id:'all',method:'disco50'}),'hdb_state=all&hdb_method=disco50');
 const f=fixture(),loader=api.createLoader(f.catalog,()=>{throw Error('Old cohort must not read pooled artifacts')});assert.deepEqual(await loader.load({...f.data,cohort_id:'all'}),{status:'unavailable',payload:null,note:''});
});
test('Bonsai reader accepts only the exact active selected model set and order, never a previous full-cohort tree',async()=>{
 const f=fixture(),h=api.select(f.p,{state_id:'H03',method:'mcmc50'}),payload={schema_version:1,models:h.geometry_models.map((model,vertex)=>({model,vertex})),layouts:[{key:'a',nodes:[[0,0]],edges:[]}]},body=new TextEncoder().encode(JSON.stringify(payload));
 const descriptor={...h.bonsai,bytes:body.length,sha256:global.AISExplorerTMStates.sha256(body)},old=global.fetch;global.fetch=async()=>new Response(body);
 try{assert.deepEqual(await api.readBonsai(descriptor,h.geometry_models),payload);await assert.rejects(api.readBonsai(descriptor,[...h.geometry_models].reverse()),/exact active/);await assert.rejects(api.readBonsai(descriptor,f.p.models),/exact active/)}finally{global.fetch=old}
});

test('pending verified selections never request native files or expose an original tree',async()=>{const f=fixture();f.catalog.selections_ready=false;let reads=0;const loader=api.createLoader(f.catalog,()=>{reads++;throw Error('No pending native read')});assert.equal(loader.enabled,false);const result=await loader.load(f.data);assert.equal(result.status,'pending');assert.equal(result.payload,null);assert.equal(reads,0);assert.equal(api.select(result.payload,{state_id:'all',method:'mcmc50'}).active,false);});

function structuralFixture(view='density'){
 const f=fixture(view),p=f.p;
 p.schema_version=2;p.kind='pooled_tm_state_selection_payload';p.tm_threshold=.8;p.tm_positions=Array.from({length:58},(_,i)=>i+15);
 p.selection_prior={procedure:'HDBSCAN',alpha:.5,tau:127.4222412109375,cohort_models:2000,subset_size:50,production_chain:0,production_iteration:10000,subset_law:'product-weight'};
 const original=p.states[0].selections.mcmc50;
 function choice(indices,method,state){const c=structuredClone(original);c.indices=indices;c.models=indices.map(i=>p.models[i]);c.source_sha256=indices.map(i=>p.source_sha256[i]);c.models_count=indices.length;for(const [key,ext]of [['ensemble','pdb'],['session','pse']])c[key]={file:`hdbscan-ensembles/${api.TARGET}/${api.COHORT}/all/${state}/${method}.${ext}`,sha256:'f'.repeat(64),bytes:100,models_count:indices.length};return c;}
 const a=[...Array.from({length:60},(_,i)=>i),1950,1951,1952,1953,1954],b=Array.from({length:50},(_,i)=>i+60);
 p.states=[a,b].map((indices,j)=>{const id='S'+(j+1);return{id,cluster_label:id,color:j?'#ff8000':'#0080ff',member_indices:indices,member_tm_scores:indices.map((_,i)=>i?.9:1),model_count:indices.length,eligible_50:true,representative:{index:indices[0],model:p.models[indices[0]]},selections:{mcmc50:choice(indices.slice(0,50),'mcmc50',id),disco50:choice(indices.slice(-50),'disco50',id)}}});
 p.unassigned_models=2000-a.length-b.length;
 const old=p.all_states;p.all_states={};
 for(const method of api.METHODS){const indices=p.states.flatMap(s=>s.selections[method].indices).sort((a,b)=>a-b),c=choice(indices,method,'all');c.bonsai={...old[method].bonsai,models_count:indices.length,model_order_sha256:sha(c.models),selected_set_sha256:sha([...c.models].sort())};p.all_states[method]=c;}
 return f;
}
test('TM-certified states span fine clusters and original noise; exactly50 per state on both views',()=>{
 for(const view of ['primary','density']){const f=structuralFixture(view);assert.equal(api.validatePayload(f.p,f.entry,f.catalog,f.data),f.p);for(const method of api.METHODS){const selected=api.select(f.p,{state_id:'all',method});assert.equal(selected.models.length,100);assert.equal(selected.geometry_models.length,100);assert.equal(selected.groups.length,2);assert(selected.groups.every(g=>g.indices.length===50));assert.match(selected.note,/50 per structural state/);}assert(api.select(f.p,{state_id:'S1',method:'disco50'}).orderedIndices.includes(1954));}
});
test('state TM, global prior, quota, namespace and union bindings fail closed',()=>{
 for(const mutate of [f=>f.p.tm_positions.pop(),f=>f.p.selection_prior.tau=1,f=>f.p.selection_prior.cohort_models=11000,f=>f.p.states[0].member_tm_scores[1]=.79,f=>f.p.states[1].id='S1',f=>f.p.states.push(...f.p.states),f=>f.p.states[0].selections.mcmc50.ensemble.file=f.p.states[0].selections.mcmc50.ensemble.file.replace('/S1/','/H01/'),f=>f.p.unassigned_models--,f=>f.p.all_states.disco50.indices.pop()]){const f=structuralFixture();mutate(f);assert.throws(()=>api.validatePayload(f.p,f.entry,f.catalog,f.data));}
});
test('obsolete per-cluster links never map silently onto a TM state; empty searches do not pad',()=>{
 const f=structuralFixture();assert.deepEqual(api.parseSettings(new URLSearchParams('hdb_state=S2&hdb_method=disco50')),{state_id:'S2',method:'disco50'});assert.equal(api.select(f.p,{state_id:'H01',method:'mcmc50'}).active,false);
 f.p.states=[];f.p.all_states={};f.p.unassigned_models=2000;assert.equal(api.validatePayload(f.p,f.entry,f.catalog,f.data),f.p);const s=api.select(f.p,{state_id:'all',method:'mcmc50'});assert.equal(s.active,false);assert.match(s.note,/No supported state/);
});
