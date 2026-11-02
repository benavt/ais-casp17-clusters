/* Verified figure supplements preserve the original saved-analysis bindings. */
(function(root){
 'use strict';
 const need=(value,message)=>{if(!value)throw Error(message)},hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 function safeFile(value){return typeof value==='string'&&/^figure-supplements\/[A-Za-z0-9_./-]+$/.test(value)&&!value.split('/').includes('..')}
 function validate(payload,entry,data){
  need(payload.schema_version===1&&payload.kind==='saved_partition_figure_supplement','Invalid figure supplement');
  for(const key of ['target','range_id','view_id','source_data_sha256'])need(payload[key]===entry[key],'Figure supplement identity differs: '+key);
  need(Array.isArray(payload.models)&&payload.models.length===data.models.length&&payload.models.every((name,i)=>name===data.models[i]),'Figure supplement model order differs');
  need(Array.isArray(payload.representatives)&&payload.representatives.length===data.representatives.length&&payload.representatives.every((row,i)=>row.cluster===data.representatives[i].cluster&&row.model===data.representatives[i].model),'Figure supplement medoids differ');
  const grid=payload.medoid_tm,n=data.representatives.length;
  need(grid&&grid.labels.length===n&&grid.labels.every((label,i)=>label===data.representatives[i].cluster)&&grid.models.length===n&&grid.models.every((name,i)=>name===data.representatives[i].model),'Figure grid identities differ');
  need(grid.matrix.length===n&&grid.matrix.every(row=>Array.isArray(row)&&row.length===n),'Incomplete figure grid');
  need(grid.matrix.every((row,i)=>row.every((value,j)=>Number.isFinite(value)&&value>=0&&value<=1&&Math.abs(value-grid.matrix[j][i])<1e-12&&(i!==j||value===1))),'Invalid or asymmetric figure grid');
  need(safeFile(grid.csv)&&safeFile(payload.bonsai?.file)&&hash(payload.bonsai.sha256)&&Number.isInteger(payload.bonsai.selected_models)&&payload.bonsai.selected_models>0,'Unsafe figure artifacts');
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
   const entry=entries.find(row=>row.target===data.target&&row.range_id===data.range_id&&row.view_id===data.view_id);if(!entry)return data;
   const binding=data.views?.find(row=>row.id===data.policy_view_id);
   need(data.visible_view_policy===true&&hash(entry.source_data_sha256)&&entry.source_data_sha256===data._source_sha&&entry.source_data_sha256===binding?.source_data_sha256,'Figure supplement source binding differs');
   need(safeFile(entry.file)&&hash(entry.sha256),'Unsafe figure supplement location');
   const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
   const payload=validate(await cache.get(key),entry,data);
   return {...data,bonsai:{...payload.bonsai},medoid_tm:{...payload.medoid_tm},medoid_tm_note:payload.medoid_tm.note,figure_supplement_provenance:payload.run};
  }};
 }
 const api={createLoader,validate};root.AISExplorerFigures=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
