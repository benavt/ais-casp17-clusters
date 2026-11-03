'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function fixture(curated=true,density=true){
 const primary=curated?'primary':'whole',values={models:['a','b'],methods:['one','two'],clusters:['C1','C2'],projections:{pca:{xy:[[0,0],[1,1]]}},schemes:[],representatives:[],model_files:['models/a.cif','models/b.cif']};
 const views=[{id:primary,name:'Validated UMAP clusters',data:'primary.json',source_view_id:primary,available:true},{id:'density',name:'10D UMAP / HDBSCAN',data:'density.json',source_view_id:'density',available:density}];
 const raw={...values,target:'T',view_id:primary,views},densityRaw={...raw,view_id:'density'};const fetched=[];
 const context=vm.createContext({console,URLSearchParams,location:{hash:'#T'},window:{addEventListener(){}},document:{getElementById(){}},fixtureRaw:raw,fixtureDensity:densityRaw,fixtureRequested:'',fixtureRange:{id:'all',name:'All residues',data:'primary.json',default_view:primary,...(curated?{views}:{})}});
 vm.runInContext(source,context);context.fetchFixture=file=>{fetched.push(file);return file==='primary.json'?raw:densityRaw};vm.runInContext('json=async file=>fetchFixture(file)',context);
 return {context,raw,views,fetched,run:code=>vm.runInContext(code,context),async select(request=''){context.fixtureRequested=request;return this.run('savedViewSelection({id:"T"},fixtureRange,fixtureRequested)')}};
}
for(const curated of [true,false]){
 test((curated?'curated':'saved legacy')+' menus default to HDBSCAN, preserve explicit UMAP links and keep scientific arrays',async()=>{
  const f=fixture(curated),before=JSON.stringify(f.raw),result=await f.select(),primary=curated?'primary':'whole';
  assert.equal(result.view.id,'density');assert.equal(result.loaded.view_id,'density');assert.equal(result.base.views[0].id,'density');assert.equal(result.base.views[0].name,'HDBSCAN');assert.equal(result.base.views[1].id,primary);assert.equal(result.base.views[1].name,'UMAP KNN');
  for(const key of ['models','methods','clusters','projections','schemes'])assert.equal(result.loaded[key],f.raw[key]);assert.equal(JSON.stringify(f.raw),before);assert.equal(result.loaded.model_files?.[0],'models/a.cif');
  assert.equal((await f.select(primary)).view.id,primary);assert.equal((await f.select('retired')).view.id,'density');
 });
 test((curated?'curated':'saved legacy')+' unavailable HDBSCAN falls back to UMAP KNN without fetching a missing analysis',async()=>{
  const f=fixture(curated,false),result=await f.select();assert.equal(result.view.id,curated?'primary':'whole');assert(!f.fetched.includes('density.json'));assert.equal(result.base.views[0].available,false);
 });
}
test('unspecified routes select the preferred clustering; explicit saved links retain their method',()=>{
 const f=fixture();assert.equal(f.run('hashSelection().view'),'');f.context.location.hash='#T?range=regional';assert.equal(f.run('hashSelection().view'),'');f.context.location.hash='#T?range=regional&view=primary';assert.equal(f.run('hashSelection().view'),'primary');
});
test('unrelated legacy clustering methods retain their scientific name',()=>{
 const f=fixture(false);assert.equal(f.run('savedClusteringViews([{id:"whole",name:"Ward clusters",data:"ward.json"}])[0].name'),'Ward clusters');
});
