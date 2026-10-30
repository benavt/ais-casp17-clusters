/* Linked explorer presentation; saved scientific data are never changed. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),names={umap:'UMAP',pca:'PCA',tsne:'t-SNE',bonsai:'Bonsai'};
 let expanded=null,returnFocus=null,featured='umap',pending=false,currentTarget=null;
 function resize(){
  if(pending)return;pending=true;
  requestAnimationFrame(()=>{pending=false;AtlasResponsive.schedule();window.dispatchEvent(new Event('atlas:layout'));});
 }
 function restore(){
  if(!expanded)return;
  expanded.classList.remove('is-maximized');
  const button=expanded.querySelector(':scope > summary > button');
  button.textContent='⛶';button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','Expand '+expanded.querySelector('summary span').textContent);
  expanded=null;document.body.classList.remove('panel-is-maximized');returnFocus?.focus();resize();
 }
 function maximize(panel,button){
  if(expanded===panel){restore();return;}
  restore();expanded=panel;returnFocus=button;panel.open=true;panel.classList.add('is-maximized');document.body.classList.add('panel-is-maximized');
  button.textContent='↙';button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','Restore '+panel.querySelector('summary span').textContent);resize();
 }
 function feature(view){
  const key=names[view]?view:null;
  if(key&&$(key+'Panel').hidden)return;
  featured=key;$('projection').value=key||'all';
  const tools=$('featuredTools');
  for(const [id,name]of Object.entries(names)){
   const active=id===key,panel=$(id+'Panel'),button=panel.querySelector('.feature-view');
   panel.classList.toggle('is-featured',active);panel.querySelector('.plot,#bonsai').inert=!active;
   button.textContent=active?'↙':'⤢';button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',(active?'Minimize ':'Enlarge ')+name);button.title=(active?'Minimize ':'Enlarge ')+name;
   $(id+'Tab').setAttribute('aria-selected',String(active));$(id+'Tab').tabIndex=active?0:-1;
   if(active)panel.querySelector('.view-heading').insertBefore(tools,button);
  }
  if(!key){$('plots').after(tools);$('umapTab').tabIndex=0;}
  document.querySelector('.plot-column').classList.toggle('is-overview',!key);tools.hidden=!key;
  resize();
 }
 window.AtlasExplorer={feature,refresh:resize,setBusy(busy){$('resetPlot').disabled=busy;$('savePlot').disabled=busy},get featured(){return featured}};
 window.addEventListener('atlas:cohort', event => {
  const { current, base } = event.detail;currentTarget=current.target;
  const subset = current.models.length < 11000;
  const counts = new Map(); current.methods.forEach(method => counts.set(method, (counts.get(method) || 0) + 1));
  const box = document.getElementById('cohortSummary');
  box.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = subset ? `Largest-cluster subset · ${current.models.length.toLocaleString()} of 11,000 original models` : 'Full target · 11,000 original models · 1,000 per sampling method';
  const note = document.createElement('p');
  note.textContent = subset ? 'Only members of the selected primary cluster appear here. Method counts differ because each method contributes a different number to this cluster.' : 'All eleven methods are included. Each projection shows the same original model cohort; Bonsai shows selected representative ensembles.';
  box.append(strong, note);
  if (subset && base.views?.some(view => view.id === 'primary')) {
   const link = document.createElement('a'); link.href = '#' + current.target + '?view=primary'; link.textContent = 'Show all 11,000 models'; box.append(link);
  }
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th scope="col">Sampling method</th><th scope="col">Shown</th><th scope="col">Full target</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const [method, count] of [...counts].sort((a,b) => a[0].localeCompare(b[0]))) {
   const row = document.createElement('tr');
   for (const value of [method, count.toLocaleString(), '1,000']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
   body.append(row);
  }
  table.append(body); document.getElementById('methodCounts').replaceChildren(table);
 });

 window.addEventListener('atlas:cohort',event=>{
  const available=!!event.detail.current.bonsai;
  $('bonsaiPanel').hidden=!available;$('bonsaiTab').hidden=!available;
  if(featured==='bonsai'&&!available)feature('umap');
 });
 document.addEventListener('DOMContentLoaded',()=>{
  for(const button of document.querySelectorAll('[data-feature]'))button.addEventListener('click',()=>{
   const view=button.dataset.feature;
   feature(button.classList.contains('feature-view')&&featured===view?'all':view);
   if(document.activeElement===button&&!button.getClientRects().length){$('umapTab').tabIndex=-1;$(view+'Tab').tabIndex=0;$(view+'Tab').focus();}
  });
  const tabs=[...document.querySelectorAll('.view-tabs [role=tab]')];
  for(const tab of tabs)tab.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
   const visible=tabs.filter(t=>!t.hidden),index=visible.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?visible.length-1:(index+(event.key==='ArrowRight'?1:-1)+visible.length)%visible.length;
   feature(visible[next].dataset.feature);visible[next].focus();
  });
  $('resetPlot').onclick=()=>window.AtlasPlotActions.reset(featured).catch(console.error);
  $('savePlot').onclick=()=>window.AtlasPlotActions.save(featured).catch(console.error);
  $('expandExplorer').onclick=event=>{event.preventDefault();event.stopPropagation();maximize($('clusterExplorer'),event.currentTarget)};
  document.querySelectorAll('details.figure-panel').forEach((panel,index)=>{
   if(!panel.id)panel.id='figure-panel-'+index;
   if(panel.id!=='clusterExplorer'){
    const button=document.createElement('button');button.type='button';button.className='maximize-panel';button.textContent='⛶';button.title='Expand section';button.setAttribute('aria-label','Expand '+panel.querySelector('summary span').textContent);button.setAttribute('aria-pressed','false');
    button.onclick=event=>{event.preventDefault();event.stopPropagation();maximize(panel,button)};panel.querySelector(':scope > summary').append(button);
   }
   panel.addEventListener('toggle',()=>{if(!panel.open&&expanded===panel)restore();if(panel.open)resize()});
  });
  $('expandSupplementary').onclick=()=>{document.querySelectorAll('.supplementary-panel:not([hidden])').forEach(panel=>panel.open=true);resize()};
  $('collapseSupplementary').onclick=()=>{restore();document.querySelectorAll('.supplementary-panel').forEach(panel=>panel.open=false)};
  document.addEventListener('keydown',event=>{
   if(!expanded)return;
   if(event.key==='Escape'){event.preventDefault();restore()}
   if(event.key==='Tab'){
    const controls=[...expanded.querySelectorAll('button,a[href],select,input,summary,[tabindex="0"]')].filter(el=>!el.hidden&&!el.disabled&&!el.closest('[inert]')&&el.getClientRects().length),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
   }
  });
  document.addEventListener('click',event=>{
   const link=event.target.closest('a[href^="#"]');if(!link)return;
   const target=$(link.hash.slice(1));if(target?.matches('details')){target.open=true;resize()}
  });
  window.addEventListener('hashchange',()=>{if(decodeURIComponent(location.hash.slice(1)).split('?')[0]!==currentTarget)restore()});
  const explorer=$('clusterExplorer'),heading=explorer.querySelector(':scope > summary');
  new ResizeObserver(()=>explorer.style.setProperty('--explorer-heading-height',heading.getBoundingClientRect().height+'px')).observe(heading);
  new ResizeObserver(resize).observe($('molecule'));
  feature('umap');
 });
})();
