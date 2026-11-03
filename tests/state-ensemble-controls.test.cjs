'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const api=require(path.join(root,'tm_states.js'));
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attributes={};this.hidden=false;this.disabled=false;this.value='';this.classList={add(){},remove(){},toggle(){}}}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this.attributes[k]=String(v)}getAttribute(k){return this.attributes[k]??null}removeAttribute(k){delete this.attributes[k]}
 querySelectorAll(){return[]}scrollIntoView(){this.scrolled=true}
}
function fixture({range='all',view='primary',states=2}={}){
 const models=Array.from({length:70*states},(_,i)=>'saved-model-'+i),payload={target:'TEST',schema_version:2,active_binding:{range_id:range,view_id:view},states:[]};
 for(let i=0;i<states;i++){
  const id='S'+(i+1),choice={};
  for(const method of ['mcmc50','disco50']){
   const indices=Array.from({length:50},(_,j)=>70*i+j+(method==='disco50'?20:0));
   const base=`tm-state-ensembles/TEST/${range}/${id}/${method}`;
   choice[method]={indices,ensemble:{file:base+'.pdb',sha256:'a'.repeat(64),bytes:5},session:{file:base+'.pse',sha256:'b'.repeat(64),bytes:5}};
  }
  payload.states.push({id,members:Array.from({length:70},(_,j)=>({index:70*i+j,model:models[70*i+j]})),selections:{[range]:{[view]:choice}}});
 }
 const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Node()]));nodes.get('tmStateSelect').value='none';nodes.get('tmStateMethod').value='mcmc50';
 const clicks=[],history=[],downloads=[],data={target:'TEST',range_id:range,view_id:view,models};
 const context=vm.createContext({console,document:{getElementById:id=>nodes.get(id),createTextNode:x=>String(x),createElement(tag){const n=new Node(tag);n.click=()=>clicks.push({href:n.href,download:n.download});return n}},window:{addEventListener(){},history:{replaceState(a,b,url){history.push(url)}}},AISExplorerTMStates:{...api,coverageNote:()=> 'saved coverage',readArtifact:async a=>{downloads.push(a.file);return new Uint8Array([1,2,3,4,5])}},URLSearchParams,Uint8Array,Blob,URL:{createObjectURL:()=> 'blob:verified',revokeObjectURL(){}},setTimeout(){},fixtureData:data,fixturePayload:payload});
 vm.runInContext(app+'\ndata=fixtureData;tmStatePayload=fixturePayload;tmStateLoader={enabled:true};tmStateLoading=false;selected="original-cluster";scheduleSelectionDraw=async()=>{};updateTMStateControls();',context);
 const run=code=>vm.runInContext(code,context),links=()=>nodes.get('tmStateDownloadRows').children.flatMap(r=>r.children.slice(1).flatMap(td=>td.children));
 return{nodes,payload,data,run,context,links,clicks,history,downloads};
}
test('both procedures are visible outside advanced sampling; None does not look like an active MCMC selection',()=>{
 const f=fixture();assert(html.indexOf('id="tmStateControls"')<html.indexOf('id="samplingPanel"'));
 for(const id of ['tmStateMCMC','tmStateDisco']){assert.equal(f.nodes.get(id).disabled,false);assert.equal(f.nodes.get(id).getAttribute('aria-pressed'),'false')}
 assert.equal(f.nodes.get('tmStateEnsembles').hidden,false);assert.equal(f.nodes.get('tmStateEnsembleLink').hidden,false);assert.equal(f.links().length,8);
});
test('each procedure selects its exact saved 50 models per state, without altering the cohort or structure',()=>{
 const f=fixture(),before=JSON.stringify(f.data);f.run("changeTMStateMethod('disco50')");assert.equal(f.run('tmStatePreference.state_id'),'all');assert.equal(f.run('tmStateHighlight.indices.size'),100);assert.equal(f.nodes.get('tmStateDisco').getAttribute('aria-pressed'),'true');
 assert.deepEqual(Array.from(f.run('tmStateHighlight.orderedIndices')),f.payload.states.flatMap(s=>s.selections.all.primary.disco50.indices));
 f.run("changeTMStateMethod('mcmc50')");assert.equal(f.nodes.get('tmStateMCMC').getAttribute('aria-pressed'),'true');assert.equal(f.nodes.get('tmStateDisco').getAttribute('aria-pressed'),'false');assert.deepEqual(Array.from(f.run('tmStateHighlight.orderedIndices')),f.payload.states.flatMap(s=>s.selections.all.primary.mcmc50.indices));
 assert.equal(f.run('selected'),'original-cluster');assert.equal(JSON.stringify(f.data),before);assert.match(f.history.at(-1),/tm_method=mcmc50/);
});
for(const [range,view] of [['all','primary'],['all','density'],['res5-95','original'],['res32-47-plus78-99','density']])test(`all state/procedure/format links use the bound ${range}/${view} payload even with highlights off`,()=>{
 const f=fixture({range,view,states:3});assert.equal(f.run('tmStateHighlight.active'),false);assert.equal(f.nodes.get('tmStateDownloadRows').children.length,3);assert.equal(f.links().length,12);
 for(const link of f.links()){
  assert.match(link.href,new RegExp('/'+range+'/'+link.dataset.state+'/'+link.dataset.method+'\\.'+link.dataset.format+'\\.gz$'));
  assert.match(link.getAttribute('aria-label'),/50-model ensemble/);assert.match(link.getAttribute('aria-label'),new RegExp(link.dataset.state));assert(link.download.endsWith('.'+link.dataset.format+'.gz'));
 }
});
test('download links verify and unpack the requested state and procedure without activating a highlight',async()=>{
 const f=fixture();await f.run("downloadTMState('disco50','pse','S2')");assert.equal(f.downloads[0],'tm-state-ensembles/TEST/all/S2/disco50.pse');assert.equal(f.clicks[0].download,'TEST_all_S2_disco50.pse');assert.equal(f.run('tmStateHighlight.active'),false);assert.equal(f.run('selected'),'original-cluster');
});
test('changing target/range clears old links immediately and suppresses any stale pending download',async()=>{
 const f=fixture();let resolve;f.context.AISExplorerTMStates.readArtifact=()=>new Promise(r=>{resolve=r});const pending=f.run("downloadTMState('mcmc50','pdb','S1')");assert(f.links().every(a=>a.getAttribute('aria-disabled')==='true'));
 f.run('clearTMStateHighlight();tmStateLoading=true;targetRequest++;updateTMStateControls()');assert.equal(f.nodes.get('tmStateEnsembles').hidden,true);assert.equal(f.links().length,0);resolve(new Uint8Array([1,2,3,4,5]));await pending;assert.equal(f.clicks.length,0);
});
test('an unavailable catalog exposes no stale state or procedure download links',()=>{
 const f=fixture();f.run('tmStateLoader={enabled:false};updateTMStateControls()');assert.equal(f.nodes.get('tmStateControls').hidden,true);assert.equal(f.nodes.get('tmStateEnsembles').hidden,true);assert.equal(f.links().length,0);
});
