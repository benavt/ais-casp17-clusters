/* Display-only uploaded-state identity. Never calculates medoids, TM or clusters. */
(function(root){
 'use strict';
 const COHORT='afsample3-bioemu2-260-states-2150';
 const STATES=[1,2,3].map(n=>({state:'260_state'+n,label:'260 State '+n,color:['#1f77b4','#ff7f0e','#9467bd'][n-1]}));
 const originalMethodCopy=new WeakMap();
 const escapeText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function inventory(data){
  if(data?.cohort_id!==COHORT)return null;
  if(data.models?.length!==2150||new Set(data.models).size!==2150||data.methods?.length!==2150)throw Error('Uploaded-state cohort must contain exactly 2,150 distinct models.');
  const medoids=data.uploaded_state_medoids;
  if(!Array.isArray(medoids)||medoids.length!==3)throw Error('Three accepted uploaded-state medoids are required.');
  const groups=STATES.map(state=>{
   const indices=data.methods.map((method,i)=>method===state.label?i:-1).filter(i=>i>=0);
   if(indices.length!==50)throw Error(state.label+' must contain exactly 50 models.');
   const matches=medoids.filter(row=>row.state===state.state),medoid=matches[0];
   if(matches.length!==1||!indices.includes(data.models.indexOf(medoid.model))||!Number.isFinite(medoid.mean_ca_rmsd))throw Error(state.label+' medoid identity is invalid.');
   return {...state,indices,medoid,medoidIndex:data.models.indexOf(medoid.model)};
  });
  const uploaded=new Set(groups.flatMap(group=>group.indices));
  if(uploaded.size!==150||data.methods.filter(m=>m==='AFS3').length!==1000||data.methods.filter(m=>m==='BioEMU2').length!==1000)throw Error('The five method populations differ from the frozen cohort.');
  return {groups,uploaded};
 }
 function subsetTrace(trace,keep){
  const copy={...trace,marker:trace.marker?{...trace.marker}:undefined};
  for(const key of ['x','y','customdata','text','hovertext','ids'])if(Array.isArray(trace[key]))copy[key]=keep.map(i=>trace[key][i]);
  if(copy.marker)for(const key of ['size','opacity','color','symbol'])if(Array.isArray(trace.marker[key]))copy.marker[key]=keep.map(i=>trace.marker[key][i]);
  return copy;
 }
 function decorate(data,method,traces){
  const catalog=inventory(data);if(!catalog)return traces;
  const xy=data.projections[method].xy;
  const predictions=traces.map(trace=>{
   if(!Array.isArray(trace.customdata))return trace;
   return subsetTrace(trace,trace.customdata.map((index,i)=>catalog.uploaded.has(index)?-1:i).filter(i=>i>=0));
  }).filter(trace=>!Array.isArray(trace.x)||trace.x.length);
  for(const group of catalog.groups){
   const indices=[...group.indices.filter(i=>i!==group.medoidIndex),group.medoidIndex];
   predictions.push({type:'scatter',mode:'markers',name:group.label+' · 50 ★',
    x:indices.map(i=>xy[i][0]),y:indices.map(i=>xy[i][1]),customdata:indices,
    text:indices.map(i=>escapeText(data.models[i])+'<br>'+group.label+(i===group.medoidIndex?'<br><b>Structural medoid</b> · mean Cα RMSD '+group.medoid.mean_ca_rmsd.toFixed(3)+' Å':'<br>Uploaded conformer')+'<br>'+escapeText(data.clusters[i])),
    hovertemplate:'%{text}<extra></extra>',marker:{symbol:'star',color:group.color,size:indices.map(i=>i===group.medoidIndex?21:10),opacity:1,line:{color:'#ffffff',width:.8}},
    zorder:100,cliponaxis:false,showlegend:false,meta:{uploadedState:true,legendKey:group.label,numeric:false}});
  }
  return predictions;
 }
 function medoidDescriptor(data,index){
  const catalog=inventory(data);if(!catalog)return null;
  const group=catalog.groups.find(group=>group.medoidIndex===index);if(!group)return null;
  if(typeof group.medoid.file!=='string'||!group.medoid.file)throw Error('The exact uploaded-state medoid coordinate file is unavailable.');
  return {...group.medoid,cluster:data.clusters[index],method:group.label,count:1,color:group.color,format:group.medoid.format||'pdb',uploadedStateMedoid:true};
 }
 function starMeta(data,index){
  if(data?.cohort_id!==COHORT)return null;
  const state=STATES.find(state=>state.label===data.methods[index]);if(!state)return null;
  return {...state,medoid:data.uploaded_state_medoids.some(row=>row.state===state.state&&row.model===data.models[index])};
 }
 function starPath(x,y,radius){
  return Array.from({length:10},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/5,r=i%2?radius*.42:radius;return (i?'L':'M')+(x+Math.cos(angle)*r)+','+(y+Math.sin(angle)*r);}).join(' ')+' Z';
 }
 function updateMethodCopy(data){
  for(const node of root.document?.querySelectorAll('.current-view-copy')||[]){
   if(!originalMethodCopy.has(node))originalMethodCopy.set(node,node.textContent);
   node.textContent=data?.cohort_id===COHORT?'This cohort contains 2,150 models and four saved clustering ranges. Each joint fit includes 1,000 AFS3, 1,000 BioEMU2 and 150 uploaded 260-state conformers. Current standalone RPF / DP scores annotate all 2,150 models; the linked results include native sampled-panel scores and Double Recall. TM comparisons to the three uploaded-state medoids use all 139 residues in every clustering view.':originalMethodCopy.get(node);
  }
 }
 function show(data){
  updateMethodCopy(data);const downloads=root.document?.getElementById('stateCohortDownloads');if(downloads)downloads.hidden=data?.cohort_id!==COHORT;
  let box=root.document?.getElementById('uploadedStateIdentity');
  if(data?.cohort_id!==COHORT){if(box)box.hidden=true;return;}
  const {groups}=inventory(data);
  if(!box){box=root.document.createElement('aside');box.id='uploadedStateIdentity';box.className='uploaded-state-identity';const anchor=root.document.getElementById('legendPanel');anchor.after(box);}
  box.hidden=false;
  // The cohort results link is appended after the standard state identity content.
  box.innerHTML='<p><strong>2,150-model joint cohort</strong> · 1,000 AFS3 + 1,000 BioEMU2 + 50 conformers from each uploaded 260 state. Fixed-color stars retain state identity in every color mode; larger stars mark the three structural medoids.</p><details><summary>260 state medoids and TM comparisons</summary><p>Each medoid minimizes mean pairwise rigid-fit Cα RMSD among its original 50 conformers, using all 139 residues. The same three medoids are marked in every clustering range. TM color annotations compare each medoid to all 2,000 AFS3 / BioEMU2 models on residues 1–139; the selected range changes the saved clustering view.</p><ul>'+groups.map(g=>'<li><span style="color:'+g.color+'">★ '+g.label+'</span>: <strong>'+escapeText(g.medoid.model)+'</strong> · mean Cα RMSD '+g.medoid.mean_ca_rmsd.toFixed(3)+' Å <button type="button" data-state-medoid-index="'+g.medoidIndex+'">Inspect medoid</button></li>').join('')+'</ul><p>TM similarity uses full native US-align searches in both directions with average-length normalization. Similarity describes structure, and is separate from confidence or RPF / DP.</p></details>';
  for(const button of box.querySelectorAll('[data-state-medoid-index]'))button.onclick=()=>root.AtlasUploadedStateInspect(Number(button.dataset.stateMedoidIndex));
  const detail=box.querySelector('details'),convention=root.document.createElement('p');
  convention.textContent='The displayed native mean RMSD averages 50 comparisons, including the zero self-comparison. The same medoid minimizes the mean to the other 49 conformers. Current TR RPF / DP colors cover all 2,150 models. Native RPF scores for 24 sampled panels and 87 Double Recall comparisons are available in the four-subset results linked below. The prediction and uploaded-state preparation protocols remain explicitly recorded.';detail.append(convention);
  if(data.uploaded_state_comparison_summary){
   const table=root.document.createElement('table');table.innerHTML='<caption>Full 139-residue TM similarity to uploaded-state medoids</caption><thead><tr><th>Medoid</th><th>AFS3 median TM</th><th>BioEMU2 median TM</th><th>AFS3 / BioEMU2 counts ≥ 0.80</th></tr></thead><tbody>'+STATES.map(s=>{const r=data.uploaded_state_comparison_summary[s.state];return '<tr><td>'+s.label+'</td><td>'+r.afsample3.median.toFixed(3)+'</td><td>'+r.bioemu2.median.toFixed(3)+'</td><td>'+r.afsample3.count_tm_ge_0_8+' / '+r.bioemu2.count_tm_ge_0_8+'</td></tr>';}).join('')+'</tbody>';detail.append(table);
  }
  const links=root.document.createElement('p');
  for(const [key,label] of [['scores_csv','2,000 model scores · CSV'],['medoids_json','Medoid identities · JSON'],['provenance_json','Native calculation provenance'],['independent_validation_json','Independent validation']])if(data.uploaded_state_downloads?.[key]){if(links.childNodes.length)links.append(' · ');const link=root.document.createElement('a');link.href=data.uploaded_state_downloads[key];link.textContent=label;link.download='';links.append(link);}
  detail.append(links);
  const report=document.createElement('p'),reportLink=document.createElement('a');reportLink.href='cohort-analysis.html';reportLink.textContent='Four-subset analysis results · clustering, representative TM, sampled-state RPF and Double Recall';report.append(reportLink);box.append(report);
 }
 root.AISUploadedStates={COHORT,inventory,decorate,show,medoidDescriptor,starMeta,starPath,updateMethodCopy};
 if(typeof module!=='undefined')module.exports=root.AISUploadedStates;
 root.addEventListener?.('atlas:cohort',event=>show(event.detail.current));
})(typeof globalThis!=='undefined'?globalThis:this);
