/* Saved SR215 RPF observations. No scoring, fitting or coordinate processing. */
(function(root){'use strict';
const TARGET='SR215_bmr6366',COHORT='afsample3-bioemu2';
const SEQUENCE='7ab896059b4577bbcfc7cf9db00493b1bc9cea4bee282239195085658fe77f13';
const METRICS=[['recall','Recall'],['precision','Precision'],['dp','DP']];
const NOTE='Reduce baseline: RPF scores each prepared model independently against the same full-construct SR215 NMR inputs. These are not ensemble scores or prediction-confidence values. The same scores are reused across residue selections and projections; gray points have no RPF observation. Both methods use the established proton-addition convention without minimization.';
const need=(condition,message)=>{if(!condition)throw Error(message);};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function validate(payload){
 need(payload?.schema_version===1&&payload.target===TARGET&&payload.sequence_sha256===SEQUENCE&&payload.score_context==='independent_single_model','RPF target, construct or score context differs.');
 need(Array.isArray(payload.models)&&payload.models.length===2000,'Exactly 2,000 RPF model observations required.');
 const ids=new Set(),counts={afsample3:0,bioemu2:0};
 for(const row of payload.models){
  const label={afsample3:'AFSample3',bioemu2:'BioEMU2'}[row.method];
  need(row.target===TARGET&&label&&Number.isInteger(row.ordinal)&&row.ordinal>=0&&row.ordinal<1000&&row.model_id===TARGET+'__'+label+'__'+String(row.ordinal).padStart(4,'0'),'RPF source sample/frame identity differs.');
  need(!ids.has(row.model_id)&&digest(row.source_sha256)&&digest(row.prepared_sha256),'Duplicate RPF model or missing source/prepared identity.');ids.add(row.model_id);counts[row.method]++;
  need(METRICS.every(([key])=>finite(row[key]))&&row.recall>=0&&row.recall<=1&&row.precision>=0&&row.precision<=1,'RPF observation is missing or invalid.');
  need(row.ptm===null||finite(row.ptm)&&row.ptm>=0&&row.ptm<=1,'Invalid native pTM observation.');
  if(row.method==='bioemu2')need(row.ptm===null,'BioEMU2 cannot acquire an AlphaFold pTM value.');
  if(row.ptm!==null)need(digest(row.ptm_source_sha256),'Native pTM source identity is missing.');
 }
 need(counts.afsample3===1000&&counts.bioemu2===1000,'RPF method coverage differs.');return payload;
}
function colorRange(payload,key){const values=payload.models.map(row=>row[key]);return [Math.min(...values),Math.max(...values)];}
function enrich(data,payload,binding){
 validate(payload);need(data.target===TARGET,'RPF target differs from this analysis.');
 need(digest(data._source_sha)&&binding?.source_data_sha256===data._source_sha,'RPF is not bound to these saved analysis bytes.');
 need(Array.isArray(data.models)&&new Set(data.models).size===data.models.length,'Saved analysis model identities are ambiguous.');
 const lookup=new Map(payload.models.map(row=>[row.model_id,row])),matched=data.models.filter(id=>lookup.has(id)).length;
 need(matched>0&&matched===binding.scored_models,'RPF coverage differs from the verified analysis binding.');
 const added=METRICS.map(([key,label])=>({key:'rpf_'+key,name:'RPF '+label+' · Reduce · full construct',short_name:'RPF '+label+' · Reduce',type:'continuous',colorscale:'Viridis',
  range:colorRange(payload,key),values:data.models.map(id=>lookup.get(id)?.[key]??null),metric_note:NOTE,
  score_context:'independent_single_model',scale_scope:'All 2,000 scored SR215 models; identical bounds across residue selections and clustering views.'}));
 need(!added.some(s=>data.schemes.some(old=>old.key===s.key)),'RPF metric key collides with an existing observation.');
 return {...data,schemes:[...data.schemes,...added],rpf_overlay_status:'available',rpf_scored_models:matched,rpf_payload:payload,rpf_note:NOTE};
}
async function readPayload(file,expected){
 const response=await root.fetch(file,{cache:'no-cache',signal:AbortSignal.timeout(30000)});need(response.ok,'Saved RPF observations are unavailable.');
 const raw=new Uint8Array(await response.arrayBuffer());let actual;
 if(root.crypto?.subtle)actual=Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',raw)),v=>v.toString(16).padStart(2,'0')).join('');
 else if(root.AISExplorerTMStates?.sha256)actual=root.AISExplorerTMStates.sha256(raw);
 need(actual===expected,'Saved RPF observation hash differs.');return JSON.parse(new TextDecoder().decode(raw));
}
function createLoader(catalog,reader=readPayload){
 const cache=new Map();return {async enrich(data){
  if(data.target!==TARGET||catalog?.schema_version!==1||!catalog.observations)return data;
  try{
   const entry=catalog.observations;need(entry.file==='metrics/sr215-rpf.json'&&digest(entry.sha256),'Unsafe or unhashed RPF observation payload.');
   const binding=catalog.bindings?.find(row=>row.source_data_sha256===data._source_sha);
   need(binding,'RPF observations are not bound to this saved view.');
   const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
   return enrich(data,await cache.get(key),binding);
  }catch(error){return {...data,rpf_overlay_status:'unavailable',rpf_note:'RPF observations unavailable: '+error.message};}
 }};
}
function cohortTarget(target,catalog,requested){
 if(requested!==COHORT)return target;
 need(target.id===TARGET&&catalog?.cohort?.id===COHORT&&catalog.cohort.available===true,'The requested pooled RPF cohort is unavailable.');
 const ranges=catalog.cohort.residue_ranges;
 need(Array.isArray(ranges)&&ranges.length===4&&['all','res5-95','res32-47-plus78-99','res32-47-plus78-99-plus121-139'].every(id=>ranges.some(r=>r.id===id)),'Pooled SR215 residue selections differ.');
 return {...target,cohort_id:COHORT,residue_ranges:ranges};
}
const PREPARATIONS={reduce:'Reduce',phenix:'phenix.reduce'};
const COMPARISON_NOTE='Both panels use the same matched 2,000 original AIS models. Reduce and phenix.reduce use different recorded RPF scorers; phenix.reduce -BUILD -NUClear can optimize or flip groups and move heavy atoms. Differences are descriptive and cannot be attributed solely to preparation. Point colors, HDBSCAN selections and Bonsai geometry are independent of this control.';
function matchedPreparations(baseline,phenix){
 validate(baseline);need(root.AISExplorerPhenixRPF?.validate,'Phenix preparation validator is unavailable.');
 root.AISExplorerPhenixRPF.validate(phenix,{models:baseline.models.map(row=>row.model_id),rpf_payload:baseline});
 const files=Object.entries(baseline.provenance?.experimental_files_sha256||{}),experimental=new Map(files.map(([name,value])=>[name.split('/').at(-1),value]));
 need(files.length===6&&experimental.size===6&&Object.keys(phenix.experimental_input_sha256||{}).length===6&&[...experimental].every(([name,value])=>digest(value)&&phenix.experimental_input_sha256[name]===value),'Matched experimental-input roles differ between preparations.');
 const lookup=new Map(phenix.models.map(row=>[row.model_id,row]));
 const variant={...phenix,models:baseline.models.map(row=>({...lookup.get(row.model_id),ptm:row.ptm,ptm_source_sha256:row.ptm_source_sha256,ptm_status:row.ptm_status}))};
 validate(variant);const bounds={violin:{},ptm:{}};
 for(const [key]of METRICS){
  const all=[...baseline.models,...variant.models],af=all.filter(row=>row.method==='afsample3');
  bounds.violin[key]=[Math.min(...all.map(row=>row[key])),Math.max(...all.map(row=>row[key]))];
  bounds.ptm[key]=[Math.min(...af.map(row=>row[key])),Math.max(...af.map(row=>row[key]))];
 }
 let maximumCoincident=0;
 for(const payload of [baseline,variant])for(const [key]of METRICS){
  const counts=new Map();for(const row of payload.models.filter(r=>r.method==='afsample3'&&finite(r.ptm))){const id=JSON.stringify([row.ptm,row[key]]);counts.set(id,(counts.get(id)||0)+1);}
  maximumCoincident=Math.max(maximumCoincident,...counts.values());
 }
 return {status:'available',payloads:{reduce:baseline,phenix:variant},bounds,native_ptm_range:ptmRange(baseline),bubble_maximum_coincident_models:maximumCoincident,bubble_sizeref:2*Math.max(maximumCoincident,1)/(34*34),note:COMPARISON_NOTE};
}
function createComparisonLoader(catalog,reader=readPayload){
 const cache=new Map();return {async load(data){
  try{
   need(data.target===TARGET&&data.rpf_overlay_status==='available','Verified Reduce observations are unavailable.');
   const entry=catalog?.phenix_rpf;need(entry?.file==='metrics/sr215-rpf-phenix.json'&&digest(entry.sha256),'Unsafe or unhashed Phenix comparison source.');
   const key=entry.file+'|'+entry.sha256;if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>reader(entry.file,entry.sha256)));
   return matchedPreparations(data.rpf_payload,await cache.get(key));
  }catch(error){return {status:'unavailable',note:'Preparation comparison unavailable: '+error.message};}
 }};
}
function preparationFromSearch(search=''){return new URLSearchParams(search).get('rpf_preparation')==='phenix'?'phenix':'reduce';}
function rememberPreparation(preparation){
 if(!root.location?.href||!root.history?.replaceState)return;
 const url=new URL(root.location.href);if(preparation==='reduce')url.searchParams.delete('rpf_preparation');else url.searchParams.set('rpf_preparation',preparation);
 root.history.replaceState(null,'',url.pathname+url.search+url.hash);
}
function axisRange(bounds,kind='violin'){const [lo,hi]=bounds,pad=kind==='ptm'?Math.max(.001,(hi-lo)*.09):Math.max(.005,(hi-lo)*.15);return [lo-pad,hi+pad];}
function scatterTraces(payload,key,options={}){
 validate(payload);need(METRICS.some(([metric])=>metric===key),'Unknown RPF metric.');
 const rows=payload.models.filter(row=>row.method==='afsample3'&&finite(row.ptm)),range=options.range||colorRange(payload,key),groups=new Map();
 for(const row of rows){const id=JSON.stringify([row.ptm,row[key]]);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
 const pairs=[...groups.values()].sort((a,b)=>a[0].ptm-b[0].ptm||a[0][key]-b[0][key]),counts=pairs.map(group=>group.length);
 return [{type:'scattergl',mode:'markers',name:'AFSample3',x:pairs.map(group=>group[0].ptm),y:pairs.map(group=>group[0][key]),
  customdata:pairs.map(group=>[group.length,group.slice(0,5).map(row=>row.model_id).join('<br>')+(group.length>5?'<br>…':''),group.length===1?group[0].model_id:null]),
  marker:{size:counts,sizemode:'area',sizeref:options.sizeref??2*Math.max(...counts,1)/(34*34),opacity:.7,color:pairs.map(group=>group[0][key]),colorscale:'Viridis',cmin:range[0],cmax:range[1],showscale:false,line:{width:.5,color:'#ffffff'}},
  hovertemplate:'Native pTM: %{x:.2f}<br>Full-construct RPF '+METRICS.find(([metric])=>metric===key)[1]+(options.preparation?' · '+options.preparation:'')+': %{y:.2f}<br>%{customdata[0]} models at this exact score pair<br>%{customdata[1]}<extra></extra>',
  meta:{models:rows.length,exact_positions:pairs.length,maximum_coincident_models:Math.max(...counts,0),size_definition:'Circle area is proportional to the number of models at this exact printed-score pair; no jitter.'}}];
}
function distributionTraces(payload,key,colors={}){
 validate(payload);need(METRICS.some(([metric])=>metric===key),'Unknown RPF metric.');
 return [['afsample3','AFSample3','#0072b2'],['bioemu2','BioEMU2','#d55e00']].map(([method,label,fallback])=>{
  const rows=payload.models.filter(row=>row.method===method);return {type:'violin',name:label+' · n='+rows.length,x:rows.map(()=>label),y:rows.map(row=>row[key]),
   customdata:rows.map(row=>row.model_id),line:{color:colors[method]||colors[label]||fallback,width:1.4},fillcolor:colors[method]||colors[label]||fallback,opacity:.75,
   box:{visible:true,fillcolor:'#ffffff',line:{color:'#26363d',width:1.5}},meanline:{visible:false},points:false,spanmode:'hard',bandwidth:.005,scalemode:'width',scalegroup:key,
   hovertemplate:'%{y:.2f}<extra>'+label+' · '+rows.length+' saved models</extra>'};
 });
}
function ptmRange(payload){const values=payload.models.filter(row=>row.method==='afsample3'&&finite(row.ptm)).map(row=>row.ptm);return values.length?[Math.max(0,Math.min(...values)-.01),Math.min(1,Math.max(...values)+.01)]:[0,1];}
async function renderScatters(container,data,render,onSelect,comparisonLoader=null){
 if(!container)return;const serial=(Number(container.dataset.rpfSerial)||0)+1;container.dataset.rpfSerial=serial;
 container.hidden=data.target!==TARGET||data.rpf_overlay_status!=='available';if(container.hidden)return;
 const comparison=comparisonLoader?await comparisonLoader.load(data):null;
 if(Number(container.dataset.rpfSerial)!==serial)return;
 const preparation=container.dataset.rpfPreparation||preparationFromSearch(root.location?.search||'');container.dataset.rpfPreparation=preparation;
 const label=PREPARATIONS[preparation],available=comparison?.status==='available';
 const payload=available?comparison.payloads[preparation]:preparation==='reduce'?data.rpf_payload:null;
 const active=container.dataset.rpfView||'distributions';
 const note=container.querySelector('[data-rpf-preparation-note]');if(note)note.textContent=available?COMPARISON_NOTE:comparison?.note||'Reduce baseline observations. Paired preparation data are unavailable.';
 const heading=container.querySelector('#rpfComparisonTitle');if(heading)heading.textContent='SR215 RPF · '+label+' (full 139)';
 const observations=container.querySelector('[data-rpf-observation-download]');if(observations){observations.hidden=!payload;observations.href='metrics/sr215-rpf'+(preparation==='phenix'?'-phenix':'')+'.json';observations.textContent=label+' observations · JSON (2,000 models)';}
 for(const choice of container.querySelectorAll('[data-rpf-preparation]')){
  const key=choice.dataset.rpfPreparation;if(!Object.hasOwn(PREPARATIONS,key))continue;
  choice.checked=key===preparation;choice.disabled=key==='phenix'&&!available;
  choice.onchange=()=>{if(!choice.checked)return;container.dataset.rpfPreparation=key;rememberPreparation(key);return renderScatters(container,data,render,onSelect,comparisonLoader);};
 }
 const distributionCaption=container.querySelector('[data-rpf-distribution-note]');
 if(distributionCaption)distributionCaption.textContent=available?label+' · all 1,000 AFSample3 and 1,000 BioEMU2 matched models, scored independently on the full 139-residue construct. The shared y axes include both preparations and methods. Violins retain exact saved scores; white boxes show median/IQR, and fixed 0.005 smoothing stays within each observed range. The downloadable preparation comparison shows both preparations together. These model pools are not biological populations.':payload?'Reduce baseline only · all 1,000 AFSample3 and 1,000 BioEMU2 scores. Paired preparation data are unavailable; these axes and original figure downloads describe only the Reduce baseline. Violins retain the saved scores, white median/IQR boxes and observed-range smoothing. These model pools are not biological populations.':'Selected preparation data are unavailable.';
 for(const format of ['svg','png']){
  const violin=container.querySelector('[data-rpf-distribution-download="'+format+'"]');if(violin){violin.href='metrics/sr215-rpf-'+(available?'preparation-violin':'violin')+'.'+format;violin.textContent=(available?'Preparation comparison':'Reduce baseline distribution')+' · '+format.toUpperCase();}
  const scatter=container.querySelector('[data-rpf-ptm-download="'+format+'"]');if(scatter){scatter.href='metrics/sr215-afsample3-ptm-rpf'+(available?'-'+(preparation==='reduce'?'reduce-matched':'phenix'):'')+'.'+format;scatter.textContent=(available?label+' pTM comparison':'Reduce baseline pTM comparison')+' · '+format.toUpperCase();}
 }
 for(const body of container.querySelectorAll('[data-rpf-body]'))body.hidden=!payload||body.dataset.rpfBody!==active;
 const buttons=[...container.querySelectorAll('[data-rpf-panel]')];
 for(const [index,button]of buttons.entries()){
  button.setAttribute('aria-selected',String(button.dataset.rpfPanel===active));button.tabIndex=button.dataset.rpfPanel===active?0:-1;
  button.onclick=()=>{container.dataset.rpfView=button.dataset.rpfPanel;return renderScatters(container,data,render,onSelect,comparisonLoader);};
  button.onkeydown=event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].onclick();buttons[next].focus();};
 }
 if(!payload)return;
 const n=payload.models.filter(row=>row.method==='afsample3'&&finite(row.ptm)).length;
 const scatterNote=container.querySelector('[data-rpf-note]');if(scatterNote)scatterNote.textContent=(available?label:'Reduce baseline only')+' · '+n.toLocaleString()+' / 1,000 AFSample3 models with unchanged, source-verified native pTM. BioEMU2 has no native pTM and is excluded. Axes focus on the observed score ranges; native pTM is on a 0–1 scale. '+(available?'Shared y/color bounds and area-per-model scaling include both preparations’ AFSample3 panels.':'Paired data are unavailable; these axes and original figure downloads describe only Reduce baseline scores.')+' Each circle is an exact printed-score pair; circle area shows the number of coincident models. No jitter or score substitution is applied.';
 if(active==='distributions'){
  const colors=data.schemes.find(s=>s.key==='ais_method')?.colors||{};
  for(const [key,metric]of METRICS){
   if(Number(container.dataset.rpfSerial)!==serial)return;
   const node=container.querySelector('[data-rpf-violin="'+key+'"]');if(!node)continue;
   await render(node,distributionTraces(payload,key,colors),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:60,r:20,t:20,b:60},showlegend:false,
    yaxis:{title:{text:'RPF '+metric+' · '+label+' (full 139)'},...(available?{range:axisRange(comparison.bounds.violin[key])}:{}),gridcolor:'#edf1f2'},xaxis:{type:'category'},font:{family:'Arial, sans-serif',size:12,color:'#344f5b'},uirevision:'sr215-rpf-distribution-'+key},
    {responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:'SR215_RPF_'+preparation+'_'+metric+'_distributions'}});
  }
  return;
 }
 for(const [key,metric]of METRICS){
  if(Number(container.dataset.rpfSerial)!==serial)return;
  const node=container.querySelector('[data-rpf-scatter="'+key+'"]');if(!node)continue;
  const bounds=available?comparison.bounds.ptm[key]:null;
  await render(node,scatterTraces(payload,key,{...(bounds?{range:bounds,sizeref:comparison.bubble_sizeref}:{}),preparation:label}),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:60,r:20,t:20,b:55},showlegend:false,
   xaxis:{title:{text:'AFSample3 native pTM (0–1)'},range:available?comparison.native_ptm_range:ptmRange(payload),gridcolor:'#edf1f2'},yaxis:{title:{text:'RPF '+metric+' · '+label+' (full 139)'},...(bounds?{range:axisRange(bounds,'ptm')}:{}),gridcolor:'#edf1f2'},
   font:{family:'Arial, sans-serif',size:12,color:'#344f5b'},uirevision:'sr215-ptm-rpf-'+key},
   {responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:'SR215_AFSample3_pTM_RPF_'+preparation+'_'+metric}});
  node.removeAllListeners?.('plotly_click');node.on?.('plotly_click',event=>{const id=event.points?.[0]?.customdata?.[2];if(id&&onSelect)onSelect(id);});
 }
}
const api={TARGET,COHORT,SEQUENCE,NOTE,METRICS,validate,enrich,createLoader,cohortTarget,PREPARATIONS,COMPARISON_NOTE,matchedPreparations,createComparisonLoader,preparationFromSearch,axisRange,colorRange,scatterTraces,distributionTraces,ptmRange,renderScatters};root.AISExplorerRPF=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
