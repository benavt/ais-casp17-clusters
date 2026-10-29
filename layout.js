/* Presentation controls only: saved scientific data are never changed. */
(() => {
 'use strict';
 let expanded = null, returnFocus = null, cohort = null;
 const resize = () => requestAnimationFrame(() => {
  AtlasResponsive.schedule();
  window.dispatchEvent(new Event('resize'));
 });
 function restore() {
  if (!expanded) return;
  expanded.classList.remove('is-maximized');
  expanded.querySelector('.maximize-panel').textContent = 'Maximize';
  expanded.querySelector('.maximize-panel').setAttribute('aria-pressed', 'false');
  expanded = null; document.body.classList.remove('panel-is-maximized');
  returnFocus?.focus(); resize();
 }
 window.addEventListener('atlas:cohort', event => {
  cohort = event.detail;
  const { current, base } = cohort;
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
 document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('details.figure-panel').forEach((panel, index) => {
   if (!panel.id) panel.id = 'figure-panel-' + index;
   const summary = panel.querySelector(':scope > summary'), button = document.createElement('button');
   button.type = 'button'; button.className = 'maximize-panel'; button.textContent = 'Maximize';
   button.setAttribute('aria-label', 'Maximize ' + summary.textContent.trim());
   button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-controls', panel.id);
   button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (expanded === panel) { restore(); return; }
    restore(); returnFocus = button; expanded = panel; panel.open = true;
    panel.classList.add('is-maximized'); document.body.classList.add('panel-is-maximized');
    button.textContent = 'Restore'; button.setAttribute('aria-pressed', 'true'); resize();
   });
   summary.append(button);
   panel.addEventListener('toggle', () => { if (!panel.open && expanded === panel) restore(); if (panel.open) resize(); });
  });
  document.getElementById('expandSupplementary').onclick = () => { document.querySelectorAll('.supplementary-panel:not([hidden])').forEach(panel => panel.open = true); resize(); };
  document.getElementById('collapseSupplementary').onclick = () => { restore(); document.querySelectorAll('.supplementary-panel').forEach(panel => panel.open = false); };
  document.addEventListener('keydown', event => {
   if (!expanded) return;
   if (event.key === 'Escape') { event.preventDefault(); restore(); }
   if (event.key === 'Tab') {
    const controls = [...expanded.querySelectorAll('button,a[href],select,input,summary,[tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
   }
  });
  document.addEventListener('click', event => {
   const link = event.target.closest('a[href^="#"]');
   if (!link) return;
   const target = document.getElementById(link.hash.slice(1));
   if (target?.matches('details')) { target.open = true; resize(); }
  });
  window.addEventListener('hashchange', restore);
 });
})();
