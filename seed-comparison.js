(function(root){
 'use strict';
 const ranges=['all','res5-95','res32-47-plus78-99'];
 const views=['primary','density'];
 const pools=['whole','TM80'];
 const methods={mcmc50:'MCMC50',gumbel50:'Gumbel50'};
 const seeds=[202611710,202611711,202611712];
 const metrics={RPF_DP:[2,'Native ensemble RPF DP'],RPF_Recall:[2,'Native ensemble recall'],
  RPF_Precision:[2,'Native ensemble precision'],mean_member_molprobity_score:[2,'Mean member MolProbity'],
  mean_member_energy_t10:[1,'Mean member ProteinEBM (t = 0.10)']};
 const id=row=>[row.range,row.view,row.pool,row.seed,row.method].join('|');

 function validate(data,digest){
  if(data._source_sha!==digest||data.target!=='SR215_bmr6366'||data.original_models!==12104||
     data.filtered_models!==11104||data.panel_models!==50||data.peak_lists!=='SR215-TR-2026-11-06-v1'||
     data.audits?.original!==24430||data.audits?.filtered!==24482||
     JSON.stringify(data.seeds)!==JSON.stringify(seeds)||data.rows?.length!==72)throw Error('Seed comparison differs from its audit binding.');
  const map=new Map(data.rows.map(row=>[id(row),row]));
  for(const range of ranges)for(const view of views)for(const pool of pools)for(const seed of seeds)for(const method of Object.keys(methods)){
   const row=map.get(id({range,view,pool,seed,method}));
   if(!row||!['original','filtered'].every(cohort=>Object.keys(metrics).every(metric=>Number.isFinite(row[cohort]?.[metric]))))
    throw Error('Seed comparison has a missing or invalid score.');
  }
  return map;
 }

 function compare(map,range,view,pool,metric){
  const config=metrics[metric];
  if(!config)throw Error('Unknown comparison metric.');
  return seeds.flatMap(seed=>Object.entries(methods).map(([method,name])=>{
   const row=map.get(id({range,view,pool,seed,method}));
   if(!row)throw Error('No audited comparison for this view.');
   const original=row.original[metric],filtered=row.filtered[metric];
   return {seed,method:name,original,filtered,change:filtered-original,digits:config[0]};
  }));
 }

 let loaded, loadedDigest, serial=0;
 async function show(current,binding,fetchJSON){
  const request=++serial, node=document.getElementById('sr215SeedComparison');
  if(!node)return;
  node.hidden=!current||!binding;
  document.getElementById('sr215SeedNav').hidden=node.hidden;
  if(node.hidden)return;
  const status=document.getElementById('sr215SeedStatus');
  const pool=document.getElementById('sr215SeedPool');
  const metric=document.getElementById('sr215SeedMetric');
  const body=document.getElementById('sr215SeedRows');
  const caption=document.getElementById('sr215SeedCaption');
  body.replaceChildren();status.textContent='Loading audited seed scores…';pool.disabled=metric.disabled=true;
  try{
   if(!loaded||loadedDigest!==binding.sha256){
    loadedDigest=binding.sha256;
    loaded=fetchJSON(binding.path).then(raw=>validate(raw,binding.sha256)).catch(error=>{loaded=null;throw error});
   }
   const map=await loaded;
   if(request!==serial)return;
   const render=()=>{
    const view=current.policy_view_id||current.view_id;
    const rows=compare(map,current.range_id,view,pool.value,metric.value);
    caption.textContent=metrics[metric.value][1]+' · '+current.range_name+' · '+(view==='primary'?'UMAP KNN':'HDBSCAN');
    body.replaceChildren(...rows.map(r=>{
     const tr=document.createElement('tr');
     const delta=r.change.toFixed(r.digits);
     const formatted=Number(delta)===0?(0).toFixed(r.digits):(r.change>0?'+':'')+delta;
     for(const [i,value] of [r.seed,r.method,r.original.toFixed(r.digits),r.filtered.toFixed(r.digits),formatted].entries()){
      const cell=document.createElement(i===0?'th':'td');
      if(i===0)cell.scope='row';
      cell.textContent=value;tr.append(cell);
     }
     return tr;
    }));
    status.textContent='';
   };
   pool.onchange=metric.onchange=render;
   pool.disabled=metric.disabled=false;render();
  }catch(error){
   if(request===serial)status.textContent='Seed scores unavailable. '+error.message;
  }
 }
 const api={validate,compare,show};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.AISSeedComparison=api;
})(typeof globalThis!=='undefined'?globalThis:this);
