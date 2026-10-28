'use strict';
let atlas,data,viewer,selected=null,spinning=false,loadSerial=0,targetRequest=0,modelDownloadURL=null,ensembleDownloadURL=null;
const $=id=>document.getElementById(id), escapeText=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function json(url){let r;try{r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(30000)})}catch(error){throw Error('The atlas service is unavailable. Reopen the local atlas or request a fresh private preview; models in an already loaded analysis remain available.')}if(!r.ok)throw Error(`Could not load ${url}: ${r.status}`);return r.json()}
function fail(error){$('error').hidden=false;$('error').textContent=error.message||String(error);console.error(error)}
function population(count){const percent=100*count/data.models.length;return percent<.1?'<0.1%':percent.toFixed(1)+'%'}
function scheme(){return data.schemes.find(x=>x.key===$('color').value)}
function traces(method){
 const s=scheme(),xy=data.projections[method].xy,out=[],groups=new Map();
 data.models.forEach((name,i)=>{const v=s.values[i],key=s.type==='continuous'?(Number.isFinite(v)?'valid':'Not calculable'):String(v??'Unspecified');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i)});
 for(const [label,indices] of groups){const numeric=s.type==='continuous'&&label==='valid',marker={size:4.5,opacity:.7};
  if(numeric)Object.assign(marker,{color:indices.map(i=>s.values[i]),colorscale:s.colorscale,cmin:s.range?.[0],cmax:s.range?.[1],showscale:true,colorbar:{title:{text:s.short_name||s.name},thickness:10,len:.7}});
  else marker.color=s.type==='continuous'?'#808080':s.colors[label]||'#808080';
  out.push({type:'scattergl',mode:'markers',name:label==='valid'?s.name:label,x:indices.map(i=>xy[i][0]),y:indices.map(i=>xy[i][1]),customdata:indices,text:indices.map(i=>`${escapeText(data.models[i])}<br>${escapeText(data.clusters[i])}<br>${escapeText(data.methods[i])}${numeric?'<br>'+s.name+': '+s.values[i].toFixed(2):''}`),hovertemplate:'%{text}<extra></extra>',marker,showlegend:!numeric&&(s.key!=='clusters'||groups.size<=12)});
 }if(s.type==='continuous')out.sort((a,b)=>Number(!!a.marker.showscale)-Number(!!b.marker.showscale));return out;
}
async function draw(){
 await Promise.all(['pca','umap','tsne'].map(async method=>{const p=data.projections[method];await Plotly.react($(method),traces(method),{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:52,r:25,t:(scheme().type==='continuous'||(scheme().key==='clusters'&&new Set(data.clusters).size>12))?12:150,b:58},hovermode:'closest',font:{family:'Arial, sans-serif',size:11,color:'#344f5b'},xaxis:{title:{text:p.axes[0]},zeroline:false,gridcolor:'#edf1f2'},yaxis:{title:{text:p.axes[1]},zeroline:false,gridcolor:'#edf1f2'},legend:{orientation:'h',font:{size:10},y:1.02,yanchor:'bottom'},uirevision:data.target+'-'+(data.view_id||'whole')+'-'+method},{responsive:true,displaylogo:false,modeBarButtonsToRemove:['lasso2d']});$(method).removeAllListeners('plotly_click');$(method).on('plotly_click',e=>{const i=e.points[0].customdata;choose(data.clusters[i]).catch(fail)})}));
 showProjection();await drawViolins();await drawCandidateReview();await drawMedoidTM();await drawBonsai();
}
async function drawViolins(){
 const score=data.schemes.find(s=>s.key==='tm_colabfold12_rank1_chainA_res5_95');$('tmDistribution').hidden=!score;if(!score)return;
 const traces=data.representatives.map(c=>{const indices=data.clusters.map((label,i)=>label===c.cluster?i:-1).filter(i=>i>=0),values=indices.map(i=>score.values[i]).filter(Number.isFinite),name=c.cluster+' · n='+values.length;if(values.length<2||new Set(values).size<2)return {type:'scatter',mode:'markers',name,x:[name],y:[values[0]],marker:{color:c.color,size:9},hovertemplate:'TM: %{y:.4f}<extra>'+escapeText(c.cluster)+'</extra>'};return {type:'violin',name,x:values.map(()=>name),y:values,customdata:indices.filter(i=>Number.isFinite(score.values[i])).map(i=>data.models[i]),text:indices.filter(i=>Number.isFinite(score.values[i])).map(i=>data.models[i]),line:{color:c.color,width:1.3},fillcolor:c.color,opacity:.75,box:{visible:true},meanline:{visible:false},points:false,spanmode:'hard',scalemode:'width',hovertemplate:'%{text}<br>TM: %{y:.4f}<extra>'+escapeText(c.cluster)+'</extra>'}});
 await Plotly.react($('tmViolin'),traces,{paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:65,r:25,t:20,b:145},font:{family:'Arial, sans-serif',size:12,color:'#344f5b'},showlegend:false,yaxis:{title:{text:'TM-score to 12mer reference (5–95)'},range:[0,1],gridcolor:'#edf1f2'},xaxis:{type:'category',tickangle:-55,automargin:true},uirevision:data.target+'-'+data.view_id+'-tm-violin'},{responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:'SR215_'+data.view_id+'_TM_5-95_cluster_violins'}});
 $('violinSummary').textContent=score.values.filter(Number.isFinite).length.toLocaleString()+' scored models · '+traces.length+' clusters. Each violin has equal maximum width; labels give cluster sizes. Box shows median and quartiles; density ends at observed min/max. Singleton clusters are individual observations. This is structural similarity, not confidence or a sampling probability.';
 $('violinDownload').href=data.violin_interactive||'SR215_bmr6366/tm-cluster-violins.html';
 $('violinPdf').href=data.violin_pdf||'SR215_bmr6366/tm-cluster-violins.pdf';
}
function showProjection(){const p=$('projection').value;for(const m of ['pca','umap','tsne'])$(m).parentElement.hidden=p!=='all'&&p!==m;$('plots').style.gridTemplateColumns=p==='all'?'':'1fr';for(const m of ['pca','umap','tsne'])if(!$(m).parentElement.hidden)Plotly.Plots.resize($(m))}
async function choose(label){
 const serial=++loadSerial,cluster=data.representatives.find(x=>x.cluster===label);if(!cluster)return;
 selected=label;if(bonsaiPanel&&data.bonsai)bonsaiPanel.select(label);for(const tr of $('clusterRows').children){tr.classList.toggle('selected',tr.dataset.cluster===label);tr.setAttribute('aria-selected',String(tr.dataset.cluster===label))}
 $('error').hidden=true;$('modelTitle').textContent='Loading '+label+'…';$('modelInfo').textContent='';$('structure').removeAttribute('href');viewer.spin(false);viewer.removeAllModels();viewer.render();
 let coordinate=cluster.coordinate_text;try{if(!coordinate){const response=await fetch(cluster.file,{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);coordinate=await response.text();cluster.coordinate_text=coordinate}}catch(error){if(serial!==loadSerial)return;$('modelTitle').textContent=label+' · model unavailable';throw Error('Could not load '+label+'. The private preview may have expired. Reopen the atlas with an active service. '+error.message)}if(serial!==loadSerial)return;
 const ensemble=$('modelMode').value==='ensemble'&&cluster.ensemble_text;if(ensemble){viewer.addModels(cluster.ensemble_text,'pdb')}else{viewer.addModel(coordinate,cluster.format)}viewer.setStyle({},{cartoon:{color:cluster.color,opacity:ensemble ? 0.62 : 1}});
 if(data.highlight){viewer.setStyle({},{cartoon:{color:'#aebbc1',opacity:.6}});const count=ensemble?(cluster.ensemble_text.match(/^MODEL/gm)||[]).length:1;for(let i=0;i<count;i++){const model=viewer.getModel(i),ca=model.selectedAtoms({atom:'CA',chain:data.highlight.chain}),residues=ca.slice(data.highlight.start-1,data.highlight.end).map(atom=>atom.resi);if(residues.length!==data.highlight.end-data.highlight.start+1)throw Error('Cannot map the selected canonical residue range in this structure');model.setStyle({chain:data.highlight.chain,resi:residues},{cartoon:{color:'#ef5c14',opacity:1}})}}
 viewer.zoomTo();viewer.render();viewer.spin(spinning);
 $('modelTitle').textContent=label+' · '+(ensemble?(data.ensemble_kind||'comparison ensemble'):(data.representative_kind||'structural medoid'));$('modelInfo').textContent=`${cluster.model} · ${cluster.method} · ${cluster.count.toLocaleString()} ${cluster.count===1?'model':'models'} (${population(cluster.count)})${Number.isFinite(cluster.tm_to_reference)?' · TM (5–95): '+cluster.tm_to_reference.toFixed(3):''}`;if(modelDownloadURL)URL.revokeObjectURL(modelDownloadURL);modelDownloadURL=URL.createObjectURL(new Blob([coordinate],{type:'text/plain'}));$('structure').href=modelDownloadURL;$('structure').download=cluster.file.split('/').pop();if(ensembleDownloadURL)URL.revokeObjectURL(ensembleDownloadURL);$('ensemblePdb').hidden=!cluster.ensemble_text;$('ensemblePse').hidden=!cluster.ensemble_pse;if(cluster.ensemble_text){ensembleDownloadURL=URL.createObjectURL(new Blob([cluster.ensemble_text],{type:'text/plain'}));$('ensemblePdb').href=ensembleDownloadURL;$('ensemblePdb').download=cluster.ensemble_file.split('/').pop()}if(cluster.ensemble_pse)$('ensemblePse').href=cluster.ensemble_pse;
 for(const method of ['pca','umap','tsne']){const p=data.projections[method].xy,indices=data.clusters.map((x,i)=>x===label?i:-1).filter(i=>i>=0),valid=indices.filter(i=>Number.isFinite(p[i][0]));const x=valid.reduce((a,i)=>a+p[i][0],0)/valid.length,y=valid.reduce((a,i)=>a+p[i][1],0)/valid.length;Plotly.relayout($(method),{annotations:label==='C1.1'?[]:[{x,y,text:label,showarrow:true,arrowhead:2,ax:25,ay:-30,font:{size:11,color:'#153f4d'},bgcolor:'#ffffffdd'}]})}
}
function hashSelection(){const [target,query='']=decodeURIComponent(location.hash.slice(1)).split('?');return {target,view:new URLSearchParams(query).get('view')||'whole'}}
async function load(target,viewId='whole'){
 const request=++targetRequest;++loadSerial;
 $('modelTitle').textContent='Loading analysis…';$('modelInfo').textContent='';$('structure').removeAttribute('href');viewer.spin(false);viewer.removeAllModels();viewer.render();
 const found=atlas.targets.find(x=>x.id===target)||atlas.targets[0],base=await json(found.data),view=(base.views||[]).find(x=>x.id===viewId);
 const loaded=view&&view.id!=='whole'?await json(view.data):base;if(request!==targetRequest)return;data=loaded;selected=null;
 const previousColor=$('color').value,requestedColor=new URLSearchParams(location.search).get('color');
 $('analysisViewLabel').hidden=!base.views;$('analysisView').replaceChildren(...(base.views||[]).map(x=>Object.assign(document.createElement('option'),{value:x.id,textContent:x.name})));$('analysisView').value=view?.id||'whole';
 $('title').textContent=data.view_title||data.target;$('summary').textContent=`${data.models.length.toLocaleString()} models · ${new Set(data.methods).size} methods · ${data.representatives.length} clusters · ${data.residues} residues in supplied construct`;
 $('representativePolicy').textContent=data.representative_policy||'One exact structural medoid per cluster, selected by mean pairwise rigid-fit Cα RMSD. Medoids are structural representatives, independently of confidence.';
 $('clusterMethod').textContent=data.clustering_method_note||'All projections use the same retained, sequence-aligned Cα distance features and the default terminal-variance mask. Clusters preserve disconnected components of the seed-42 UMAP 15-neighbor graph; candidate subdivisions require feature silhouette ≥ 0.15 and agreement ≥ 0.80 with seeds 7 and 123. Cluster colors identify the same memberships in every projection.';
 $('metricNote').hidden=!data.metric_note;$('metricNote').textContent=data.metric_note||'';$('tmColumn').hidden=!data.metric_note;
 $('structureHint').textContent=data.highlight?'Residues A:77–104 used for regional clustering are orange; the remaining structure is gray. Drag to rotate; scroll to zoom.':'Drag to rotate · scroll or pinch to zoom. Cartoon color matches the saved cluster palette.';
 for(const a of $('targets').children)a.setAttribute('aria-current',a.dataset.target===data.target?'page':'false');
 const visibleSchemes=data.schemes.filter(s=>s.key!=='origin');$('color').replaceChildren(...visibleSchemes.map(s=>Object.assign(document.createElement('option'),{value:s.key,textContent:s.name+(s.unavailable?' — unavailable':''),disabled:!!s.unavailable})));$('colorAvailability').textContent=visibleSchemes.some(s=>s.unavailable)?'Boltz2 template-only/no-MSA refold options are listed but unavailable for this cohort until matching refold records are verified.':'';
 $('color').value=visibleSchemes.find(s=>s.key==='ais_method'&&!s.unavailable)?.key||visibleSchemes.find(s=>!s.unavailable).key;
 const preferredColor=previousColor||requestedColor;if(visibleSchemes.some(s=>s.key===preferredColor&&!s.unavailable))$('color').value=preferredColor;
 $('members').href=data.membership_file;$('clusterRows').replaceChildren();
 for(const c of data.representatives){const tr=document.createElement('tr');tr.dataset.cluster=c.cluster;tr.tabIndex=0;tr.setAttribute('role','button');tr.setAttribute('aria-label','Inspect '+c.cluster);tr.innerHTML=`<td><span class="dot" style="background:${c.color}"></span>${escapeText(c.cluster)}</td><td>${c.count.toLocaleString()}</td><td>${escapeText(population(c.count))}</td><td>${escapeText(c.method)}</td>${data.metric_note?'<td>'+Number(c.tm_to_reference).toFixed(3)+'</td>':''}<td>${c.ensemble_file?'<a download href="'+escapeText(c.ensemble_file)+'">PDB</a>':''} ${c.ensemble_pse?'<a download href="'+escapeText(c.ensemble_pse)+'">PSE</a>':''}</td>`;for(const a of tr.querySelectorAll('a')){a.onclick=e=>e.stopPropagation();a.onkeydown=e=>e.stopPropagation()}tr.onclick=()=>choose(c.cluster).catch(fail);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(c.cluster).catch(fail)}};$('clusterRows').append(tr)}
 $('heatmaps').replaceChildren(...data.heatmaps.map(p=>{const a=document.createElement('a');a.href=p.file;a.target='_blank';const img=document.createElement('img');img.src=p.file;img.alt=p.name;img.loading='lazy';a.append(img);return a}));
 $('mask').textContent=data.mask_note;$('provenance').textContent=JSON.stringify(data.provenance,null,2);
 await draw();if(request===targetRequest)await choose(data.representatives[0].cluster);
}
async function start(){
 atlas=await json('atlas.json');for(const t of atlas.targets){const a=document.createElement('a');a.href='#'+encodeURIComponent(t.id);a.textContent=t.id;a.dataset.target=t.id;$('targets').append(a)}
 viewer=$3Dmol.createViewer($('molecule'),{backgroundColor:'white',antialias:true});
 $('modelMode').onchange=()=>{if(selected)choose(selected).catch(fail)};$('color').onchange=()=>draw().catch(fail);$('projection').onchange=showProjection;$('clear').onclick=()=>{selected=null;if(bonsaiPanel&&data.bonsai)bonsaiPanel.select(null);for(const tr of $('clusterRows').children){tr.classList.remove('selected');tr.setAttribute('aria-selected','false')}for(const m of ['pca','umap','tsne'])Plotly.relayout($(m),{annotations:[],'xaxis.autorange':true,'yaxis.autorange':true})};
 $('analysisView').onchange=()=>{location.hash=data.target+'?view='+encodeURIComponent($('analysisView').value)};
 $('reset').onclick=()=>{viewer.zoomTo();viewer.render()};$('spin').onclick=()=>{spinning=!spinning;viewer.spin(spinning);$('spin').setAttribute('aria-pressed',String(spinning));$('spin').textContent=spinning?'Stop rotation':'Rotate'};
 window.addEventListener('hashchange',()=>{const s=hashSelection();if(atlas.targets.some(t=>t.id===s.target))load(s.target,s.view).catch(fail)});window.addEventListener('resize',()=>viewer.resize());const s=hashSelection();await load(s.target,s.view);
}
window.addEventListener('DOMContentLoaded',()=>start().catch(fail));

async function drawCandidateReview(){
 const review=data.count_review;$('countReview').hidden=!review;if(!review)return;
 $('countNote').textContent=review.note;
 const rows=review.counts,common={paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:70,r:25,t:30,b:50},font:{family:'Arial, sans-serif',size:12,color:'#344f5b'}};
 const lines=[['within_tm_equal_cluster','Within-cluster TM','#196a8b'],['between_tm_equal_cluster_pair','Between-cluster TM','#ce6818'],['provisional_tm_contrast','Within minus between','#7c5197']].map(([key,name,color])=>({type:'scatter',mode:'lines+markers',name,x:rows.map(r=>r.k),y:rows.map(r=>r[key]),line:{color,width:2},marker:{size:6},hovertemplate:'K=%{x}<br>%{y:.4f}<extra>'+name+'</extra>'}));
 await Plotly.react($('countTradeoff'),lines,{...common,xaxis:{title:{text:'Candidate child-cluster count K'},dtick:1},yaxis:{title:{text:'TM similarity / contrast'},range:[Math.min(0,...rows.map(r=>r.provisional_tm_contrast??0))-.03,1]},legend:{orientation:'h',y:1.18},annotations:data.candidate_k?[{x:data.candidate_k,y:0,yref:'paper',text:'Current K='+data.candidate_k,showarrow:true,ay:-30}]:[]},{responsive:true,displaylogo:false});
 const current=rows.find(r=>r.k===data.candidate_k);$('ensembleTM').hidden=!current;if(!current)return;
 const matrix=Array.from({length:current.k},()=>Array(current.k).fill(null));for(const c of current.clusters)matrix[c.cluster-1][c.cluster-1]=c.within_tm;for(const p of current.between_cluster_pairs)matrix[p.left-1][p.right-1]=matrix[p.right-1][p.left-1]=p.mean_tm;
 const labels=Array.from({length:current.k},(_,i)=>'C1.'+(i+1));
 await Plotly.react($('ensembleTM'),[{type:'heatmap',z:matrix,x:labels,y:labels,zmin:0,zmax:1,colorscale:'Plasma',text:matrix.map(row=>row.map(v=>v===null?'':v.toFixed(2))),texttemplate:current.k<=15?'%{text}':'',textfont:{size:11},colorbar:{title:{text:'TM similarity'}},hovertemplate:'%{y} / %{x}<br>Mean ensemble TM: %{z:.4f}<extra></extra>'}],{...common,title:{text:'K='+current.k+' representative-ensemble TM'},yaxis:{autorange:'reversed'},xaxis:{tickangle:-45}},{responsive:true,displaylogo:false});
 $('tmEstimateNote').textContent='Off diagonal: population-weighted mean TM between each pair of representative ensembles. Diagonal: within-ensemble mean, excluding self pairs; unavailable estimates are blank. All K reuse one fixed, distance-stratified pool. These are representative estimates, not all-model distributions. Final K remains unselected.';
}

async function drawMedoidTM(){
 const grid=data.medoid_tm;$('medoidTMTitle').textContent=grid?.title||'TM similarity across cluster medoids';$('medoidTM').hidden=!grid;$('medoidTMNote').textContent=grid?.note||'The complete medoid matrix is being prepared; no truncated grid is substituted.';$('medoidTMCsv').hidden=!grid?.csv;if(!grid)return;
 if(grid.csv)$('medoidTMCsv').href=grid.csv;
 const n=grid.labels.length;await Plotly.react($('medoidTM'),[{type:'heatmap',z:grid.matrix,x:grid.labels,y:grid.labels,zmin:0,zmax:1,colorscale:'Plasma',text:grid.matrix.map(row=>row.map(v=>Number.isFinite(v)?v.toFixed(2):'')),texttemplate:n<=15?'%{text}':'',colorbar:{title:{text:'TM similarity'}},hovertemplate:'%{y} / %{x}<br>TM: %{z:.4f}<extra></extra>'}],{paper_bgcolor:'#fff',margin:{l:85,r:30,t:20,b:100},font:{family:'Arial, sans-serif',size:11,color:'#344f5b'},xaxis:{tickangle:-55},yaxis:{autorange:'reversed',scaleanchor:'x'},height:Math.max(500,Math.min(1000,250+n*18))},{responsive:true,displaylogo:false,toImageButtonOptions:{format:'svg',filename:data.target+'_'+data.view_id+'_medoid_TM'}});
 $('medoidTM').removeAllListeners('plotly_click');$('medoidTM').on('plotly_click',e=>choose(e.points[0].x).catch(fail));
}

let bonsaiPanel=null,bonsaiSerial=0;
async function drawBonsai(){
 const serial=++bonsaiSerial,current=data;$('bonsaiSection').hidden=!current.bonsai;if(!current.bonsai)return;
 if(!current.bonsaiPayload){const response=await fetch(current.bonsai.file,{cache:'no-cache'});if(!response.ok)throw Error('Saved Bonsai layout unavailable');const bytes=await response.arrayBuffer(),digest=crypto.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''):null;if(digest!==null&&digest!==current.bonsai.sha256)throw Error('Saved Bonsai layout hash mismatch');current.bonsaiPayload=JSON.parse(new TextDecoder().decode(bytes));}
 if(serial!==bonsaiSerial||data!==current)return;
 if(!bonsaiPanel)bonsaiPanel=BonsaiEnsemble.create($('bonsai'),{onChoose:(cluster,model)=>choose(cluster).catch(fail)});
 bonsaiPanel.update(current,current.bonsaiPayload,scheme(),$('pca'));if(selected)bonsaiPanel.select(selected);
}
