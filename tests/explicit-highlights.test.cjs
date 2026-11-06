'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const api=require('../selections.js'),app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const payload={conditions:[{alpha:.5,tau_multiplier:1,id:'saved',panels:[Array.from({length:200},(_,i)=>i)]}]};
function fixture(){
 const nodes=new Map(),context=vm.createContext({console,AISExplorerSelections:api,window:{addEventListener(){},history:{replaceState(){}}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:true,value:'',disabled:false});return nodes.get(id)}},payload});
 vm.runInContext(app+`\ndata={target:'TEST',range_id:'all'};selectionPayload=payload;selectionLoading=false;updateSelectionControls=()=>updateSamplingSummary();updateTMStateControls=()=>{};updateHDBControls=()=>{};scheduleSelectionDraw=async()=>{};showActiveStateEnsemble=async()=>{};analysisHash=()=>'';`,context);
 return {run:s=>vm.runInContext(s,context),context,nodes};
}
test('fresh views have no highlights; explicitly requested weighted panels still work',()=>{
 assert.equal(api.DEFAULTS.method,'none');assert.equal(api.parseSettings(new URLSearchParams()).method,'none');assert.equal(api.select(payload).active,false);
 const p=api.parseSettings(new URLSearchParams('selection=panel'));assert.equal(api.select(payload,p).indices.size,200);
});
test('activating a TM state retires the old weighted panel so deselection cannot uncover it',()=>{
 const f=fixture();f.run("selectionPreference={...selectionPreference,method:'panel'};refreshSelectionHighlight();AISExplorerTMStates={select:()=>({active:true,indices:new Set([0])})};refreshTMStateHighlight()");assert.equal(f.run('selectionPreference.method'),'none');assert.equal(f.run('selectionHighlight.active'),false);
 f.run("AISExplorerTMStates.select=()=>({active:false});refreshTMStateHighlight()");assert.equal(f.run('effectiveSelectionHighlight().active'),false);
});
test('pooled state activation also retires the old weighted panel',()=>{
 const f=fixture();f.run("selectionPreference={...selectionPreference,method:'panel'};refreshSelectionHighlight();AISExplorerHDBStates={select:()=>({active:true,indices:new Set([0])})};refreshHDBHighlight()");assert.equal(f.run('selectionHighlight.active'),false);assert.equal(f.run('selectionPreference.method'),'none');
});
test('Clear highlights clears every sampling layer and hides itself',async()=>{
 const f=fixture();f.run("selectionPreference={...selectionPreference,method:'panel'};refreshSelectionHighlight();tmStatePreference.state_id='all';hdbStatePreference.state_id='S1';tmStateHighlight={active:true};hdbStateHighlight={active:true};updateSamplingSummary()");assert.equal(f.nodes.get('clearHighlights').hidden,false);
 await f.run('clearAllSelectionHighlights()');assert.equal(f.run('selectionPreference.method'),'none');assert.equal(f.run('tmStatePreference.state_id'),'none');assert.equal(f.run('hdbStatePreference.state_id'),'none');assert.equal(f.run('effectiveSelectionHighlight().active'),false);assert.equal(f.nodes.get('clearHighlights').hidden,true);
});
