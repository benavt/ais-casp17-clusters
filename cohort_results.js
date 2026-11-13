/* Passive annotations and result links; no clustering, scoring or sampling. */
(function(root){
 'use strict';
 const COHORT='afsample3-bioemu2',cache=new Map();
 function need(ok,message){if(!ok)throw Error(message)}
 async function get(file){if(!cache.has(file))cache.set(file,fetch(file,{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error('Accepted cohort result file unavailable: '+file);return response.json()}));return cache.get(file)}
 async function enrich(data){
  if(data.cohort_id!==COHORT)return data;
  const [scores,tm,reps]=await Promise.all([get('analysis-2000/model-scores-2000.json'),get('sr215-260-states/downloads/tm-and-current-rpf-2000.json'),get('analysis-2000/representative-tm.json')]);
  need(scores.length===2000&&tm.length===2000&&data.models.length===2000,'The passive result roster differs from the original 2,000 models.');
  const rows=new Map(scores.map(row=>[row.model,row])),tmRows=new Map(tm.map(row=>[row.model,row])),identities=new Map(data.rpf_payload?.models.map(row=>[row.model_id,row.source_sha256])||[]);
  need(rows.size===2000&&tmRows.size===2000&&identities.size===2000,'Current results require the verified original-coordinate roster.');
  for(const model of data.models)need(rows.get(model)?.source_sha256===identities.get(model)&&tmRows.get(model)?.source_sha256===identities.get(model),'Current result original-coordinate identity differs.');
  const schemes=[...data.schemes];
  if(!schemes.some(s=>s.key==='ais_method'))schemes.push({key:'ais_method',name:'AIS Method',type:'categorical',values:data.methods,colors:{afsample3:'#31a354',bioemu2:'#17becf'}});
  for(const [key,label] of [['dp','DP'],['recall','Recall'],['precision','Precision']])if(!schemes.some(s=>s.key==='rpf_current_'+key))schemes.push({key:'rpf_current_'+key,name:'Current TR RPF '+label+' · individual models · residues 1–139',type:'continuous',range:[0,1],colorscale:'Spectral',values:data.models.map(model=>rows.get(model)[key]),metric_note:'Accepted current TR standalone scores; full139; Phenix/MolProbity prepared source queries. Native ensemble scores are separate.'});
  for(const n of [1,2,3])if(!schemes.some(s=>s.key==='tm_260_state'+n))schemes.push({key:'tm_260_state'+n,name:'TM to 260 state '+n+' medoid · residues 1–139',type:'continuous',range:[0,1],colorscale:'Spectral',values:data.models.map(model=>tmRows.get(model)['tm_260_state'+n]),metric_note:'Full139 bidirectional average-length-normalized native US-align; references are uploaded-state structural medoids45/40/42.'});
  const representatives=data.representatives.map(rep=>{const score=reps.find(row=>row.model===rep.model&&row.cluster===rep.cluster&&row.mask===data.range_id&&row.view===(data.policy_view_id||data.view_id));need(score&&score.source_sha256===rep.source_sha256,'Representative TM identity differs.');return {...rep,uploaded_state_medoid_tm:{tm_260_state1:score.tm_260_state1,tm_260_state2:score.tm_260_state2,tm_260_state3:score.tm_260_state3},current_standalone_rpf:{dp:rows.get(rep.model).dp,recall:rows.get(rep.model).recall,precision:rows.get(rep.model).precision}}});
  const projections=Object.fromEntries(Object.entries(data.projections).map(([method,p])=>[method,{...p,axes:p.axes||({pca:['PC1','PC2'],umap:['UMAP1','UMAP2'],tsne:['t-SNE1','t-SNE2']}[method])}]));
  return {...data,projections,schemes,representatives};
 }
 function show(data){
  let box=document.getElementById('completeOriginalCohortResults');
  if(data?.cohort_id!==COHORT){if(box)box.hidden=true;return;}
  if(!box){box=document.createElement('aside');box.id='completeOriginalCohortResults';box.className='uploaded-state-identity';document.getElementById('legendPanel').after(box);}
  box.hidden=false;box.replaceChildren();const a=document.createElement('a');a.href='cohort-2000-analysis.html';a.textContent='Original 2,000-model cohort · four-subset clustering, MCMC/DISCO, current RPF and Double Recall results';box.append(a);
 }
 root.AISCompleteCohortResults={enrich};root.addEventListener('atlas:cohort',event=>show(event.detail.current));
})(window);
