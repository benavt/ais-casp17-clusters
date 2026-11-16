/* Display accepted saved panels. This module performs no scientific sampling. */
(function(root){
 'use strict';
 const sources={'afsample3-bioemu2':{count:2000,root:'analysis-2000',scores:'model-scores-2000.json'},'afsample3-bioemu2-260-states-2150':{count:2150,root:'analysis',scores:'model-scores-2150.json'},'current-12104':{count:12104,root:'sr215-current/sampling',embeddedRoster:true}},cache=new Map();
 const stateColors=['#0080ff','#ff8000','#339933'],empty=()=>({active:false,indices:new Set(),orderedIndices:[],groups:[],panels:[]});
 let context=null,current=null,highlight=empty(),preference={state:'all',method:'none',repeat:1},redraw=()=>{},busy=false;
 const supports=data=>!!sources[data?.cohort_id];
 function need(ok,message){if(!ok)throw Error('Saved cohort sampling: '+message)}
 function stateColor(state,index=0){const ordinal=/^S([123])$/.exec(state.id);return state.color||stateColors[ordinal?Number(ordinal[1])-1:index%stateColors.length]}
 function validate(data,summary,scores){
  const source=sources[data.cohort_id];need(source&&summary.cohort_id===data.cohort_id&&summary.cohort_models===source.count,'cohort identity differs.');
  const roster=new Set(data.models),acceptedModels=source.embeddedRoster?summary.models:scores.map(row=>row.model),scoreRoster=new Set(acceptedModels);
  need(roster.size===source.count&&data.models.length===source.count&&scoreRoster.size===source.count&&acceptedModels.length===source.count&&data.models.every(id=>scoreRoster.has(id)),'model roster differs.');
  if(source.embeddedRoster)need(data.models.every((model,index)=>model===acceptedModels[index]),'model order differs.');
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
  if(!cache.has(data.cohort_id))cache.set(data.cohort_id,Promise.all(['summary.json',...(source.scores?[source.scores]:[])].map(async name=>{const response=await fetch(source.root+'/'+name,{cache:'no-cache'});need(response.ok,'accepted results unavailable.');return response.json()})).catch(error=>{cache.delete(data.cohort_id);throw error}));
  const [summary,scores=[]]=await cache.get(data.cohort_id);return validate(data,summary,scores);
 }
 function select(ctx,settings){
  if(!ctx||settings.method==='none')return empty();
  const states=settings.state==='all'?ctx.mask.states:ctx.mask.states.filter(state=>state.id===settings.state);need(states.length,'requested state is unavailable.');
  const groups=states.map(state=>{const panel=ctx.panels.find(p=>p.state===state.id&&p.method===settings.method&&p.repeat===settings.repeat);need(panel,'requested panel is unavailable.');return{state_id:state.id,color:stateColor(state,ctx.mask.states.indexOf(state)),indices:panel.models.map(id=>ctx.byModel.get(id)),panel}});
  const orderedIndices=groups.flatMap(group=>group.indices);need(new Set(orderedIndices).size===orderedIndices.length,'state panels overlap.');
  return {active:true,indices:new Set(orderedIndices),orderedIndices,groups,panels:groups.map(group=>group.panel),panel:groups.length===1?groups[0].panel:null,method:settings.method,state_id:settings.state};
 }
 const node=id=>document.getElementById(id);
 function routeParams(){return highlight.active?'sampleState='+encodeURIComponent(preference.state)+'&sampleMethod='+preference.method+'&sampleRepeat='+preference.repeat:''}
 function writeRoute(){const [target,query='']=root.location.hash.slice(1).split('?'),params=new URLSearchParams(query);for(const key of ['sampleState','sampleMethod','sampleRepeat'])params.delete(key);for(const [key,value]of new URLSearchParams(routeParams()))params.set(key,value);root.history.replaceState(null,'','#'+target+'?'+params)}
 function restoreRoute(){if(!context)return;const params=new URLSearchParams(root.location.hash.split('?')[1]||'');if(!params.has('sampleMethod')){preference.method='none';update();return}const settings={state:params.get('sampleState'),method:params.get('sampleMethod'),repeat:Number(params.get('sampleRepeat'))};try{need(['mcmc50','disco50'].includes(settings.method),'unknown route method.');select(context,settings);preference=settings}catch(error){preference.method='none'}node('cohortSampleState').value=preference.state;node('cohortSampleRepeat').value=String(preference.repeat);update()}
 function update(){
  highlight=select(context,preference);
  for(const [id,method]of [['cohortMCMC','mcmc50'],['cohortDISCO','disco50']])node(id).setAttribute('aria-pressed',String(highlight.active&&preference.method===method));
  node('cohortSampleClear').disabled=busy||!highlight.active;
  const stateLabel=highlight.groups.length===1?highlight.groups[0].state_id:`all ${highlight.groups.length} states`;
  node('cohortSampleStatus').textContent=highlight.active?`${preference.method==='mcmc50'?'MCMC':'DISCO'} · ${stateLabel} · repeat ${preference.repeat} · ${highlight.orderedIndices.length} saved models selected`:'Choose MCMC or DISCO to highlight saved 50-model panels by state.';
  const links=node('cohortSampleDownloads');links.hidden=!highlight.active;
  const rows=node('cohortSampleDownloadRows');rows.replaceChildren();
  if(highlight.active)for(const group of highlight.groups){const row=document.createElement('span'),label=document.createElement('strong'),pdb=document.createElement('a'),csv=document.createElement('a');row.style.display='block';label.textContent=group.state_id+' · ';label.style.color=group.color;pdb.href=group.panel.pdb;pdb.download=group.panel.pdb.split('/').pop();pdb.textContent='PDB';csv.href=group.panel.members_csv;csv.download=group.panel.members_csv.split('/').pop();csv.textContent='CSV';row.append(label,pdb,document.createTextNode(' · '),csv);rows.append(row)}
  const legend=node('tmStateLegend');legend.replaceChildren();legend.hidden=!highlight.active;
  for(const group of highlight.groups){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.borderColor=group.color;item.append(swatch,document.createTextNode(group.state_id+' · '+group.indices.length.toLocaleString()));legend.append(item)}
 }
 function mount(data,ctx,callback){
  const box=node('cohortSamplingControls');box.hidden=!supports(data);current=data;context=ctx;redraw=callback;highlight=empty();if(!ctx){node('cohortSampleDownloads').hidden=true;node('tmStateLegend').replaceChildren();node('tmStateLegend').hidden=true;return}
  if(preference.state!=='all'&&!ctx.mask.states.some(s=>s.id===preference.state))preference.state='all';
  if(preference.repeat>ctx.summary.repeats)preference.repeat=1;
  node('cohortSampleState').replaceChildren(Object.assign(document.createElement('option'),{value:'all',textContent:`All ${ctx.mask.states.length} states · 50 models per state`}),...ctx.mask.states.map(s=>Object.assign(document.createElement('option'),{value:s.id,textContent:`${s.id} · ${s.count.toLocaleString()} qualified models · TM core ${s.tm_positions_label}`})));
  node('cohortSampleState').value=preference.state;
  node('cohortSampleRepeat').replaceChildren(...Array.from({length:ctx.summary.repeats},(_,i)=>Object.assign(document.createElement('option'),{value:String(i+1),textContent:String(i+1)})));
  node('cohortSampleRepeat').value=String(preference.repeat);
  node('cohortSampleDetails').textContent=ctx.mask.sampling_note+' '+ctx.mask.sampling_diagnostics+' S1 is blue, S2 orange, and S3 green. Rings show each exact accepted state panel in PCA, UMAP and t-SNE. Bonsai colors selected models by state when present in its saved tree. Uploaded 260 models retain stars; their medoids retain larger stars.';
  const change=()=>{preference.state=node('cohortSampleState').value;preference.repeat=Number(node('cohortSampleRepeat').value);update();writeRoute();redraw()};
  node('cohortSampleState').onchange=change;node('cohortSampleRepeat').onchange=change;
  for(const [id,method]of [['cohortMCMC','mcmc50'],['cohortDISCO','disco50']])node(id).onclick=()=>{preference.method=method;change()};
  node('cohortSampleClear').onclick=()=>{clear();redraw()};restoreRoute();
 }
 function clear(){preference.method='none';highlight=empty();if(context){update();writeRoute()}}
 function setBusy(value){busy=value;for(const id of ['cohortSampleState','cohortSampleRepeat','cohortMCMC','cohortDISCO'])node(id).disabled=busy;node('cohortSampleClear').disabled=busy||!highlight.active}
 function overlayTraces(data,method,scheme,visible,hidden){
  if(!highlight.active||data!==current)return[];
  const xy=data.projections[method].xy,traces=highlight.groups.map(group=>{const indices=group.indices.filter(i=>(root.AISUploadedStates?.starMeta(data,i)||(visible(data.clusters[i])&&!hidden.has(scheme.type==='continuous'?(Number.isFinite(scheme.values[i])?'valid':'Not calculable'):String(scheme.values[i]??'Unspecified'))))&&xy[i]?.every(Number.isFinite));return{type:'scatter',mode:'markers',name:`${group.state_id} ${preference.method} repeat ${preference.repeat}`,x:indices.map(i=>xy[i][0]),y:indices.map(i=>xy[i][1]),customdata:indices,text:indices.map(i=>data.models[i]),hovertemplate:'%{text}<extra>'+group.state_id+' · '+preference.method+' · repeat '+preference.repeat+'</extra>',marker:{symbol:'circle-open',size:indices.map(i=>root.AISUploadedStates?.starMeta(data,i)?.medoid?29:17),color:group.color,line:{color:group.color,width:2.4}},meta:{cohortSamplingHighlight:true,state_id:group.state_id,stateColor:group.color},zorder:110,showlegend:false}});
  const stateLabel=highlight.groups.length===1?highlight.groups[0].state_id:`all ${highlight.groups.length} states`,visibleCount=traces.reduce((sum,trace)=>sum+trace.customdata.length,0);
  node('cohortSampleStatus').textContent=`${preference.method==='mcmc50'?'MCMC':'DISCO'} · ${stateLabel} · repeat ${preference.repeat} · ${highlight.orderedIndices.length} saved models selected · ${visibleCount} visible after filters`;
  return traces;
 }
 function overlay(data,method,scheme,visible,hidden){const traces=overlayTraces(data,method,scheme,visible,hidden);return traces.length===1?traces[0]:null}
 const api={supports,prepare,validate,select,mount,clear,overlay,overlayTraces,routeParams,restoreRoute,setBusy,get highlight(){return highlight}};root.AISCohortSampling=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
