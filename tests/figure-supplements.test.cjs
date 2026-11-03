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
function ensembleFixture(){
 const f=fixture();f.data.clusters=['C1','C2'];f.data.views[0].canonical_positions=[4,5,6];
 f.payload.kind='saved_partition_ensemble_supplement';delete f.payload.bonsai;delete f.payload.medoid_tm;
 f.payload.canonical_positions=[4,5,6];f.payload.ensembles=[{cluster:'C1',model:'a',ensemble_models:['a'],ensemble_file:'SR215/primary-ensembles/Cluster_1.pdb',ensemble_pse:'SR215/primary-ensembles/Cluster_1.pse'}];
 const row=f.payload.ensembles[0];row.artifacts=Object.fromEntries(['ensemble_file','ensemble_pse'].map(key=>[key,{file:row[key],sha256:digest,bytes:123}]));return f;
}
test('existing identical ensembles add downloads without changing medoids, figures or source bindings',async()=>{
 const {data,payload,catalog}=ensembleFixture(),before=JSON.stringify(data);data.bonsai={file:'existing.json'};
 const out=await figures.createLoader(catalog,async()=>payload).enrich(data);
 assert.equal(out.representatives[0].ensemble_file,payload.ensembles[0].ensemble_file);assert.equal(out.representatives[0].ensemble_pse,payload.ensembles[0].ensemble_pse);
 assert.equal(out.representatives[0].model,'a');assert.equal(out.representatives[1],data.representatives[1]);assert.equal(out.models,data.models);assert.equal(out.clusters,data.clusters);assert.equal(out.schemes,data.schemes);assert.equal(out.bonsai,data.bonsai);assert.equal(out._source_sha,data._source_sha);
 delete data.bonsai;assert.equal(JSON.stringify(data),before);assert(!data.representatives[0].ensemble_file);
});
test('an ensemble from another residue mask is rejected',async()=>{
 const {data,payload,catalog}=ensembleFixture();payload.canonical_positions=[3,4,5];await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/residue mask differs/);
});
test('reused ensembles cannot change the medoid or include another cluster’s members',async()=>{
 for(const change of [row=>row.model='b',row=>row.ensemble_models=['a','b'],row=>row.ensemble_models=['a','a']]){
  const {data,payload,catalog}=ensembleFixture();change(payload.ensembles[0]);await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/Ensemble (representative|selection) differs/);
 }
});
test('reused ensemble artifacts require safe target-local paths and complete hash records',async()=>{
 for(const change of [row=>row.ensemble_file='https://example.org/file.pdb',row=>row.ensemble_pse='SR215/../other.pse',row=>delete row.artifacts.ensemble_file]){
  const {data,payload,catalog}=ensembleFixture();change(payload.ensembles[0]);await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/Unsafe ensemble artifact/);
 }
});
test('missing representatives may receive approved within-cluster medoids, without changing populations',async()=>{
 const {data,payload,catalog}=ensembleFixture();data.models.push('c');data.clusters.push('C1');data.representatives[0].count=100;
 payload.ensembles[0].model='c';payload.ensembles[0].ensemble_models=['a','c'];payload.ensembles[0].representative={model:'c',method:'AFS3',file:'SR215/cluster-ensembles/new-medoid.pdb',format:'pdb',sha256:digest,count:2};
 const out=await figures.createLoader(catalog,async()=>payload).enrich(data);
 assert.equal(out.representatives[0].model,'c');assert.equal(out.representatives[0].count,100);assert.equal(out.representatives[0].method,'AFS3');assert.equal(data.representatives[0].model,'a');
 data.representatives[0].file='SR215/existing.pdb';await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/representative differs/);
});
test('Bonsai attached to new ensembles requires a complete selected-model population',async()=>{
 const {data,payload,catalog}=ensembleFixture();payload.bonsai={file:base+'new-bonsai.json',sha256:digest,selected_models:1};await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/Incomplete ensemble Bonsai/);
});
test('independent figure and ensemble supplements compose while retaining frozen arrays and original medoids',async()=>{
 const f=fixture(),e=ensembleFixture();f.data.clusters=e.data.clusters;f.data.views[0].canonical_positions=e.data.views[0].canonical_positions;
 e.entry={...e.entry,file:base+'ensembles.json'};f.catalog.entries.push(e.entry);
 const out=await figures.createLoader(f.catalog,async file=>file===e.entry.file?e.payload:f.payload).enrich(f.data);
 assert.equal(out.bonsai.file,f.payload.bonsai.file);assert.equal(out.medoid_tm.matrix,f.payload.medoid_tm.matrix);assert.equal(out.representatives[0].ensemble_file,e.payload.ensembles[0].ensemble_file);assert.equal(out.models,f.data.models);assert.equal(out._source_sha,f.data._source_sha);
});
test('new medoid grids bind to the approved ensemble medoids and replace unavailable notes',async()=>{
 const {data,payload,catalog}=ensembleFixture();data.models.push('c');data.clusters.push('C1');data.medoid_tm_note='Unavailable';
 payload.ensembles[0].model='c';payload.ensembles[0].ensemble_models=['a','c'];payload.ensembles[0].representative={model:'c',method:'AFS3',file:'SR215/cluster-ensembles/new-medoid.pdb',format:'pdb',sha256:digest};
 payload.medoid_tm={labels:['C1','C2'],models:['c','b'],canonical_positions:[4,5,6],matrix:[[1,.6],[.6,1]],csv:base+'grid.csv',note:'Complete saved medoid comparison'};
 const out=await figures.createLoader(catalog,async()=>payload).enrich(data);
 assert.equal(out.medoid_tm.matrix,payload.medoid_tm.matrix);assert.equal(out.medoid_tm_note,payload.medoid_tm.note);assert.equal(out.representatives[0].model,'c');assert.equal(data.representatives[0].model,'a');assert.equal(out.models,data.models);
 payload.medoid_tm.models=['a','b'];await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/grid identities differ/);
 payload.medoid_tm.models=['c','b'];payload.medoid_tm.canonical_positions=[3,4,5];await assert.rejects(figures.createLoader(catalog,async()=>payload).enrich(data),/grid residue mask differs/);
});
