/* Source-bound RPF annotations. Color functions are the unchanged RPF viewer API. */
(function(root){'use strict';
const TARGET='SR215_bmr6366',COHORT='afsample3-bioemu2';
const RESIDUE_IDS=['legacy_rpf_heat','precision_violation_groups','short_precision_violation_groups','shortest_unsupported_distance'];
const LABELS={rpf_dp:'RPF DP',rpf_recall:'RPF Recall',rpf_precision:'RPF Precision',legacy_rpf_heat:'RPF residue heat',precision_violation_groups:'Precision violations',short_precision_violation_groups:'Short violations (<3 Å)',shortest_unsupported_distance:'Shortest unsupported distance'};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),need=(x,m)=>{if(!x)throw Error(m)};
const isMetric=mode=>Object.hasOwn(LABELS,mode),isResidue=mode=>RESIDUE_IDS.includes(mode);
function records(data,descriptor,count){
 need(data?.target===TARGET&&data.cohort_id===COHORT&&data.rpf_overlay_status==='available'&&data.rpf_payload?.score_context==='independent_single_model','Verified RPF source identities are unavailable.');
 const lookup=new Map(data.rpf_payload.models.map(r=>[r.model_id,r]));
 const bindings=descriptor?._frameBindings||(count===1?[{model_id:descriptor?.model,source_sha256:lookup.get(descriptor?.model)?.source_sha256}]:[]);
 need(bindings.length===count&&new Set(bindings.map(r=>r.model_id)).size===count,'Saved ensemble frame identities are unavailable or ambiguous.');
 return bindings.map(b=>{const r=lookup.get(b.model_id);need(r&&hash(b.source_sha256)&&r.source_sha256===b.source_sha256,'Structure frame and RPF source hashes differ.');return r});
}
function validateResidues(payload,data){
 need(payload?.schema_version===1&&payload.kind==='independent_model_residue_diagnostics'&&payload.target===TARGET&&payload.sequence_sha256===data.rpf_payload?.sequence_sha256&&payload.preparation_variant==='reduce'&&payload.score_context==='independent_single_model'&&payload.scientific_calls===0,'Residue diagnostic scope or preparation differs.');
 need(payload.provenance?.rpf_results_sha256===data.rpf_payload.provenance.rpf_results_sha256&&payload.provenance.chemical_shifts_sha256===data.rpf_payload.provenance.experimental_files_sha256['input6Q/sr215.bmrb'],'Residue diagnostic source differs from the saved RPF run.');
 const reference=new Map(data.rpf_payload.models.map(r=>[r.model_id,r])),seen=new Set();
 need(Array.isArray(payload.models)&&Array.isArray(payload.layers)&&JSON.stringify(payload.layers.map(r=>r.id))===JSON.stringify(RESIDUE_IDS),'Incomplete residue layer definitions.');
 for(const row of payload.models){
  const baseline=reference.get(row.model_id);need(baseline&&!seen.has(row.model_id)&&row.source_sha256===baseline.source_sha256&&row.prepared_sha256===baseline.prepared_sha256&&hash(row.qp_sha256)&&hash(row.native_archive_sha256),'Residue model/source/preparation identity differs.');seen.add(row.model_id);
  need(row.values?.length===4,'Missing native residue layers.');
  for(const [i,values] of row.values.entries()){
   need(values.length===139&&values.every(v=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0),'Invalid canonical residue values.');
   if(i===0)need(row.heat_colors?.length===139&&row.heat_colors.every(v=>/^#[0-9a-f]{6}$/i.test(v)),'Native RPF residue RGB values are missing.');
  }
 }
 return payload;
}
function plan({data,descriptor,count,mode,preparation='reduce',residues=null,colors}){
 need(isMetric(mode),'Unknown structure metric.');const rows=records(data,descriptor,count);
 if(!isResidue(mode)){
  const key=(preparation==='phenix'?'phenix_':'')+mode;
  need(preparation==='reduce'||preparation==='phenix'&&data.phenix_rpf_status==='available','Requested RPF preparation is unavailable.');
  const scheme=data.schemes.find(s=>s.key===key);need(scheme?.type==='continuous'&&scheme.values.length===data.models.length,'Requested RPF model score is unavailable.');
  const indices=new Map(data.models.map((id,i)=>[id,i])),values=rows.map(r=>scheme.values[indices.get(r.model_id)]),finite=values.filter(Number.isFinite),domain=finite.length?[Math.min(...finite),Math.max(...finite)]:[0,1];
  return {rows,values,domain,label:LABELS[mode],preparation,scope:'model',palette:colors.VIRIDIS,missing:colors.MISSING,
   frameColor:i=>colors.paletteColor(values[i],...domain),value:i=>values[i]};
 }
 need(preparation==='reduce','Saved residue diagnostics use Reduce preparation.');need(residues,'Saved residue diagnostics are unavailable.');
 const validated=validateResidues(residues,data),lookup=new Map(validated.models.map(r=>[r.model_id,r])),index=RESIDUE_IDS.indexOf(mode),layer=validated.layers[index];
 const diagnostics=rows.map(r=>lookup.get(r.model_id)||null),values=diagnostics.flatMap(r=>r?r.values[index].filter(Number.isFinite):[]);
 const domain=['legacy_rpf_heat','shortest_unsupported_distance'].includes(mode)?layer.domain:[0,Math.max(0,...values)];
 const palette=layer.colors;
 return {rows,domain,label:LABELS[mode],preparation,scope:'residue',palette,layer,missing:layer.missing_color,
  available:diagnostics.filter(Boolean).length,
  residueColor:(i,position)=>{const r=diagnostics[i];return colors.residueColor(r&&position>=1&&position<=139?{value:r.values[index][position-1],...(index===0?{color:r.heat_colors[position-1]}:{})}:null,layer,domain,palette)},
  value:()=>null};
}
function bind({document,getData,getViewer,restyle}){
 const $=id=>document.getElementById(id),colors=root.RpfStructure.colors;let residuePayload=null,pending=null,configured=false,frameKey='';
 const select=$('structureColor');
 const group=document.createElement('optgroup');group.label='RPF';
 for(const [value,label] of Object.entries(LABELS)){const option=document.createElement('option');option.value=value;option.textContent=label;group.append(option)}select.append(group);
 function available(){return getData()?.target===TARGET&&getData()?.cohort_id===COHORT&&getData()?.rpf_overlay_status==='available'}
 function prepare(){
  const current=getData(),ok=available();group.hidden=!ok;for(const option of group.children)option.disabled=!ok||isResidue(option.value)&&!residuePayload;
  if(ok&&!configured){configured=true;const plot=$('color').value;if(/^(phenix_)?rpf_(dp|recall|precision)$/.test(plot)){select.value=plot.replace('phenix_','');$('structureMetricPreparation').value=plot.startsWith('phenix_')?'phenix':'reduce'}}
  if(!ok&&isMetric(select.value))select.value='cluster';if(!isMetric(select.value))legend(null);
  $('structureMetricPreparationBox').hidden=!isMetric(select.value);const residue=isResidue(select.value),phenix=$('structureMetricPreparation').querySelector('option[value="phenix"]');phenix.disabled=residue||current?.phenix_rpf_status!=='available';if(residue)$('structureMetricPreparation').value='reduce';
  const viewer=getViewer(),models=viewer?._aisModels||[],descriptor=viewer?._aisDescriptor;let rows=[];try{if(ok)rows=records(current,descriptor,models.length)}catch{}
  const key=rows.map(r=>r.model_id).join('|');if(key!==frameKey){frameKey=key;$('structureFrame').replaceChildren(...rows.map((r,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+' · '+r.model_id.replace(/^SR215_bmr6366__/, '').replaceAll('__',' · ');return o}));$('structureFocus').checked=false}
  $('structureFrameControls').hidden=models.length<2;$('structureFrameLabel').hidden=rows.length<2;$('structureFocusBox').hidden=rows.length<2;$('structureOpacityBox').hidden=models.length<2;
  if(ok&&!residuePayload&&!pending){pending=load().then(payload=>{residuePayload=validateResidues(payload,getData());prepare();if(isResidue(select.value))restyle()}).catch(error=>{$('structureMetricStatus').textContent='Residue diagnostics unavailable: '+error.message}).finally(()=>{pending=null})}
 }
 async function load(){
  const response=await fetch('metrics/sr215-residue-catalog.json',{cache:'no-cache'});need(response.ok,'Diagnostic catalog unavailable.');const descriptor=await response.json();
  need(descriptor?.file==='metrics/sr215-residue-metrics.json.gz'&&hash(descriptor.sha256),'Invalid diagnostic catalog.');
  const bytes=await root.AISExplorerPooledMetrics.checkedBytes(descriptor.file,descriptor.sha256,descriptor.bytes);
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text());
 }
 function legend(result,error=''){
  const node=$('structureMetricLegend');node.replaceChildren();node.hidden=!result&&!error;
  if(error){node.textContent=error;return}
  if(!result)return;
  node.title=result.scope==='model'?'Independent single-model RPF scores on the full 139-residue construct. Colors use the selected state ensemble range. Scores retain their saved preparation and scorer; displayed AIS coordinates are unchanged.':result.layer.definition+' Full-construct, independent single-model diagnostic; gray indicates unavailable values.';
  const title=document.createElement('span');title.textContent=result.label+' · '+(result.preparation==='phenix'?'phenix.reduce':'Reduce');node.append(title);
  const scale=document.createElement('span');scale.className='structure-metric-scale';
  const stops=result.layer?.color_stops;scale.style.background=stops?'linear-gradient(to right,'+stops.map(s=>s.color+' '+(100*(s.value-result.domain[0])/(result.domain[1]-result.domain[0]))+'%').join(',')+')':'linear-gradient(to right,'+result.palette.join(',')+')';node.append(scale);
  const bounds=document.createElement('span');bounds.textContent=result.domain.map(v=>Number(v.toPrecision(3))).join(' – ')+(result.scope==='model'?' · ensemble range':'');node.append(bounds);
  if(result.scope==='model'){const index=Number($('structureFrame').value||0),value=result.value(index),score=document.createElement('span');score.textContent='Model '+(index+1)+': '+(Number.isFinite(value)?value.toFixed(3):'unavailable');node.append(score)}
  const missing=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=result.missing;missing.append(swatch,document.createTextNode('Unavailable'));node.append(missing);
  if(result.scope==='residue'){const note=document.createElement('span');note.textContent='Independent model diagnostics';node.append(note);if(result.available!==result.rows.length){const count=document.createElement('span');count.textContent=result.available+'/'+result.rows.length+' models annotated';node.append(count)}}
 }
 function style(target,maps){
  if(!isMetric(select.value))return null;
  try{const result=plan({data:getData(),descriptor:target._aisDescriptor,count:target._aisModels.length,mode:select.value,preparation:$('structureMetricPreparation').value,residues:residuePayload,colors});
   if(target===getViewer())legend(result);return {colorfunc:(i,atom)=>result.scope==='model'?result.frameColor(i):result.residueColor(i,maps[i].get(String(atom.chain??'')+'|'+String(atom.resi)+'|'+String(atom.icode??'').trim()))};
  }catch(error){if(target===getViewer())legend(null,error.message);return {colorfunc:()=>colors.MISSING}}
 }
 function visibility(target){
  if(target!==getViewer())return;
  const focus=$('structureFocus').checked,index=Number($('structureFrame').value||0);
  target._aisModels?.forEach((model,i)=>{if(focus&&i!==index)model.hide();else model.show()});
 }
 select.addEventListener('change',()=>{prepare();if(!isMetric(select.value))legend(null)});
 for(const id of ['structureMetricPreparation','structureFrame','structureFocus','structureOpacity'])$(id).addEventListener(id==='structureOpacity'?'input':'change',()=>{prepare();$('structureOpacityValue').textContent=$('structureOpacity').value+'%';restyle()});
 return {prepare,style,visibility,isMetric,opacity:()=>Number($('structureOpacity').value)/100,clearLegend:()=>legend(null)};
}
const api={RESIDUE_IDS,LABELS,isMetric,isResidue,records,validateResidues,plan,bind};root.AISStructureMetrics=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
