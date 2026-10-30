/* Shared population stays fixed; filters select medoid rows and fade plot points. */
let familyPrefix='',chosenClusters=null,filterCSV=null,pairSelecting=false,pairViewers=[],pairSerial=0;
function visibleCluster(label){return (!familyPrefix||label===familyPrefix||label.startsWith(familyPrefix+'.'))&&(!chosenClusters||chosenClusters.has(label))}
function configureRefinementControls(){
 familyPrefix='';chosenClusters=null;$('pairSection').hidden=true;
 const ancestors=new Set();for(const label of data.clusters){if(label.endsWith('.unassigned'))continue;const parts=label.split('.');for(let i=1;i<=parts.length;i++)ancestors.add(parts.slice(0,i).join('.'))}
 $('family').replaceChildren(Object.assign(document.createElement('option'),{value:'',textContent:'All current clusters'}),...[...ancestors].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(label=>Object.assign(document.createElement('option'),{value:label,textContent:label+' and descendants'})));
 function options(){const labels=data.representatives.map(x=>x.cluster).filter(label=>!familyPrefix||label===familyPrefix||label.startsWith(familyPrefix+'.'));$('clusterSubset').replaceChildren(...labels.map(label=>Object.assign(document.createElement('option'),{value:label,textContent:label,selected:true})));chosenClusters=null}
 options();$('family').onchange=()=>{familyPrefix=$('family').value;options();scheduleDraw().catch(fail)};
 $('clusterSubset').onchange=()=>{const selected=[...$('clusterSubset').selectedOptions].map(x=>x.value);if(!selected.length){options()}else chosenClusters=new Set(selected);scheduleDraw().catch(fail)};
 $('allClusters').onclick=()=>{options();scheduleDraw().catch(fail)};
 $('decisionsPanel').hidden=!!data.visible_view_policy||!['whole','bounded'].includes(data.view_id||'whole')||!data.decisions;
 for(const link of document.querySelectorAll?.('.page-index a[href="#decisionsPanel"]')||[])link.hidden=$('decisionsPanel').hidden;
 $('boundedSummary').textContent=data.bounded_summary||'';$('decisionRows').replaceChildren();
 for(const row of data.decisions||[]){const tr=document.createElement('tr');const aris=Object.values(row.repeat_seed_ari||{}),tm=(row.tm_validation||[]).map(x=>x.median_margin);const fmt=x=>Number.isFinite(x)?x.toFixed(3):'—';for(const value of [row.parent,row.population,row.status,(row.child_sizes||[]).join(' / '),fmt(aris.length?Math.min(...aris):null),fmt(row.feature_silhouette),fmt(tm.length?Math.min(...tm):null),(row.reasons||[]).join(', ')]){const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td)}$('decisionRows').append(tr)}
 $('waveRows').replaceChildren();for(const row of data.wave_summary||[]){const tr=document.createElement('tr');for(const value of [row.wave,row.expanded.join(', ')||'Original',row.clusters]){const td=document.createElement('td');td.textContent=String(value);tr.append(td)}$('waveRows').append(tr)}
}
function updateFilterDisplay(){
 for(const row of $('clusterRows').children)row.hidden=!visibleCluster(row.dataset.cluster);
 const groups=data.representatives.filter(x=>visibleCluster(x.cluster));const count=data.clusters.filter(visibleCluster).length;
 $('filterNote').textContent=`${groups.length} represented clusters selected; ${count.toLocaleString()} models in scope. All ${data.models.length.toLocaleString()} model points remain available; outside points are faded. Heat-map filtering reuses saved TM scores.`;
}
function filteredMedoidGrid(){
 const original=data.medoid_tm;if(!original)return null;
 const indices=original.labels.map((label,i)=>visibleCluster(label)?i:-1).filter(i=>i>=0),labels=indices.map(i=>original.labels[i]);
 const grid={...original,labels,matrix:indices.map(i=>indices.map(j=>original.matrix[i][j]))};
 if(filterCSV)URL.revokeObjectURL(filterCSV);
 const csv=[['cluster',...labels].join(','),...labels.map((label,i)=>[label,...grid.matrix[i]].join(','))].join('\n')+'\n';
 filterCSV=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));grid.csv=filterCSV;$('medoidTMCsv').download=data.target+'_'+(data.range_id||'all')+'_'+data.view_id+'_selected_medoid_TM.csv';return grid;
}
async function chooseMedoidPair(left,right,value){
 const current=data,serial=++pairSerial;
 pairSelecting=true;try{await choose(left)}finally{pairSelecting=false}
 const active=()=>serial===pairSerial&&current===data&&selected===left;
 if(!active())return;
 $('pairSection').hidden=false;$('pairSection').open=true;$('pairScore').textContent=`${left} versus ${right} · TM similarity ${value.toFixed(4)} · medoids of the displayed ensembles`;
 if(!pairViewers.length)pairViewers=[$3Dmol.createViewer($('pairLeft'),{backgroundColor:'white'}),$3Dmol.createViewer($('pairRight'),{backgroundColor:'white'})];
 for(const [i,label]of [left,right].entries()){
  const c=current.representatives.find(x=>x.cluster===label);if(!c)throw Error('Missing medoid descriptor');let text=c.coordinate_text;
  if(!text){const r=await fetch(c.file,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Medoid file unavailable');text=await r.text();c.coordinate_text=text}
  if(!active())return;const v=pairViewers[i];v.removeAllModels();v._aisModels=[v.addModel(text,c.format)];v._aisDescriptor=c;styleSavedStructure(v,c.color);v.resize();fitVisibleStructure(v);
 }
 frameMedoidPair();
}

'use strict';
let atlas,data,viewer,selected=null,spinning=false,loadSerial=0,targetRequest=0,modelDownloadURL=null,ensembleDownloadURL=null;
let projectionLegendKey='',renderQueue=Promise.resolve();
const hiddenProjectionCategories=new Set();
const $=id=>document.getElementById(id), escapeText=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function json(url){let r;try{r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(30000)})}catch(error){throw Error('The atlas service is unavailable. Reopen the local atlas or request a fresh private preview; models in an already loaded analysis remain available.')}if(!r.ok)throw Error(`Could not load ${url}: ${r.status}`);return r.json()}
function fail(error){setAnalysisLoading(false);window.AtlasExplorer?.setBusy(false);$('error').hidden=false;$('error').textContent=error.message||String(error);console.error(error)}
let clusteringResidueCatalog={},structureScopePreference='clustering',structureMappingError='';
let supplementaryMetadataCatalog={},savedHeatmapSpecs=[];
async function fetchOptionalJSON(path){
 try{const response=await fetch(path,{cache:'no-cache',signal:AbortSignal.timeout(15000)});return response.ok?await response.json():{}}catch(error){return {}}
}
async function fetchClusteringResidues(){return fetchOptionalJSON('clustering-residues.json')}
function clusteringResidues(current=data){
 const target=clusteringResidueCatalog.targets?.[current.target],range=current.range_id||'all',entry=target?.ranges?.[range]?.views?.[current.view_id||'whole']||(range==='all'?target?.views?.[current.view_id||'whole']:null);
 if(!entry||typeof entry.chain!=='string'||!Number.isInteger(entry.expected_ca_count)||entry.expected_ca_count<1||!Array.isArray(entry.canonical_positions)||!entry.canonical_positions.length)return null;
 const positions=entry.canonical_positions;
 if(positions.some(p=>!Number.isInteger(p)||p<1||p>entry.expected_ca_count)||new Set(positions).size!==positions.length)return null;
 return entry;
}
function verifiedRegions(meta){
 if(!meta?.regions_verified||!Array.isArray(meta.regions)||!meta.regions.length)return [];
 const used=new Set();for(const region of meta.regions){if(typeof region.label!=='string'||!/^#[0-9a-f]{6}$/i.test(region.color)||!Number.isInteger(region.start)||!Number.isInteger(region.end)||region.start<1||region.end<region.start||region.end>meta.expected_ca_count)return [];for(let p=region.start;p<=region.end;p++){if(used.has(p))return [];used.add(p)}}
 return meta.regions;
}
function setStructureOption(id,value,enabled){const option=Array.from($(id).options||[]).find(o=>o.value===value);if(option){option.disabled=!enabled;if(id==='structureColor'&&value==='regions')option.textContent=enabled?'Regions':'Regions — unavailable'}}
function configureModelMode(cluster=null){
 const available=cluster?!!(cluster.ensemble_file||cluster.ensemble_text):data.representatives.some(row=>row.ensemble_file||row.ensemble_text),option=Array.from($('modelMode').options||[]).find(row=>row.value==='ensemble');
 if(option){option.disabled=!available;option.textContent=available?'Comparison ensemble':'Comparison ensemble — unavailable'}
 if(!available)$('modelMode').value='medoid';
}
function configureStructureControls(){
 const meta=clusteringResidues();structureMappingError='';
 setStructureOption('structureScope','clustering',!!meta);setStructureOption('structureColor','rainbow',!!meta);setStructureOption('structureColor','regions',!!verifiedRegions(meta).length);
 $('structureScope').value=meta?structureScopePreference:'full';
 if(!meta||($('structureColor').value==='regions'&&!verifiedRegions(meta).length))$('structureColor').value='cluster';
 updateStructureScopeNote();
}
function updateStructureScopeNote(){
 const meta=clusteringResidues(),regions=verifiedRegions(meta),mode=$('structureColor').value;
 let note=meta?`Clustering uses ${meta.canonical_positions.length} canonical residues: ${meta.reference_ranges||meta.canonical_positions.join(', ')}. ${meta.note||''}`:'The exact clustering residue map is unavailable for this saved view. Only the full saved structure can be displayed; no residue clipping is inferred.';
 if(meta?.analysis_uses_full_construct)note+=' Every supplied construct residue was used; no residues were excluded, so Clustering residues and Full saved structure show the same coordinates for this analysis.';
 if(structureMappingError)note+=' '+structureMappingError;
 if(mode==='rainbow')note+=' Rainbow follows canonical chain order, blue at the N terminus to red at the C terminus.';
 if(!regions.length)note+=' Verified saved variance-region labels are unavailable.';
 note+=' Display controls do not alter saved coordinates or downloads; downloads contain the full saved structures.';
 $('structureScopeNote').textContent=note;
 const legend=$('structureRegionLegend');legend.replaceChildren();legend.hidden=mode!=='regions'||!regions.length;
 if(!legend.hidden){for(const r of [...regions,{label:'Other residues',color:'#aebbc1'}]){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.backgroundColor=r.color;item.append(swatch,document.createTextNode(r.label+(r.start?' · '+r.start+'–'+r.end:'')));legend.append(item)}const caption=document.createElement('p');caption.textContent='Regions are automated labels from the saved structural-variance analysis; they are not confirmed biological domains.'+(meta.regions_note?' '+meta.regions_note:'');legend.append(caption)}
}
function residueIdentity(atom){return String(atom.chain??'')+'|'+String(atom.resi)+'|'+String(atom.icode??'').trim()}
function canonicalResidueMap(model,meta){
 const ca=model.selectedAtoms({atom:'CA',chain:meta.chain});
 if(ca.length!==meta.expected_ca_count)throw Error(`This frame has ${ca.length} Cα residues on chain ${meta.chain||'(blank)'}, while the verified canonical map requires ${meta.expected_ca_count}.`);
 const map=new Map();for(const [i,atom]of ca.entries()){const key=residueIdentity(atom);if(map.has(key))throw Error('This frame has duplicate residue identities; its canonical residue mapping is ambiguous.');map.set(key,i+1)}return map;
}
function canonicalRainbow(position,count){
 // Blue N terminus -> cyan -> green -> yellow -> red C terminus, stable across raw PDB numbering.
 const h=240*(1-(position-1)/Math.max(1,count-1)),x=1-Math.abs((h/60)%2-1);let rgb;
 if(h<60)rgb=[1,x,0];else if(h<120)rgb=[x,1,0];else if(h<180)rgb=[0,1,x];else rgb=[0,x,1];
 return rgb.reduce((out,c)=>(out<<8)+Math.round(c*255),0);
}
function styleSavedStructure(target,color,opacity=1){
 const meta=clusteringResidues(),scope=$('structureScope').value||'full',mode=$('structureColor').value||'cluster',regions=verifiedRegions(meta),models=target._aisModels?.filter(Boolean);
 if(!models?.length){if(scope==='clustering'||mode!=='cluster'){target.setStyle({},{});structureMappingError='Frame handles are unavailable, so the verified residue selection cannot be applied. Choose Full saved structure with Cluster color.';updateStructureScopeNote();return false}target.setStyle({},{cartoon:{color,opacity}});return true}
 const mappingNeeded=scope==='clustering'||mode!=='cluster';let maps=[];
 try{if(mappingNeeded){if(!meta)throw Error('No verified canonical residue map is available.');if(mode==='regions'&&!regions.length)throw Error('No verified structural-variance regions are available.');maps=models.map(model=>canonicalResidueMap(model,meta))}}
 catch(error){models.forEach(model=>model.setStyle({},{}));structureMappingError=error.message+' Choose Full saved structure with Cluster color to inspect the original coordinates.';updateStructureScopeNote();return false}
 const kept=new Set(meta?.canonical_positions||[]);
 for(const [i,model]of models.entries()){
  const positions=maps[i],cartoon={color,opacity};
  if(mode!=='cluster')cartoon.colorfunc=atom=>{const position=positions.get(residueIdentity(atom));if(position===undefined)return '#aebbc1';if(mode==='rainbow')return canonicalRainbow(position,meta.expected_ca_count);return regions.find(r=>position>=r.start&&position<=r.end)?.color||'#aebbc1'};
  model.setStyle({},{});model.setStyle(scope==='clustering'?{predicate:atom=>kept.has(positions.get(residueIdentity(atom)))}:{},{cartoon});
 }
 structureMappingError='';updateStructureScopeNote();return true;
}
function fitVisibleStructure(target){target.zoomTo({predicate:atom=>!!atom.style?.cartoon});target.render()}
function frameMedoidPair(){
 if(pairViewers.length!==2||!pairViewers[1]._aisDescriptor)return;
 const descriptor=pairViewers[1]._aisDescriptor,ghost=pairViewers[0].addModel(descriptor.coordinate_text,descriptor.format),original=pairViewers[0]._aisModels;
 pairViewers[0]._aisModels=[ghost];styleSavedStructure(pairViewers[0],descriptor.color);pairViewers[0]._aisModels=original;
 fitVisibleStructure(pairViewers[0]);const common=pairViewers[0].getView();pairViewers[0].removeModel(ghost);pairViewers.forEach(v=>{v.setView(common);v.render()});$('pairReset').onclick=()=>pairViewers.forEach(v=>{v.setView(common);v.render()});
}
function restyleStructureViews(){
 if(viewer._aisDescriptor){styleSavedStructure(viewer,viewer._aisDescriptor.color,viewer._aisEnsemble ? .62 : 1);fitVisibleStructure(viewer)}
 for(const v of pairViewers)if(!$('pairSection').hidden&&v._aisDescriptor){styleSavedStructure(v,v._aisDescriptor.color);fitVisibleStructure(v)}
 if(!$('pairSection').hidden)frameMedoidPair();updateStructureScopeNote();
}
let projectionMetadataCatalog={schema_version:1,targets:{}};
function projectionAxisTitles(method,projection,current=data){
 if(method!=='pca')return projection.axes;
 const range=current.range_id||'all',saved=projectionMetadataCatalog.targets?.[current.target]?.ranges?.[range]?.views?.[current.view_id||'whole']?.pca;
 let ratio=saved?.explained_variance_ratio??projection.explained_variance_ratio;
 const scope=saved?.scope_label||projection.scope_label||projection.axes?.[0]?.split(' · ').slice(1).join(' · ');
 if(ratio===undefined||ratio===null){
  const legacy=(projection.axes||[]).map(text=>String(text).match(/PC(?:A)?\s*[12]\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*%(?:[^)]*)\)/i));
  if(legacy.length===2&&legacy.every(Boolean))ratio=legacy.map(match=>Number(match[1])/100);
 }
 const valid=Array.isArray(ratio)&&ratio.length===2&&ratio.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)&&ratio.reduce((a,b)=>a+b,0)<=1.000001;
 return [0,1].map(i=>'PC'+(i+1)+(valid?' ('+(100*ratio[i]).toFixed(1)+'% variance explained)':' (variance unavailable)')+(scope?' · '+scope:''));
}
function referenceSimilarity(rep){const score=data.schemes.find(s=>s.key==='tm_colabfold12_rank1_chainA_res5_95'),value=score?.values[data.models.indexOf(rep.model)];return Number.isFinite(rep.tm_to_reference)?rep.tm_to_reference:Number.isFinite(value)?value:null}
function population(count){const percent=100*count/data.models.length;return percent<.1?'<0.1%':percent.toFixed(1)+'%'}
function scheme(){return data.schemes.find(x=>x.key===$('color').value)}
function traces(method){
 const s=scheme(),xy=data.projections[method].xy,out=[],groups=new Map();
 data.models.forEach((name,i)=>{const v=s.values[i],key=s.type==='continuous'?(Number.isFinite(v)?'valid':'Not calculable'):String(v??'Unspecified');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i)});
 for(const [label,indices] of groups){const numeric=s.type==='continuous'&&label==='valid',marker={size:4.5,opacity:indices.map(i=>visibleCluster(data.clusters[i]) ? .7 : .06)};
  if(numeric)Object.assign(marker,{color:indices.map(i=>s.values[i]),colorscale:s.colorscale,cmin:s.range?.[0],cmax:s.range?.[1],showscale:false,colorbar:{title:{text:s.short_name||s.name},thickness:10,len:.7}});
  else marker.color=s.type==='continuous'?'#808080':s.colors[label]||'#808080';
  out.push({type:'scattergl',mode:'markers',name:label==='valid'?s.name:label,x:indices.map(i=>xy[i][0]),y:indices.map(i=>xy[i][1]),customdata:indices,text:indices.map(i=>`${escapeText(data.models[i])}<br>${escapeText(data.clusters[i])}<br>${escapeText(data.methods[i])}${numeric?'<br>'+s.name+': '+s.values[i].toFixed(2):''}`),hovertemplate:'%{text}<extra></extra>',marker,meta:{legendKey:label,numeric},visible:hiddenProjectionCategories.has(label)?'legendonly':true,showlegend:false});
 }if(s.type==='continuous')out.sort((a,b)=>Number(a.meta.numeric)-Number(b.meta.numeric));return out;
}
function projectionLegendTraces(){
 const s=scheme();
 return traces('pca').map(trace=>{
  const marker={...trace.marker,size:8,opacity:1};
  if(trace.meta.numeric){
   const finite=s.values.filter(Number.isFinite),range=s.range||[Math.min(...finite),Math.max(...finite)];
   Object.assign(marker,{color:range,showscale:true,cmin:range[0],cmax:range[1],colorbar:{title:{text:s.short_name||s.name},outlinewidth:0}});
  }
  return {type:'scatter',mode:'markers',name:trace.name,meta:trace.meta,x:trace.meta.numeric?[0,0]:[0],y:trace.meta.numeric?[0,0]:[0],marker,visible:trace.visible,showlegend:!trace.meta.numeric,hoverinfo:'skip'};
 });
}
function changeProjectionCategory(event,isolate=false){
 const trace=$('projectionLegend').data[event.curveNumber],key=trace?.meta?.legendKey;if(!key||trace.meta.numeric)return false;
 const keys=traces('pca').map(t=>t.meta.legendKey);
 if(isolate&&scheme().type!=='continuous'){
  const alreadyIsolated=keys.every(k=>hiddenProjectionCategories.has(k)===(k!==key));
  hiddenProjectionCategories.clear();if(!alreadyIsolated)for(const k of keys)if(k!==key)hiddenProjectionCategories.add(k);
 }else if(hiddenProjectionCategories.has(key))hiddenProjectionCategories.delete(key);else hiddenProjectionCategories.add(key);
 scheduleDraw().catch(fail);return false;
}
async function drawProjections(){
 const key=data.target+'|'+(data.range_id||'all')+'|'+(data.view_id||'whole')+'|'+scheme().key;
 if(projectionLegendKey!==key){projectionLegendKey=key;hiddenProjectionCategories.clear()}
 await Promise.all(['pca','umap','tsne'].map(async method=>{const p=data.projections[method],axes=projectionAxisTitles(method,p);await AtlasResponsive.react($(method),traces(method),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:52,r:25,t:16,b:58},showlegend:false,hovermode:'closest',font:{family:'Arial, sans-serif',size:11,color:'#344f5b'},xaxis:{title:{text:axes[0]},zeroline:false,gridcolor:'#edf1f2'},yaxis:{title:{text:axes[1]},zeroline:false,gridcolor:'#edf1f2'},uirevision:data.target+'-'+(data.range_id||'all')+'-'+(data.view_id||'whole')+'-'+method},{responsive:true,displaylogo:false,modeBarButtonsToRemove:['lasso2d']});$(method).removeAllListeners('plotly_click');$(method).on('plotly_click',e=>{const i=e.points[0].customdata;choose(data.clusters[i]).catch(fail)})}));
 const legend=$('projectionLegend');const legendCount=projectionLegendTraces().length;const panel=$('legendPanel');if(panel.dataset.legendKey!==key){panel.dataset.legendKey=key;panel.open=legendCount<=16}$('legendSummary').textContent='Shared color legend · '+(scheme().short_name||scheme().name)+(legendCount>16?' · '+legendCount+' categories':'');
 await AtlasResponsive.react(legend,projectionLegendTraces(),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:8,r:8,t:8,b:8},xaxis:{visible:false,range:[1,2],fixedrange:true},yaxis:{visible:false,range:[1,2],fixedrange:true},showlegend:true,legend:{orientation:'h',font:{size:12}},uirevision:projectionLegendKey},{displayModeBar:false,displaylogo:false,staticPlot:false});
 legend.removeAllListeners('plotly_legendclick');legend.removeAllListeners('plotly_legenddoubleclick');
 legend.on('plotly_legendclick',event=>changeProjectionCategory(event));
 legend.on('plotly_legenddoubleclick',event=>changeProjectionCategory(event,true));
 showProjection();
}
async function draw(){
 window.AtlasExplorer?.setBusy(true);
 updateFilterDisplay();await drawProjections();await drawViolins();await drawDistanceMaps();await drawCandidateReview();await drawMedoidTM();await drawBonsai();window.AtlasExplorer?.setBusy(false);
}
function configureDistanceMaps(){
 const entry=supplementaryMetadataCatalog.targets?.[data.target]?.ranges?.[data.range_id||'all'];savedHeatmapSpecs=[];
 if(entry?.views?.[data.view_id||'whole']){
  const caption=document.createElement('p');caption.className='hint';caption.textContent=entry.sample_count.toLocaleString()+' models · canonical residues '+entry.positions[0]+'–'+entry.positions.at(-1)+'. '+entry.note;
  const plots=[['median_matrix','Median Cα distance (Å)','Viridis'],['variance_matrix','Cα distance variance (Å²)','Magma']].map(([key,name,scale])=>{const section=document.createElement('section'),title=document.createElement('h3'),node=document.createElement('div');title.textContent=name;node.id='saved-'+key;section.append(title,node);savedHeatmapSpecs.push({node,entry,key,name,scale});return section});
  $('heatmaps').replaceChildren(caption,...plots);return;
 }
 const images=(data.heatmaps||[]).map(p=>{const a=document.createElement('a');a.href=p.file;a.target='_blank';const img=document.createElement('img');img.src=p.file;img.alt=p.name;img.loading='lazy';a.append(img);return a});
 if(!images.length){const note=document.createElement('p');note.className='hint';note.textContent='Distance summaries for this residue range have not been added to this saved display.';images.push(note)}
 $('heatmaps').replaceChildren(...images);
}
async function drawDistanceMaps(){
 for(const {node,entry,key,name,scale} of savedHeatmapSpecs){const positions=entry.positions;await AtlasResponsive.react(node,[{type:'heatmap',x:positions,y:positions,z:entry[key],colorscale:scale,colorbar:{title:{text:name}},hovertemplate:'Residue %{y} / %{x}<br>%{z:.3f}<extra>'+escapeText(name)+'</extra>'}],{paper_bgcolor:'#fff',margin:{l:65,r:25,t:90,b:70},xaxis:{title:{text:'Canonical residue'}},yaxis:{title:{text:'Canonical residue'},autorange:'reversed'},uirevision:data.target+'-'+data.range_id+'-'+key},{displaylogo:false});}
}
function scheduleDraw(){const request=targetRequest;renderQueue=renderQueue.catch(()=>{}).then(()=>request===targetRequest?draw():undefined);return renderQueue}
async function drawViolins(){
 const score=data.schemes.find(s=>s.key==='tm_colabfold12_rank1_chainA_res5_95');$('tmDistribution').hidden=!score;if(!score)return;
 const traces=data.representatives.filter(c=>visibleCluster(c.cluster)).map(c=>{const indices=data.clusters.map((label,i)=>label===c.cluster?i:-1).filter(i=>i>=0),values=indices.map(i=>score.values[i]).filter(Number.isFinite),name=c.cluster+' · n='+values.length;if(values.length<2||new Set(values).size<2)return {type:'scatter',mode:'markers',name,x:[name],y:[values[0]],marker:{color:c.color,size:9},hovertemplate:'TM: %{y:.4f}<extra>'+escapeText(c.cluster)+'</extra>'};return {type:'violin',name,x:values.map(()=>name),y:values,customdata:indices.filter(i=>Number.isFinite(score.values[i])).map(i=>data.models[i]),text:indices.filter(i=>Number.isFinite(score.values[i])).map(i=>data.models[i]),line:{color:c.color,width:1.3},fillcolor:c.color,opacity:.75,box:{visible:true},meanline:{visible:false},points:false,spanmode:'hard',scalemode:'width',hovertemplate:'%{text}<br>TM: %{y:.4f}<extra>'+escapeText(c.cluster)+'</extra>'}});
 await AtlasResponsive.react($('tmViolin'),traces,{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:65,r:25,t:20,b:145},font:{family:'Arial, sans-serif',size:12,color:'#344f5b'},showlegend:false,yaxis:{title:{text:'TM-score to 12mer reference (5–95)'},range:[0,1],gridcolor:'#edf1f2'},xaxis:{type:'category',tickangle:-55,automargin:true},uirevision:data.target+'-'+(data.range_id||'all')+'-'+data.view_id+'-tm-violin'},{responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:data.target+'_'+(data.range_id||'all')+'_'+data.view_id+'_TM_5-95_cluster_violins'}});
 const represented=new Set(data.representatives.filter(c=>visibleCluster(c.cluster)).map(c=>c.cluster));const scored=score.values.filter((value,i)=>Number.isFinite(value)&&represented.has(data.clusters[i])).length;
 $('violinSummary').textContent=scored.toLocaleString()+' scored models in selected structural clusters · '+traces.length+' clusters. Each violin has equal maximum width; labels give cluster sizes. Box shows median and quartiles; density ends at observed min/max. Singleton clusters are individual observations. This is structural similarity, not confidence or a sampling probability.';
 $('violinDownload').hidden=!data.violin_interactive;if(data.violin_interactive)$('violinDownload').href=data.violin_interactive;
 $('violinPdf').hidden=!data.violin_pdf;if(data.violin_pdf)$('violinPdf').href=data.violin_pdf;
}
function showProjection(){if(window.AtlasExplorer)window.AtlasExplorer.feature($('projection').value);}
async function choose(label){
 const serial=++loadSerial,current=data,cluster=current.representatives.find(x=>x.cluster===label);if(!cluster){clearStructure(label+' · no representative',label.endsWith('.unassigned')?'These models were left unassigned by HDBSCAN. No structural medoid or ensemble was calculated for this group.':'No saved representative is available for this group.');return;}
 configureModelMode(cluster);if(!pairSelecting)$('pairSection').hidden=true;selected=label;$('clusterSelect').value=label;if(bonsaiPanel&&data.bonsai)bonsaiPanel.select(label);for(const tr of $('clusterRows').children){tr.classList.toggle('selected',tr.dataset.cluster===label);tr.setAttribute('aria-selected',String(tr.dataset.cluster===label))}
 $('error').hidden=true;$('modelTitle').textContent='Loading '+label+'…';$('modelInfo').textContent='';$('structure').removeAttribute('href');$('ensemblePdb').hidden=true;$('ensemblePse').hidden=true;viewer.spin(false);viewer.removeAllModels();viewer._aisModels=[];viewer._aisDescriptor=null;viewer.render();
 let coordinate=cluster.coordinate_text;try{if(!coordinate){const response=await fetch(cluster.file,{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);coordinate=await response.text();cluster.coordinate_text=coordinate}}catch(error){if(serial!==loadSerial||data!==current)return;$('modelTitle').textContent=label+' · model unavailable';throw Error('Could not load '+label+'. The private preview may have expired. Reopen the atlas with an active service. '+error.message)}if(serial!==loadSerial||data!==current)return;
 if($('modelMode').value==='ensemble'&&!cluster.ensemble_text&&cluster.ensemble_file){const response=await fetch(cluster.ensemble_file);if(!response.ok)throw Error('Ensemble file unavailable');cluster.ensemble_text=await response.text()}if(serial!==loadSerial||data!==current)return;const ensemble=$('modelMode').value==='ensemble'&&cluster.ensemble_text;viewer._aisModels=ensemble?viewer.addModels(cluster.ensemble_text,'pdb'):[viewer.addModel(coordinate,cluster.format)];viewer._aisDescriptor=cluster;viewer._aisEnsemble=!!ensemble;styleSavedStructure(viewer,cluster.color,ensemble ? .62 : 1);

 fitVisibleStructure(viewer);viewer.spin(spinning);
 $('modelTitle').textContent=label+' · '+(ensemble?(data.ensemble_kind||'comparison ensemble'):(data.representative_kind||'structural medoid'));$('modelInfo').textContent=`${cluster.model} · ${cluster.method} · ${cluster.count.toLocaleString()} ${cluster.count===1?'model':'models'} (${population(cluster.count)})${Number.isFinite(referenceSimilarity(cluster))?' · TM (5–95): '+referenceSimilarity(cluster).toFixed(3):''}`;if(modelDownloadURL)URL.revokeObjectURL(modelDownloadURL);modelDownloadURL=URL.createObjectURL(new Blob([coordinate],{type:'text/plain'}));$('structure').hidden=false;$('structure').href=modelDownloadURL;$('structure').download=cluster.file.split('/').pop();if(ensembleDownloadURL)URL.revokeObjectURL(ensembleDownloadURL);$('ensemblePdb').hidden=!cluster.ensemble_file;if(cluster.ensemble_file)$('ensemblePdb').href=cluster.ensemble_file;$('ensemblePse').hidden=!cluster.ensemble_pse;if(cluster.ensemble_text){ensembleDownloadURL=URL.createObjectURL(new Blob([cluster.ensemble_text],{type:'text/plain'}));$('ensemblePdb').href=ensembleDownloadURL;$('ensemblePdb').download=cluster.ensemble_file.split('/').pop()}if(cluster.ensemble_pse)$('ensemblePse').href=cluster.ensemble_pse;
 for(const method of ['pca','umap','tsne']){const p=data.projections[method].xy,indices=data.clusters.map((x,i)=>x===label?i:-1).filter(i=>i>=0),valid=indices.filter(i=>Number.isFinite(p[i][0]));const x=valid.reduce((a,i)=>a+p[i][0],0)/valid.length,y=valid.reduce((a,i)=>a+p[i][1],0)/valid.length;Plotly.relayout($(method),{annotations:[{x,y,text:label,showarrow:true,arrowhead:2,ax:25,ay:-30,font:{size:11,color:'#153f4d'},bgcolor:'#ffffffdd'}]})}
}
function hashSelection(){const [target,query='']=decodeURIComponent(location.hash.slice(1)).split('?'),params=new URLSearchParams(query);return {target,range:params.get('range')||'all',view:params.get('view')||'whole'}}
function analysisHash(target,range,view){return encodeURIComponent(target)+'?range='+encodeURIComponent(range||'all')+'&view='+encodeURIComponent(view||'whole')}
function navigateSavedSection(event){
 const anchor=event.target.closest?.('a[href^="#"]');if(!anchor||event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const fragment=anchor.getAttribute('href').slice(1);let id;try{id=decodeURIComponent(fragment)}catch{return}
 const section=$(id);if(!section)return;
 event.preventDefault();if(section.tagName==='DETAILS')section.open=true;section.scrollIntoView({block:'start',behavior:'smooth'});
}
function savedResidueRanges(target){
 const configured=target.residue_ranges||[],entries=configured.filter(r=>typeof r.id==='string'&&typeof r.name==='string'),all=entries.find(r=>r.id==='all');
 return all?entries:[{id:'all',name:'All residues',data:target.data,asset_root:'',default_view:'whole',available:true},...entries];
}
function availableResidueRange(range){return range.available!==false&&typeof range.data==='string'&&!!range.data}
function rangeAssetPath(path,range){
 if(typeof path!=='string'||!path||!range.asset_root||/^(?:[a-z]+:|\/)/i.test(path))return path;
 const root=range.asset_root.replace(/\/?$/,'/');return path.startsWith(root)?path:root+path.replace(/^\.\//,'');
}
function prepareRangeAnalysis(raw,range){
 // Rebase only file references. Scientific arrays, coordinates, labels and scores stay exact.
 const current={...raw,range_id:range.id,range_name:range.name};
 current.views=(raw.views||[]).map(view=>({...view,data:rangeAssetPath(view.data,range)}));
 current.representatives=raw.representatives.map(row=>{const out={...row};for(const key of ['file','ensemble_file','ensemble_pse'])if(out[key])out[key]=rangeAssetPath(out[key],range);return out});
 current.heatmaps=(raw.heatmaps||[]).map(row=>({...row,file:rangeAssetPath(row.file,range)}));
 if(raw.bonsai)current.bonsai={...raw.bonsai,file:rangeAssetPath(raw.bonsai.file,range)};
 if(raw.medoid_tm)current.medoid_tm={...raw.medoid_tm,csv:rangeAssetPath(raw.medoid_tm.csv,range)};
 for(const key of ['membership_file','violin_interactive','violin_pdf'])if(raw[key])current[key]=rangeAssetPath(raw[key],range);
 return current;
}
async function savedViewSelection(target,range,requested){
 // A curated catalog is resolved before fetching: retired URLs never load a hidden analysis.
 if(Array.isArray(range.views)){
  const views=range.views.filter(view=>['primary','density'].includes(view.id));
  const available=view=>view?.available!==false&&typeof view?.data==='string'&&!!view.data;
  const primary=views.find(view=>view.id==='primary'&&available(view));
  if(!primary)throw Error('The curated range has no verified Primary analysis.');
  const view=views.find(view=>view.id===requested&&available(view))||primary;
  async function read(binding){
   const raw=await json(binding.data);
   if(raw.target!==target.id||raw.view_id!==binding.source_view_id)throw Error('Saved analysis differs from the verified view catalog.');
   const current=prepareRangeAnalysis(raw,{...range,asset_root:binding.asset_root||''});
   return {...current,views,policy_view_id:binding.id,visible_view_policy:true,
    presentation_asset_root:binding.asset_root||'',view_title:raw.target+' · '+binding.name+' · '+range.name};
  }
  const base=await read(primary),loaded=view===primary?base:await read(view);
  return {base,loaded,view};
 }
 const rawBase=await json(range.data),base=prepareRangeAnalysis(rawBase,range),views=base.views||[],view=views.find(x=>x.id===requested)||views.find(x=>x.id===(range.default_view||'whole'));
 return {base,loaded:view&&view.id!=='whole'?prepareRangeAnalysis(await json(view.data),range):base,view};
}
function configureResidueRangeControls(target,selectedRange,requested){
 const select=$('residueRange');select.replaceChildren(...savedResidueRanges(target).map(range=>Object.assign(document.createElement('option'),{value:range.id,textContent:range.name+(availableResidueRange(range)?'':' — '+(range.status||'awaiting verified results')),disabled:!availableResidueRange(range)})));select.value=selectedRange.id;
 const unavailable=requested!==selectedRange.id,note=$('residueRangeNote');note.hidden=!unavailable;note.textContent=unavailable?'The requested residue-range analysis is unavailable. Showing '+selectedRange.name+'; no regional result is substituted.':'';
}

function setAnalysisLoading(loading){
 $('clusterExplorer').setAttribute('aria-busy',String(loading));
 for(const id of ['residueRange','analysisView','color','clear','family','clusterSubset','allClusters','clusterSelect','modelMode','structureScope','structureColor'])$(id).disabled=loading;
}
function clearStructure(title='Select a cluster',note=''){
 ++loadSerial;++pairSerial;selected=null;viewer._aisDescriptor=null;viewer._aisModels=[];$('clusterSelect').value='';viewer.spin(false);viewer.removeAllModels();viewer._aisModels=[];viewer._aisDescriptor=null;viewer.render();
 $('modelTitle').textContent=title;$('modelInfo').textContent=note;
 for(const id of ['structure','ensemblePdb','ensemblePse']){$(id).removeAttribute('href');$(id).hidden=true}
 $('pairSection').hidden=true;if(bonsaiPanel)bonsaiPanel.select(null);
 for(const tr of $('clusterRows').children){tr.classList.remove('selected');tr.setAttribute('aria-selected','false')}
}
async function load(target,viewId='whole',rangeId='all'){
 const request=++targetRequest;++loadSerial;++pairSerial;setAnalysisLoading(true);try{
 $('modelTitle').textContent='Loading analysis…';$('modelInfo').textContent='';$('structure').removeAttribute('href');$('ensemblePdb').hidden=true;$('ensemblePse').hidden=true;viewer.spin(false);viewer.removeAllModels();viewer._aisModels=[];viewer._aisDescriptor=null;viewer.render();
 const found=atlas.targets.find(x=>x.id===target)||atlas.targets[0],ranges=savedResidueRanges(found),range=ranges.find(r=>r.id===rangeId&&availableResidueRange(r))||ranges.find(r=>r.id==='all'&&availableResidueRange(r));
 if(!range)throw Error('No verified residue-range analysis is available for this target.');
 const {base,loaded,view}=await savedViewSelection(found,range,viewId);if(request!==targetRequest)return;return await (renderQueue=renderQueue.catch(()=>{}).then(async()=>{if(request!==targetRequest)return;data=loaded;selected=null;if(data.visible_view_policy&&(view.id!==viewId||range.id!==rangeId||found.id!==target))window.history?.replaceState(null,'','#'+analysisHash(found.id,range.id,view.id));configureResidueRangeControls(found,range,rangeId);configureRefinementControls();configureStructureControls();configureModelMode();window.dispatchEvent(new CustomEvent('atlas:cohort',{detail:{current:data,base,range}}));
 const previousColor=$('color').value,requestedColor=new URLSearchParams(location.search).get('color');
 $('analysisViewLabel').hidden=false;$('analysisView').replaceChildren(...(base.views||[]).map(x=>Object.assign(document.createElement('option'),{value:x.id,textContent:x.name+(x.available===false?' — '+(x.status||'awaiting verified results'):''),disabled:x.available===false})));$('analysisView').value=view?.id||'whole';
 $('title').textContent=data.view_title||data.target;$('summary').textContent=`${range.name} · ${data.models.length.toLocaleString()} models · ${new Set(data.methods).size} methods · ${data.representatives.length} structural clusters · ${data.clusters.filter(x=>x.endsWith(".unassigned")).length.toLocaleString()} unassigned · ${data.residues} residues in supplied construct`;
 $('representativePolicy').textContent=data.representative_policy||'One exact structural medoid per cluster, selected by mean pairwise rigid-fit Cα RMSD. Medoids are structural representatives, independently of confidence.';
 $('clusterMethod').textContent=data.clustering_method_note||'All projections use the same retained, sequence-aligned Cα distance features and the default terminal-variance mask. Clusters preserve disconnected components of the seed-42 UMAP 15-neighbor graph; candidate subdivisions require feature silhouette ≥ 0.15 and agreement ≥ 0.80 with seeds 7 and 123. Cluster colors identify the same memberships in every projection.';
 $('metricNote').hidden=!data.metric_note;$('metricNote').textContent=data.metric_note||'';$('tmColumn').hidden=!data.metric_note;
 $('structureHint').textContent='Drag to rotate · scroll or pinch to zoom. Colors follow the Structure color setting.';
 for(const a of $('targets').children)a.setAttribute('aria-current',a.dataset.target===data.target?'page':'false');
 const visibleSchemes=data.schemes.filter(s=>s.key!=='origin');$('color').replaceChildren(...visibleSchemes.map(s=>Object.assign(document.createElement('option'),{value:s.key,textContent:s.name+(s.unavailable?' — unavailable':''),disabled:!!s.unavailable})));$('colorAvailability').textContent=visibleSchemes.some(s=>s.unavailable)?'Boltz2 template-only/no-MSA refold options are listed but unavailable for this cohort until matching refold records are verified.':'';
 $('color').value=visibleSchemes.find(s=>s.key==='clusters'&&!s.unavailable)?.key||visibleSchemes.find(s=>!s.unavailable).key;
 const preferredColor=previousColor||requestedColor;if(visibleSchemes.some(s=>s.key===preferredColor&&!s.unavailable))$('color').value=preferredColor;
 const reviewDownloads=data.review_downloads||(range.id==='all'&&!data.visible_view_policy?{waveMemberships:'wave-memberships.csv',decisionsDownload:'decisions.csv',boundsDownload:'bounds.json'}:{});for(const id of ['waveMemberships','decisionsDownload','boundsDownload']){const path=reviewDownloads[id];$(id).hidden=!path;if(path)$(id).href=rangeAssetPath(path,{...range,asset_root:data.presentation_asset_root??range.asset_root});else $(id).removeAttribute('href')}
 $('members').href=data.membership_file;$('clusterRows').replaceChildren();$('clusterSelect').replaceChildren(Object.assign(document.createElement('option'),{value:'',textContent:'Select a cluster'}),...data.representatives.map(c=>Object.assign(document.createElement('option'),{value:c.cluster,textContent:c.cluster+' · '+c.count.toLocaleString()})));
 for(const c of data.representatives){const tr=document.createElement('tr');tr.dataset.cluster=c.cluster;tr.tabIndex=0;tr.setAttribute('role','button');tr.setAttribute('aria-label','Inspect '+c.cluster);tr.innerHTML=`<td><span class="dot" style="background:${c.color}"></span>${escapeText(c.cluster)}</td><td>${c.count.toLocaleString()}</td><td>${escapeText(population(c.count))}</td><td>${escapeText(c.method)}</td>${data.metric_note?'<td>'+(Number.isFinite(referenceSimilarity(c))?referenceSimilarity(c).toFixed(3):'Unavailable')+'</td>':''}<td>${c.ensemble_file?'<a download href="'+escapeText(c.ensemble_file)+'">PDB</a>':''} ${c.ensemble_pse?'<a download href="'+escapeText(c.ensemble_pse)+'">PSE</a>':''}</td>`;for(const a of tr.querySelectorAll('a')){a.onclick=e=>e.stopPropagation();a.onkeydown=e=>e.stopPropagation()}tr.onclick=()=>choose(c.cluster).catch(fail);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(c.cluster).catch(fail)}};$('clusterRows').append(tr)}
 configureDistanceMaps();
 $('mask').textContent=data.mask_note;$('provenance').textContent=JSON.stringify(data.provenance,null,2);
 await draw();if(request===targetRequest){if(data.representatives.length)await choose(data.representatives[0].cluster);if(request===targetRequest)setAnalysisLoading(false)}
 }));
 }catch(error){if(request===targetRequest)throw error}
}
async function start(){
 document.addEventListener('click',navigateSavedSection);
 const loaded=await Promise.all([json('atlas.json'),fetchClusteringResidues(),fetchOptionalJSON('residue-ranges.json'),fetchOptionalJSON('projection-metadata.json'),fetchOptionalJSON('supplementary-metadata.json')]);atlas=loaded[0];clusteringResidueCatalog=loaded[1];projectionMetadataCatalog=loaded[3];supplementaryMetadataCatalog=loaded[4];const rangeCatalog=loaded[2];atlas={...atlas,targets:atlas.targets.map(target=>({...target,residue_ranges:rangeCatalog.targets?.[target.id]?.residue_ranges||target.residue_ranges}))};for(const t of atlas.targets){const a=document.createElement('a');a.href='#'+encodeURIComponent(t.id);a.textContent=t.id;a.dataset.target=t.id;$('targets').append(a)}
 viewer=$3Dmol.createViewer($('molecule'),{backgroundColor:'white',antialias:true});$('clusterSelect').onchange=()=>{if($('clusterSelect').value)choose($('clusterSelect').value).catch(fail)};
 $('structureScope').onchange=()=>{structureScopePreference=$('structureScope').value;restyleStructureViews()};$('structureColor').onchange=restyleStructureViews;
 $('modelMode').onchange=()=>{if(selected)choose(selected).catch(fail)};$('color').onchange=()=>scheduleDraw().catch(fail);$('projection').onchange=showProjection;$('clear').onclick=()=>{clearStructure();for(const m of ['pca','umap','tsne'])Plotly.relayout($(m),{annotations:[],'xaxis.autorange':true,'yaxis.autorange':true})};
 $('analysisView').onchange=()=>{location.hash=analysisHash(data.target,$('residueRange').value,$('analysisView').value)};
 $('residueRange').onchange=()=>{location.hash=analysisHash(data.target,$('residueRange').value,$('analysisView').value)};
 $('reset').onclick=()=>fitVisibleStructure(viewer);$('spin').onclick=()=>{spinning=!spinning;viewer.spin(spinning);$('spin').setAttribute('aria-pressed',String(spinning));$('spin').textContent=spinning?'Stop rotation':'Rotate'};
 window.addEventListener('hashchange',()=>{const s=hashSelection();if(atlas.targets.some(t=>t.id===s.target))load(s.target,s.view,s.range).catch(fail)});window.addEventListener('resize',()=>viewer.resize());window.addEventListener('atlas:layout',()=>{viewer.resize();pairViewers.forEach(v=>v.resize())});const s=hashSelection();await load(s.target,s.view,s.range);
}
window.addEventListener('DOMContentLoaded',()=>start().catch(fail));

async function drawCandidateReview(){
 const review=data.visible_view_policy?null:data.count_review;$('countReview').hidden=!review;if(!review)return;
 $('countNote').textContent=review.note;
 const rows=review.counts,common={paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:70,r:25,t:30,b:50},font:{family:'Arial, sans-serif',size:12,color:'#344f5b'}};
 const lines=[['within_tm_equal_cluster','Within-cluster TM','#196a8b'],['between_tm_equal_cluster_pair','Between-cluster TM','#ce6818'],['provisional_tm_contrast','Within minus between','#7c5197']].map(([key,name,color])=>({type:'scatter',mode:'lines+markers',name,x:rows.map(r=>r.k),y:rows.map(r=>r[key]),line:{color,width:2},marker:{size:6},hovertemplate:'K=%{x}<br>%{y:.4f}<extra>'+name+'</extra>'}));
 await AtlasResponsive.react($('countTradeoff'),lines,{...common,xaxis:{title:{text:'Candidate child-cluster count K'},dtick:1},yaxis:{title:{text:'TM similarity / contrast'},range:[Math.min(0,...rows.map(r=>r.provisional_tm_contrast??0))-.03,1]},legend:{orientation:'h',y:1.18},annotations:data.candidate_k?[{x:data.candidate_k,y:0,yref:'paper',text:'Current K='+data.candidate_k,showarrow:true,ay:-30}]:[]},{responsive:true,displaylogo:false});
 const current=rows.find(r=>r.k===data.candidate_k);$('ensembleTM').hidden=!current;if(!current)return;
 const matrix=Array.from({length:current.k},()=>Array(current.k).fill(null));for(const c of current.clusters)matrix[c.cluster-1][c.cluster-1]=c.within_tm;for(const p of current.between_cluster_pairs)matrix[p.left-1][p.right-1]=matrix[p.right-1][p.left-1]=p.mean_tm;
 const recordedLabels=current.labels||[...new Set(data.clusters)].filter(label=>!label.endsWith('.unassigned'));const labels=recordedLabels.length===current.k?recordedLabels:Array.from({length:current.k},(_,i)=>'Cluster '+(i+1));
 await AtlasResponsive.react($('ensembleTM'),[{type:'heatmap',z:matrix,x:labels,y:labels,zmin:0,zmax:1,colorscale:'Plasma',text:matrix.map(row=>row.map(v=>v===null?'':v.toFixed(2))),texttemplate:current.k<=15?'%{text}':'',textfont:{size:11},colorbar:{title:{text:'TM similarity'}},hovertemplate:'%{y} / %{x}<br>Mean ensemble TM: %{z:.4f}<extra></extra>'}],{...common,title:{text:'K='+current.k+' representative-ensemble TM'},yaxis:{autorange:'reversed'},xaxis:{tickangle:-45}},{responsive:true,displaylogo:false});
 $('tmEstimateNote').textContent='Off diagonal: population-weighted mean TM between each pair of representative ensembles. Diagonal: within-ensemble mean, excluding self pairs; unavailable estimates are blank. All K reuse one fixed, distance-stratified pool. These are representative estimates, not all-model distributions. Final K remains unselected.';
}

async function drawMedoidTM(){
 const grid=filteredMedoidGrid();$('medoidTMTitle').textContent=grid?.title||'TM similarity across cluster medoids';$('medoidTM').hidden=!grid;$('medoidTMNote').textContent=grid?.note||data.medoid_tm_note||'The complete medoid matrix is being prepared; no truncated grid is substituted.';$('medoidTMCsv').hidden=!grid?.csv;if(!grid)return;
 if(grid.csv)$('medoidTMCsv').href=grid.csv;
 const n=grid.labels.length,height=Math.max(500,Math.min(1000,250+n*18));
 // Reserve the rendered plot height in document flow, including after subset changes.
 $('medoidTM').style.height=height+'px';
 await AtlasResponsive.react($('medoidTM'),[{type:'heatmap',z:grid.matrix,x:grid.labels,y:grid.labels,zmin:0,zmax:1,colorscale:'Plasma',text:grid.matrix.map(row=>row.map(v=>Number.isFinite(v)?v.toFixed(2):'')),texttemplate:n<=15?'%{text}':'',colorbar:{title:{text:'TM similarity'}},hovertemplate:'%{y} / %{x}<br>TM: %{z:.4f}<extra></extra>'}],{paper_bgcolor:'#fff',margin:{l:85,r:30,t:20,b:100},font:{family:'Arial, sans-serif',size:11,color:'#344f5b'},xaxis:{tickangle:-55},yaxis:{autorange:'reversed',scaleanchor:'x'},height},{responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:data.target+'_'+(data.range_id||'all')+'_'+data.view_id+'_medoid_TM'}});
 $('medoidTM').removeAllListeners('plotly_click');$('medoidTM').on('plotly_click',e=>{const point=e.points[0];if(Number.isFinite(point.z))chooseMedoidPair(point.y,point.x,point.z).catch(fail)});
}

let bonsaiPanel=null,bonsaiSerial=0;
async function drawBonsai(){
 const serial=++bonsaiSerial,current=data;$('bonsaiPanel').hidden=!current.bonsai;if(!current.bonsai)return;
 if(!current.bonsaiPayload){const response=await fetch(current.bonsai.file,{cache:'no-cache'});if(!response.ok)throw Error('Saved Bonsai layout unavailable');const bytes=await response.arrayBuffer(),digest=globalThis.crypto?.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''):null;if(digest!==null&&digest!==current.bonsai.sha256)throw Error('Saved Bonsai layout hash mismatch');current.bonsaiPayload=JSON.parse(new TextDecoder().decode(bytes));}
 if(serial!==bonsaiSerial||data!==current)return;
 if(!bonsaiPanel)bonsaiPanel=BonsaiEnsemble.create($('bonsai'),{onChoose:(cluster,model)=>choose(cluster).catch(fail)});
 const filtered={...current.bonsaiPayload,models:current.bonsaiPayload.models.filter(r=>visibleCluster(current.clusters[current.models.indexOf(r.model)]))};bonsaiPanel.update({...current,representatives:current.representatives.filter(c=>visibleCluster(c.cluster))},filtered,scheme(),$('pca'),hiddenProjectionCategories);if(selected)bonsaiPanel.select(selected);
}

window.AtlasPlotActions={async reset(method){if(method==='bonsai')bonsaiPanel?.resetView();else await AtlasResponsive.reset($(method))},async save(method){if(method==='bonsai')return bonsaiPanel?.savePNG();return Plotly.downloadImage($(method),{format:'png',filename:data.target+'_'+(data.range_id||'all')+'_'+method,width:1200,height:900})}};
