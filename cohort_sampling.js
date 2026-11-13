/* Display accepted saved panels. This module performs no scientific sampling. */
(function(root){
 'use strict';
 const sources={'afsample3-bioemu2':{count:2000,root:'analysis-2000',scores:'model-scores-2000.json'},'afsample3-bioemu2-260-states-2150':{count:2150,root:'analysis',scores:'model-scores-2150.json'}},cache=new Map();
 const empty=()=>({active:false,indices:new Set(),orderedIndices:[]});
 let context=null,current=null,highlight=empty(),preference={state:'S1',method:'none',repeat:1},redraw=()=>{},busy=false;
 const supports=data=>!!sources[data?.cohort_id];
 function need(ok,message){if(!ok)throw Error('Saved cohort sampling: '+message)}
 function validate(data,summary,scores){
  const source=sources[data.cohort_id];need(source&&summary.cohort_id===data.cohort_id&&summary.cohort_models===source.count,'cohort identity differs.');
  const roster=new Set(data.models),scoreRoster=new Set(scores.map(row=>row.model));
  need(roster.size===source.count&&data.models.length===source.count&&scoreRoster.size===source.count&&scores.length===source.count&&data.models.every(id=>scoreRoster.has(id)),'model roster differs.');
  const mask=summary.masks.find(row=>row.id===data.range_id);need(mask,'residue subset is missing.');
  const panels=summary.panels.filter(row=>row.mask===mask.id),keys=new Set(),byModel=new Map(data.models.map((id,i)=>[id,i]));
  for(const panel of panels){
   const key=[panel.state,panel.method,panel.repeat].join('|');need(!keys.has(key),'duplicate panel.');keys.add(key);
   need(panel.accepted===true&&mask.states.some(s=>s.id===panel.state)&&['mcmc50','disco50'].includes(panel.method)&&Number.isInteger(panel.repeat)&&panel.repeat>=1&&panel.repeat<=summary.repeats,'unaccepted panel or invalid state/method/repeat.');
   need(panel.models.length===50&&new Set(panel.models).size===50&&panel.models.every(id=>byModel.has(id)),'panel must contain 50 distinct models from this cohort.');
  }
  for(const state of mask.states)for(const method of ['mcmc50','disco50'])for(let repeat=1;repeat<=summary.repeats;repeat++)need(keys.has([state.id,method,repeat].join('|')),'an expected panel is missing.');
  return {summary,mask,panels,byModel};
 }
 async function prepare(data){
  if(!supports(data))return null;
  const source=sources[data.cohort_id];
  if(!cache.has(data.cohort_id))cache.set(data.cohort_id,Promise.all(['summary.json',source.scores].map(async name=>{const response=await fetch(source.root+'/'+name,{cache:'no-cache'});need(response.ok,'accepted results unavailable.');return response.json()})).catch(error=>{cache.delete(data.cohort_id);throw error}));
  const [summary,scores]=await cache.get(data.cohort_id);return validate(data,summary,scores);
 }
 function select(ctx,settings){
  if(!ctx||settings.method==='none')return empty();
  const panel=ctx.panels.find(p=>p.state===settings.state&&p.method===settings.method&&p.repeat===settings.repeat);need(panel,'requested panel is unavailable.');
  const orderedIndices=panel.models.map(id=>ctx.byModel.get(id));return {active:true,indices:new Set(orderedIndices),orderedIndices,panel};
 }
 const node=id=>document.getElementById(id);
 function routeParams(){return highlight.active?'sampleState='+encodeURIComponent(preference.state)+'&sampleMethod='+preference.method+'&sampleRepeat='+preference.repeat:''}
 function writeRoute(){const [target,query='']=root.location.hash.slice(1).split('?'),params=new URLSearchParams(query);for(const key of ['sampleState','sampleMethod','sampleRepeat'])params.delete(key);for(const [key,value]of new URLSearchParams(routeParams()))params.set(key,value);root.history.replaceState(null,'','#'+target+'?'+params)}
 function restoreRoute(){if(!context)return;const params=new URLSearchParams(root.location.hash.split('?')[1]||'');if(!params.has('sampleMethod')){preference.method='none';update();return}const settings={state:params.get('sampleState'),method:params.get('sampleMethod'),repeat:Number(params.get('sampleRepeat'))};try{need(['mcmc50','disco50'].includes(settings.method),'unknown route method.');select(context,settings);preference=settings}catch(error){preference.method='none'}node('cohortSampleState').value=preference.state;node('cohortSampleRepeat').value=String(preference.repeat);update()}
 function update(){
  highlight=select(context,preference);
  for(const [id,method]of [['cohortMCMC','mcmc50'],['cohortDISCO','disco50']])node(id).setAttribute('aria-pressed',String(highlight.active&&preference.method===method));
  node('cohortSampleClear').disabled=busy||!highlight.active;
  node('cohortSampleStatus').textContent=highlight.active?`${preference.method==='mcmc50'?'MCMC':'DISCO'} · ${preference.state} · repeat ${preference.repeat} · 50 saved models selected`:'Choose MCMC or DISCO to highlight a saved 50-model panel.';
  const links=node('cohortSampleDownloads');links.hidden=!highlight.active;
  if(highlight.active){for(const [id,key]of [['cohortSamplePDB','pdb'],['cohortSampleCSV','members_csv']]){node(id).href=highlight.panel[key];node(id).download=highlight.panel[key].split('/').pop()}}
 }
 function mount(data,ctx,callback){
  const box=node('cohortSamplingControls');box.hidden=!supports(data);current=data;context=ctx;redraw=callback;highlight=empty();if(!ctx)return;
  if(!ctx.mask.states.some(s=>s.id===preference.state))preference.state=ctx.mask.states[0].id;
  if(preference.repeat>ctx.summary.repeats)preference.repeat=1;
  node('cohortSampleState').replaceChildren(...ctx.mask.states.map(s=>Object.assign(document.createElement('option'),{value:s.id,textContent:`${s.id} · ${s.count.toLocaleString()} qualified models · TM core ${s.tm_positions_label}`})));
  node('cohortSampleState').value=preference.state;
  node('cohortSampleRepeat').replaceChildren(...Array.from({length:ctx.summary.repeats},(_,i)=>Object.assign(document.createElement('option'),{value:String(i+1),textContent:String(i+1)})));
  node('cohortSampleRepeat').value=String(preference.repeat);
  node('cohortSampleDetails').textContent=ctx.mask.sampling_note+' '+ctx.mask.sampling_diagnostics+' Rings show the exact accepted panel in PCA, UMAP and t-SNE. Bonsai highlights only selected models present in its saved tree. Uploaded 260 models retain stars; their medoids retain larger stars.';
  const change=()=>{preference.state=node('cohortSampleState').value;preference.repeat=Number(node('cohortSampleRepeat').value);update();writeRoute();redraw()};
  node('cohortSampleState').onchange=change;node('cohortSampleRepeat').onchange=change;
  for(const [id,method]of [['cohortMCMC','mcmc50'],['cohortDISCO','disco50']])node(id).onclick=()=>{preference.method=method;change()};
  node('cohortSampleClear').onclick=()=>{clear();redraw()};restoreRoute();
 }
 function clear(){preference.method='none';highlight=empty();if(context){update();writeRoute()}}
 function setBusy(value){busy=value;for(const id of ['cohortSampleState','cohortSampleRepeat','cohortMCMC','cohortDISCO'])node(id).disabled=busy;node('cohortSampleClear').disabled=busy||!highlight.active}
 function overlay(data,method,scheme,visible,hidden){
  if(!highlight.active||data!==current)return null;
  const xy=data.projections[method].xy,indices=highlight.orderedIndices.filter(i=>(root.AISUploadedStates?.starMeta(data,i)||(visible(data.clusters[i])&&!hidden.has(scheme.type==='continuous'?(Number.isFinite(scheme.values[i])?'valid':'Not calculable'):String(scheme.values[i]??'Unspecified'))))&&xy[i]?.every(Number.isFinite));
  const color=preference.method==='mcmc50'?'#111111':'#be185d';
  node('cohortSampleStatus').textContent=`${preference.method==='mcmc50'?'MCMC':'DISCO'} · ${preference.state} · repeat ${preference.repeat} · 50 saved models selected · ${indices.length} visible after filters`;
  return {type:'scatter',mode:'markers',name:`${preference.state} ${preference.method} repeat ${preference.repeat}`,x:indices.map(i=>xy[i][0]),y:indices.map(i=>xy[i][1]),customdata:indices,text:indices.map(i=>data.models[i]),hovertemplate:'%{text}<extra>'+preference.state+' · '+preference.method+' · repeat '+preference.repeat+'</extra>',marker:{symbol:'circle-open',size:indices.map(i=>root.AISUploadedStates?.starMeta(data,i)?.medoid?29:17),color,line:{color,width:2.4}},meta:{cohortSamplingHighlight:true},zorder:110,showlegend:false};
 }
 const api={supports,prepare,validate,select,mount,clear,overlay,routeParams,restoreRoute,setBusy,get highlight(){return highlight}};root.AISCohortSampling=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
