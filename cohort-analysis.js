'use strict';
const $=id=>document.getElementById(id);
const original2000=document.documentElement.dataset.cohort==='2000',dataRoot=original2000?'analysis-2000':'analysis';
let result,repRows,viewer,loadSerial=0;
function text(tag,value){const node=document.createElement(tag);node.textContent=String(value);return node}
function cell(row,value,cls){const node=text('td',value);if(cls)node.className=cls;row.append(node);return node}
function number(value){return Number.isFinite(value)?value.toFixed(4):'Pending'}
function rpfNumber(value,digits=2){return Number.isFinite(value)?value.toFixed(digits):'Pending'}
function link(label,url,download=false){const a=text('a',label);a.href=url;if(download)a.download='';return a}
function empty(table,count,message){const row=document.createElement('tr'),td=cell(row,message);td.colSpan=count;$(table).append(row)}
function selectedMask(){return result.masks.find(row=>row.id===$('mask').value)}
function shortModel(model){return model.replace(/^SR215_bmr6366__/,'')}
function atlasURL(mask,view){return './?color=ais_method#SR215_bmr6366?cohort='+result.cohort_id+'&range='+mask+'&view='+view}
async function inspectPanel(panel){
 const serial=++loadSerial;$('panelInspection').hidden=false;$('panelTitle').textContent=panel.label;$('memberRows').replaceChildren(...panel.models.map(model=>text('li',model)));$('modelStatus').textContent='Loading the exact scored ensemble…';
 try{const response=await fetch(panel.pdb);if(!response.ok)throw Error('The scored ensemble could not be loaded.');const bytes=new Uint8Array(await response.arrayBuffer());if(serial!==loadSerial)return;const digest=AISExplorerTMStates.sha256(bytes);if(digest!==panel.pdb_sha256)throw Error('The ensemble hash differs from the accepted native query.');const pdb=new TextDecoder().decode(bytes);viewer=viewer||$3Dmol.createViewer($('molecule'),{backgroundColor:'white'});viewer.removeAllModels();viewer.addModels(pdb,'pdb');viewer.setStyle({},{cartoon:{color:'spectrum',opacity:.6}});viewer.resize();viewer.zoomTo();viewer.render();$('modelStatus').textContent=panel.models.length+' scored conformers · full 139-residue structures · SHA-256 verified';}
 catch(error){$('modelStatus').textContent=error.message}
}
function render(){
 const mask=selectedMask(),repeat=Number($('repeat').value),view=$('view').value;
 ++loadSerial;$('panelInspection').hidden=true;
 $('representativeRows').replaceChildren();const representatives=repRows.filter(row=>row.mask===mask.id&&row.view===view);$('representativeCoverage').textContent=representatives.length+' of '+representatives.length+' representatives have all three TM scores.';
 for(const item of representatives){const row=document.createElement('tr');cell(row,item.cluster);cell(row,shortModel(item.model),'model');for(const key of ['tm_260_state1','tm_260_state2','tm_260_state3'])cell(row,number(item[key]));$('representativeRows').append(row)}
 $('samplingNote').textContent=mask.sampling_note||'Sampling is in progress; no ensemble scores are inferred from individual-model scores.';$('stateRows').replaceChildren();
 if(result.panel_preparation_note)$('samplingNote').textContent+=' '+result.panel_preparation_note;
 $('samplingDiagnostics').textContent=mask.sampling_diagnostics||'';
 for(const state of mask.states||[]){const row=document.createElement('tr');cell(row,state.id);cell(row,state.count);cell(row,state.tm_positions_label);cell(row,shortModel(state.anchor),'model');$('stateRows').append(row)}
 if(!mask.states?.length)empty('stateRows',4,'No accepted state sampling results have been imported yet.');
 $('panelRows').replaceChildren();const panels=(result.panels||[]).filter(row=>row.mask===mask.id&&row.repeat===repeat);$('panelCoverage').textContent=panels.length+' panels for this subset and repeat; '+panels.filter(p=>p.accepted).length+' have accepted native ensemble RPF results.';
 for(const panel of panels){const row=document.createElement('tr');cell(row,panel.state);cell(row,panel.method.toUpperCase());cell(row,panel.models.length);for(const key of ['dp','recall','precision'])cell(row,rpfNumber(panel[key]));cell(row,panel.best_model?shortModel(panel.best_model)+' · DP '+rpfNumber(panel.best_dp,4):'—','model');const actions=cell(row,'');if(panel.accepted&&panel.pdb){const button=text('button','View ensemble');button.onclick=()=>inspectPanel(panel);actions.append(button,link('PDB',panel.pdb,true))}if(panel.members_csv)actions.append(' ',link('Members',panel.members_csv,true));actions.append(' ',link('Highlight in atlas',atlasURL(panel.mask,'density')+'&sampleState='+encodeURIComponent(panel.state)+'&sampleMethod='+panel.method+'&sampleRepeat='+panel.repeat));$('panelRows').append(row)}
 if(!panels.length)empty('panelRows',8,'MCMC / DISCO panels are not yet accepted for this selection.');
 const kind=$('comparison').value,comparisons=(result.double_recall||[]).filter(row=>(row.mask===mask.id||row.kind==='medoid-pair')&&(row.repeat===repeat||row.kind==='medoid-pair')&&(kind==='all'||row.kind===kind));$('doubleRows').replaceChildren();$('doubleCoverage').textContent=comparisons.length+' accepted bidirectional comparisons for the current filters.';
 for(const comparison of comparisons){const row=document.createElement('tr');cell(row,comparison.a_label);cell(row,comparison.b_label);cell(row,comparison.a_explained_by_b);cell(row,comparison.b_explained_by_a);cell(row,'').append(link('Report',comparison.report));$('doubleRows').append(row)}
 if(!comparisons.length)empty('doubleRows',5,'No accepted Double Recall outputs have been imported for this selection.');
}
async function start(){
 try{const responses=await Promise.all([fetch(dataRoot+'/summary.json'),fetch(dataRoot+'/representative-tm.json')]);if(responses.some(r=>!r.ok))throw Error('The analysis manifest could not be loaded.');[result,repRows]=await Promise.all(responses.map(r=>r.json()));if(result.cohort_models!==(original2000?2000:2150)||result.masks.length!==4||repRows.length!==result.representative_entries)throw Error('The cohort or four-subset manifest is incomplete.');$('status').textContent=result.status_note;document.title='SR215 · '+result.cohort_models.toLocaleString()+'-model cohort results';document.querySelector('h1').textContent='SR215 · '+result.cohort_models.toLocaleString()+'-model cohort';$('cohortDescription').textContent=result.cohort_description;$('atlasLink').href=atlasURL('all','density');for(const a of document.querySelectorAll('a[href^="analysis/"]'))a.href=a.getAttribute('href').replace(/^analysis\//,dataRoot+'/');if(result.repeats===1)$('repeat').replaceChildren(Object.assign(text('option','1'),{value:'1'}));
 const stats=result.model_statistics||[],afs=stats.find(r=>r.label==='AFS3'),bio=stats.find(r=>r.label==='BioEmu2');if(afs&&bio)$('keyObservations').append(text('li','AFS3 has higher descriptive standalone DP in this cohort: median '+rpfNumber(afs.dp,4)+' versus '+rpfNumber(bio.dp,4)+' for BioEmu2. Highest standalone DP: '+shortModel(afs.best_model)+' ('+rpfNumber(afs.best_dp,4)+').'));if(result.panels?.length)$('keyObservations').append(text('li',result.panels.length+' accepted 50-model sampled ensembles have native DP '+rpfNumber(Math.min(...result.panels.map(p=>p.dp)))+'–'+rpfNumber(Math.max(...result.panels.map(p=>p.dp)))+'. The tables retain recall and precision separately.'));if(result.masks.every(m=>m.states?.length===1))$('keyObservations').append(text('li','Each subset yielded one supported TM state under the bounded search. Membership changes with residue scope; these results do not establish a single biological state.'));
 $('modelScoresDownload').href=dataRoot+'/model-scores-'+result.cohort_models+'.csv';
 for(const mask of result.masks){$('mask').append(Object.assign(text('option',mask.name),{value:mask.id}));const row=document.createElement('tr');cell(row,mask.name);cell(row,mask.primary_clusters);cell(row,mask.density_clusters);cell(row,mask.density_unassigned);cell(row,'').append(link('UMAP KNN',atlasURL(mask.id,'primary')),' · ',link('HDBSCAN',atlasURL(mask.id,'density')));$('clusteringRows').append(row)}
 $('modelScoreNote').textContent=result.model_score_note||'Remaining native scores are in progress.';
 for(const item of result.model_statistics||[]){const row=document.createElement('tr');cell(row,item.label);cell(row,item.scored+' / '+item.selected);for(const key of ['dp','recall','precision'])cell(row,rpfNumber(item[key],item.precision_digits));cell(row,item.best_model?shortModel(item.best_model)+' · DP '+rpfNumber(item.best_dp,item.precision_digits):'—','model');cell(row,item.preparation);$('modelScoreRows').append(row)}
 if(!result.model_statistics?.length)empty('modelScoreRows',7,'No completed cohort-level score import yet.');
 for(const item of result.reference_medoids||[]){const row=document.createElement('tr');cell(row,item.label);cell(row,shortModel(item.model),'model');for(const key of ['dp','recall','precision'])cell(row,rpfNumber(item[key]));$('medoidRows').append(row)}
 for(const note of result.method_notes)$('methodNotes').append(text('li',note));for(const download of result.downloads){const li=document.createElement('li');li.append(link(download.label,download.url,true));$('downloads').append(li)}for(const id of ['mask','view','repeat','comparison'])$(id).onchange=render;render();
 }catch(error){$('status').textContent=error.message;$('status').className='pending'}
}
start();
