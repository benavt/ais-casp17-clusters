/* Verified figure supplements preserve the original saved-analysis bindings. */
(function(root){
 'use strict';
 const need=(value,message)=>{if(!value)throw Error(message)},hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 function safeFile(value){return typeof value==='string'&&/^figure-supplements\/[A-Za-z0-9_./-]+$/.test(value)&&!value.split('/').includes('..')}
 function validateGrid(grid,labels,models){
  const n=labels.length;
  need(grid&&grid.labels?.length===n&&grid.labels.every((label,i)=>label===labels[i])&&grid.models?.length===n&&grid.models.every((name,i)=>name===models[i]),'Figure grid identities differ');
  need(Array.isArray(grid.matrix)&&grid.matrix.length===n&&grid.matrix.every(row=>Array.isArray(row)&&row.length===n),'Incomplete figure grid');
  need(grid.matrix.every((row,i)=>row.every((value,j)=>Number.isFinite(value)&&value>=0&&value<=1&&Math.abs(value-grid.matrix[j][i])<1e-12&&(i!==j||value===1))),'Invalid or asymmetric figure grid');
  need(safeFile(grid.csv),'Unsafe figure artifacts');
 }
 function validate(payload,entry,data){
  need(payload.schema_version===1&&['saved_partition_figure_supplement','saved_partition_ensemble_supplement'].includes(payload.kind),'Invalid figure supplement');
  for(const key of ['target','range_id','view_id','source_data_sha256'])need(payload[key]===entry[key],'Figure supplement identity differs: '+key);
  need(Array.isArray(payload.models)&&payload.models.length===data.models.length&&payload.models.every((name,i)=>name===data.models[i]),'Figure supplement model order differs');
  need(Array.isArray(payload.representatives)&&payload.representatives.length===data.representatives.length&&payload.representatives.every((row,i)=>row.cluster===data.representatives[i].cluster&&row.model===data.representatives[i].model),'Figure supplement medoids differ');
  if(payload.kind==='saved_partition_ensemble_supplement'){
   const binding=data.views.find(row=>row.id===data.policy_view_id);
   need(Array.isArray(payload.canonical_positions)&&JSON.stringify(payload.canonical_positions)===JSON.stringify(binding.canonical_positions),'Ensemble residue mask differs');
   need(Array.isArray(payload.ensembles)&&payload.ensembles.length>0,'Empty ensemble supplement');
   const seen=new Set(),membership=new Map(data.models.map((name,i)=>[name,data.clusters[i]]));
   for(const row of payload.ensembles){
    const representative=data.representatives.find(rep=>rep.cluster===row.cluster);
    const derived=row.representative;
    need(representative&&(row.model===representative.model||(!representative.file&&!representative.coordinate_text&&derived?.model===row.model))&&!seen.has(row.cluster),'Ensemble representative differs');seen.add(row.cluster);
    need(Array.isArray(row.ensemble_models)&&row.ensemble_models.length>0&&row.ensemble_models.length<=5&&new Set(row.ensemble_models).size===row.ensemble_models.length&&row.ensemble_models.includes(row.model)&&row.ensemble_models.every(name=>membership.get(name)===row.cluster),'Ensemble selection differs');
    for(const [key,extension] of [['ensemble_file','.pdb'],['ensemble_pse','.pse']]){
     const file=row[key],proof=row.artifacts?.[key];
     need(typeof file==='string'&&file.startsWith(data.target+'/')&&/^[A-Za-z0-9_./-]+$/.test(file)&&!file.split('/').includes('..')&&file.endsWith(extension)&&proof?.file===file&&hash(proof.sha256)&&Number.isInteger(proof.bytes)&&proof.bytes>0,'Unsafe ensemble artifact');
    }
    if(derived)need(derived.model===row.model&&derived.format==='pdb'&&typeof derived.method==='string'&&typeof derived.file==='string'&&derived.file.startsWith(data.target+'/')&&/^[A-Za-z0-9_./-]+\.pdb$/.test(derived.file)&&!derived.file.split('/').includes('..')&&hash(derived.sha256),'Unsafe derived representative');
   }
   if(payload.bonsai)need(seen.size===data.representatives.length&&safeFile(payload.bonsai.file)&&hash(payload.bonsai.sha256)&&payload.bonsai.selected_models===payload.ensembles.reduce((n,row)=>n+row.ensemble_models.length,0),'Incomplete ensemble Bonsai');
   if(payload.medoid_tm){
    const medoids=new Map(payload.ensembles.map(row=>[row.cluster,row.model]));
    validateGrid(payload.medoid_tm,data.representatives.map(row=>row.cluster),data.representatives.map(row=>medoids.get(row.cluster)||row.model));
    need(JSON.stringify(payload.medoid_tm.canonical_positions)===JSON.stringify(payload.canonical_positions),'Figure grid residue mask differs');
   }
   return payload;
  }
  validateGrid(payload.medoid_tm,data.representatives.map(row=>row.cluster),data.representatives.map(row=>row.model));
  need(safeFile(payload.bonsai?.file)&&hash(payload.bonsai.sha256)&&Number.isInteger(payload.bonsai.selected_models)&&payload.bonsai.selected_models>0,'Unsafe figure artifacts');
  return payload;
 }
 async function readArtifact(file,expected){
  const response=await fetch(file,{cache:'no-cache',signal:AbortSignal.timeout(30000)});need(response.ok,'Saved figure supplement unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());need(root.AISExplorerTMStates?.sha256(bytes)===expected,'Saved figure supplement hash mismatch');
  return JSON.parse(new TextDecoder().decode(bytes));
 }
 function createLoader(catalog,reader=readArtifact){
  const entries=catalog?.schema_version===1&&catalog.kind==='saved_figure_supplement_catalog'?catalog.entries||[]:[],cache=new Map();
  return {async enrich(data){
   const matching=entries.filter(row=>row.target===data.target&&row.range_id===data.range_id&&row.view_id===data.view_id);if(!matching.length)return data;
   let enriched=data;
   for(const entry of matching){
   const binding=data.views?.find(row=>row.id===data.policy_view_id);
   need(data.visible_view_policy===true&&hash(entry.source_data_sha256)&&entry.source_data_sha256===data._source_sha&&entry.source_data_sha256===binding?.source_data_sha256,'Figure supplement source binding differs');
   need(safeFile(entry.file)&&hash(entry.sha256),'Unsafe figure supplement location');
   const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
   const payload=validate(await cache.get(key),entry,data);
   if(payload.kind==='saved_partition_ensemble_supplement'){
    const ensembles=new Map(payload.ensembles.map(row=>[row.cluster,row]));
    enriched={...enriched,representatives:enriched.representatives.map(row=>{
     const saved=ensembles.get(row.cluster),rep=saved?.representative;return saved?{...row,...(rep?{model:rep.model,method:rep.method,file:rep.file,format:rep.format,sha256:rep.sha256,coordinate_text:undefined}:{}),ensemble_file:saved.ensemble_file,ensemble_pse:saved.ensemble_pse,ensemble_models:[...saved.ensemble_models],ensemble_model_order:saved.ensemble_model_order}:row;
    }),...(payload.bonsai?{bonsai:{...payload.bonsai}}:{}),...(payload.medoid_tm?{medoid_tm:{...payload.medoid_tm},medoid_tm_note:payload.medoid_tm.note}:{}),...(payload.representative_policy?{representative_policy:payload.representative_policy}:{}),...(!payload.medoid_tm&&!enriched.medoid_tm&&typeof payload.medoid_tm_note==='string'?{medoid_tm_note:payload.medoid_tm_note}:{}),ensemble_supplement_provenance:payload.provenance};
    continue;
   }
   enriched={...enriched,bonsai:{...payload.bonsai},medoid_tm:{...payload.medoid_tm},medoid_tm_note:payload.medoid_tm.note,figure_supplement_provenance:payload.run};
   }
   return enriched;
  }};
 }
 const api={createLoader,validate};root.AISExplorerFigures=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
