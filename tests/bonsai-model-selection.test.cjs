'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function fixture(){
 const calls=[],pending=[];const context=vm.createContext({console,window:{addEventListener(){}},document:{getElementById(){return{};}},calls,pending});
 vm.runInContext(app+`\ndata={cohort_id:'afsample3-bioemu2'};hdbStatePayload={schema_version:2,kind:'pooled_tm_state_selection_payload',states:[{id:'S1',selections:{mcmc50:{models:['a','b'],ensemble:{sha256:'m'}},disco50:{models:['b','c'],ensemble:{sha256:'d'}}}}]};hdbStatePreference={method:'mcmc50'};viewer={_aisDescriptor:{_ensembleSha256:'m'}};structureMetrics={selectModel:id=>calls.push(['model',id])};choose=id=>new Promise(resolve=>pending.push({id,resolve}));`,context);
 return {calls,pending,run:s=>vm.runInContext(s,context)};
}
test('Bonsai selects the clicked frame within an already loaded state without resetting or reloading it',async()=>{const f=fixture();await f.run("inspectBonsaiPoint('fine-cluster','b')");assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['model','b']]);assert.equal(f.pending.length,0)});
test('both Bonsai construction paths forward the model to the same handler',()=>{assert.equal((app.match(/onChoose:\(cluster,model\)=>inspectBonsaiPoint\(cluster,model\)\.catch\(fail\)/g)||[]).length,2)});
test('a newly selected state loads before choosing its clicked model',async()=>{const f=fixture();f.run("viewer._aisDescriptor._ensembleSha256='other'");const promise=f.run("inspectBonsaiPoint('fine-cluster','b')");assert.equal(f.pending[0].id,'S1');assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[]);f.run("viewer._aisDescriptor._ensembleSha256='m'");f.pending[0].resolve();await promise;assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['model','b']])});
test('stale point from another procedure cannot change the displayed model',async()=>{const f=fixture();await f.run("inspectBonsaiPoint('fine-cluster','c')");assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[]);assert.equal(f.pending.length,0)});
test('method changes or newer point clicks invalidate an awaiting point selection',async()=>{
 for(const change of ["hdbStatePreference.method='disco50'","data={cohort_id:'afsample3-bioemu2'}","hdbStatePayload={...hdbStatePayload}"]){const f=fixture();f.run("viewer._aisDescriptor._ensembleSha256='other'");const p=f.run("inspectBonsaiPoint('fine','b')");f.run(change+";viewer._aisDescriptor._ensembleSha256='m'");f.pending[0].resolve();await p;assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[])}
 const f=fixture();f.run("viewer._aisDescriptor._ensembleSha256='other'");const old=f.run("inspectBonsaiPoint('fine','a')");f.run("viewer._aisDescriptor._ensembleSha256='m'");await f.run("inspectBonsaiPoint('fine','b')");f.pending[0].resolve();await old;assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['model','b']]);
});

test('pooled MCMC/DISCO buttons toggle off an active method and switch on the other method',async()=>{
 const f=fixture();f.run(`const picker={value:'all'};document.getElementById=()=>picker;refreshHDBHighlight=()=>{hdbStateHighlight={active:hdbStatePreference.state_id!=='none'}};scheduleSelectionDraw=async()=>{};showActiveStateEnsemble=async()=>{};analysisHash=()=>'';`);
 await f.run("changeHDBState('mcmc50')");assert.equal(f.run('hdbStatePreference.state_id'),'none');assert.equal(f.run('hdbStateHighlight.active'),false);
 await f.run("changeHDBState('disco50')");assert.equal(f.run('hdbStatePreference.state_id'),'all');assert.equal(f.run('hdbStatePreference.method'),'disco50');
 await f.run("changeHDBState('mcmc50')");assert.equal(f.run('hdbStatePreference.state_id'),'all');assert.equal(f.run('hdbStatePreference.method'),'mcmc50');
 await f.run("changeHDBState('mcmc50')");assert.equal(f.run('hdbStatePreference.state_id'),'none');
});
