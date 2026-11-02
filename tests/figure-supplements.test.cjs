const assert=require('node:assert/strict'),test=require('node:test'),figures=require('../figures.js');
const digest='a'.repeat(64),base='figure-supplements/SR215/selected38/';
function fixture(){
 const data={target:'SR215',range_id:'selected38',view_id:'primary',policy_view_id:'primary',visible_view_policy:true,_source_sha:digest,
  views:[{id:'primary',source_data_sha256:digest}],models:['a','b'],representatives:[{cluster:'C1',model:'a'},{cluster:'C2',model:'b'}],schemes:[{key:'score',values:[.2,.8]}]};
 const entry={target:data.target,range_id:data.range_id,view_id:data.view_id,source_data_sha256:digest,file:base+'primary.json',sha256:digest};
 const payload={schema_version:1,kind:'saved_partition_figure_supplement',...entry,models:data.models,representatives:data.representatives,
  bonsai:{file:base+'bonsai.json',sha256:digest,selected_models:2},medoid_tm:{labels:['C1','C2'],models:['a','b'],matrix:[[1,.7],[.7,1]],csv:base+'grid.csv',note:'Saved scores'}};
 const catalog={schema_version:1,kind:'saved_figure_supplement_catalog',entries:[entry]};return{data,entry,payload,catalog};
}
test('new figures preserve exact saved source bindings, score arrays and original object',async()=>{
 const {data,payload,catalog}=fixture(),before=JSON.stringify(data),out=await figures.createLoader(catalog,async()=>payload).enrich(data);
 assert.equal(JSON.stringify(data),before);assert.equal(out._source_sha,data._source_sha);assert.equal(out.schemes,data.schemes);assert.equal(out.models,data.models);assert.deepEqual(out.medoid_tm.matrix,[[1,.7],[.7,1]]);assert.ok(out.bonsai);
});
test('other views remain unchanged',async()=>{
 const {data,payload,catalog}=fixture();data.view_id='density';assert.equal(await figures.createLoader(catalog,async()=>payload).enrich(data),data);
});
test('modified source bytes are rejected before loading artifacts',async()=>{
 const {data,catalog}=fixture();data._source_sha='b'.repeat(64);await assert.rejects(figures.createLoader(catalog,()=>{throw Error('must not read')}).enrich(data),/source binding differs/);
});
test('medoid identity changes cannot inherit another grid',async()=>{
 const {data,payload,catalog}=fixture();payload.representatives=[{cluster:'C1',model:'b'},{cluster:'C2',model:'a'}];await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/medoids differ/);
});
test('incomplete and asymmetric grids are rejected',async()=>{
 for(const matrix of [[[1,.7]],[[1,.7],[.8,1]]]){const {data,payload,catalog}=fixture();payload.medoid_tm.matrix=matrix;await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/figure grid/)}
});
test('artifact paths cannot escape the supplement folder',async()=>{
 const {data,payload,catalog}=fixture();payload.bonsai.file=base+'../wrong.json';await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/Unsafe figure artifacts/);
});
