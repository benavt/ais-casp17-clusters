'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function fixture(){
 const context=vm.createContext({console,URLSearchParams,location:{hash:'#SR215_bmr6366?range=res5-95&view=primary&cohort=afsample3-bioemu2'},window:{addEventListener(){}},document:{getElementById(){}}});
 vm.runInContext(source,context);return {context,run:code=>vm.runInContext(code,context)};
}
test('pooled cohort links preserve explicit residue selection and clustering method',()=>{
 const f=fixture(),selection=f.run('hashSelection()');assert.equal(selection.cohort,'afsample3-bioemu2');assert.equal(selection.view,'primary');assert.equal(selection.range,'res5-95');
 f.run("data={cohort_id:'afsample3-bioemu2'}");const route=f.run("analysisHash('SR215_bmr6366','res32-47-plus78-99','density')");
 const params=new URLSearchParams(route.split('?')[1]);assert.equal(params.get('cohort'),'afsample3-bioemu2');assert.equal(params.get('range'),'res32-47-plus78-99');assert.equal(params.get('view'),'density');
 f.context.location.hash='#SR215_bmr6366?range=all&view=primary';assert.equal(f.run('hashSelection().cohort'),'all');
});
test('pooled PCA axes use fresh pooled variance and never inherit the original 11,000-model metadata',()=>{
 const f=fixture();f.run("projectionMetadataCatalog={targets:{SR215_bmr6366:{ranges:{all:{views:{density:{pca:{explained_variance_ratio:[.9,.08],scope_label:'Original cohort'}}}}}}}};");
 const projection={axes:['X','Y'],explained_variance_ratio:[.4,.3],scope_label:'Pooled 2,000 models'};f.context.projection=projection;
 const pooled=f.run("projectionAxisTitles('pca',projection,{target:'SR215_bmr6366',range_id:'all',view_id:'density',cohort_id:'afsample3-bioemu2'})");
 assert(pooled[0].includes('40.0%')&&pooled[1].includes('30.0%')&&pooled[0].includes('Pooled 2,000'));
 const original=f.run("projectionAxisTitles('pca',projection,{target:'SR215_bmr6366',range_id:'all',view_id:'density',cohort_id:'all'})");
 assert(original[0].includes('90.0%')&&original[1].includes('8.0%')&&original[0].includes('Original cohort'));
});
test('regional pooled views keep their own figures while original figure bindings stay strict',async()=>{
 const figures=require('../figures.js'),f=fixture(),hash='a'.repeat(64),file='figure-supplements/SR215/regional/density.json';
 const original={target:'SR215_bmr6366',range_id:'res5-95',view_id:'density',policy_view_id:'density',visible_view_policy:true,cohort_id:'all',_source_sha:hash,views:[{id:'density',source_data_sha256:hash}],models:['a','b'],representatives:[{cluster:'C1',model:'a'},{cluster:'C2',model:'b'}],schemes:[]};
 const entry={target:original.target,range_id:original.range_id,view_id:original.view_id,source_data_sha256:hash,file,sha256:hash};
 const payload={schema_version:1,kind:'saved_partition_figure_supplement',...entry,models:original.models,representatives:original.representatives,bonsai:{file:'figure-supplements/SR215/regional/bonsai.json',sha256:hash,selected_models:2},medoid_tm:{labels:['C1','C2'],models:['a','b'],matrix:[[1,.7],[.7,1]],csv:'figure-supplements/SR215/regional/grid.csv',note:'Original cohort'}};
 let reads=0;f.context.loader=figures.createLoader({schema_version:1,kind:'saved_figure_supplement_catalog',entries:[entry]},async()=>{reads++;return payload});f.run('figureSupplementLoader=loader');
 const pooled={...original,cohort_id:'afsample3-bioemu2',_source_sha:'b'.repeat(64),models:['pooled-a'],representatives:[{cluster:'RPF2K:C1',model:'pooled-a'}],distance_summary:{sample_count:2000},projections:{pca:{explained_variance_ratio:[.4,.3]}}};
 f.context.input=pooled;const before=JSON.stringify(pooled),result=await f.run('applySavedFigureSupplements(input)');assert.equal(result,pooled);assert.equal(JSON.stringify(result),before);assert.equal(reads,0);assert(!result.bonsai&&!result.medoid_tm);
 f.context.input=original;const enriched=await f.run('applySavedFigureSupplements(input)');assert.equal(reads,1);assert(enriched.bonsai);assert.deepEqual(enriched.medoid_tm.matrix,[[1,.7],[.7,1]]);
 f.context.input={...original,_source_sha:'c'.repeat(64)};await assert.rejects(f.run('applySavedFigureSupplements(input)'),/source binding differs/);assert.equal(reads,1);
});
test('all pooled residue maps use their own bound masks and cannot inherit old variance regions',()=>{
 const f=fixture(),api=require('../rpf.js'),hash='b'.repeat(64),legacy={chain:'A',expected_ca_count:139,canonical_positions:[1,2],regions_verified:true,regions:[{label:'Original core',color:'#123456',start:1,end:2}],regions_note:'10,937 models; clustering uses 11,000'};
 f.context.AISExplorerRPF=api;f.context.legacy=legacy;f.run("clusteringResidueCatalog={targets:{SR215_bmr6366:{views:{primary:legacy,density:legacy}}}}");
 const masks={all:Array.from({length:139},(_,i)=>i+1),'res5-95':Array.from({length:91},(_,i)=>i+5),'res32-47-plus78-99':[...Array.from({length:16},(_,i)=>i+32),...Array.from({length:22},(_,i)=>i+78)]};
 for(const [range,positions] of Object.entries(masks))for(const view of ['primary','density']){
  const input={target:api.TARGET,range_id:range,view_id:view,policy_view_id:view,cohort_id:api.COHORT,_source_sha:hash,rpf_overlay_status:'available',rpf_payload:{sequence_sha256:api.SEQUENCE},clustering_positions:positions,canonical_positions:positions,views:[{id:view,source_data_sha256:hash,canonical_positions:positions}]};
  f.context.input=input;const map=f.run('clusteringResidues(input)');assert.equal(map.expected_ca_count,139);assert.equal(map.sequence_sha256,api.SEQUENCE);assert.equal(map.chain,'A');assert.deepEqual(Array.from(map.canonical_positions),positions);assert.equal(f.run('verifiedRegions(clusteringResidues(input)).length'),0);assert(!JSON.stringify(map).includes('11,000'));assert.equal(map.analysis_uses_full_construct,range==='all');
  f.context.input={...input,canonical_positions:[1,2]};assert.equal(f.run('clusteringResidues(input)'),null);
  f.context.input={...input,rpf_payload:{sequence_sha256:'wrong'}};assert.equal(f.run('clusteringResidues(input)'),null);
 }
 f.context.input={target:api.TARGET,range_id:'all',view_id:'primary',cohort_id:'all'};assert.equal(f.run('clusteringResidues(input)'),legacy);assert.equal(f.run('verifiedRegions(clusteringResidues(input)).length'),1);
});
test('pooled native data cannot enter original energy, selection or TM adapters',async()=>{
 const f=fixture(),calls=[];f.context.metricAdapter={async enrich(input){calls.push('energy');return {...input,energy:true}}};f.context.selectionAdapter={async load(input){calls.push('selection');return {status:'available',payload:input}}};f.context.tmAdapter={async load(input){calls.push('tm');return {status:'available',payload:input}}};
 f.run('metricOverlayLoader=metricAdapter;selectionLoader=selectionAdapter;tmStateLoader=tmAdapter');
 const pooled={cohort_id:'afsample3-bioemu2',schemes:[{key:'rpf_dp',values:[.8]}],models:['pooled-a']};f.context.input=pooled;f.context.raw={old:false};const out=await f.run('applySavedModelOverlays(input,raw)');assert.equal(out[0],pooled);assert.equal(out[1].payload,null);assert.equal(out[2].payload,null);assert.deepEqual(calls,[]);
 f.context.input={...pooled,cohort_id:'all'};const original=await f.run('applySavedModelOverlays(input,raw)');assert.equal(original[0].energy,true);assert.equal(original[1].payload,f.context.raw);assert.equal(original[2].payload,f.context.raw);assert.deepEqual(calls,['energy','selection','tm']);
});
test('plain SR215 opens the current cohort while historical deep links remain archived',()=>{
 const f=fixture();
 f.context.location.hash='#SR215_bmr6366';
 assert.equal(f.run('hashSelection().cohort'),'all');
 f.run('currentSR215Catalog={available:true}');
 assert.equal(f.run('hashSelection().cohort'),'current-12104');
 for(const query of ['cohort=all','range=res5-95&view=primary']){
  f.context.location.hash='#SR215_bmr6366?'+query;
  assert.equal(f.run('hashSelection().cohort'),'all');
 }
 f.context.location.hash='#SR215_bmr6366?cohort=current-12104&range=res5-95';
 assert.equal(f.run('hashSelection().range'),'res5-95');
 assert.equal(f.run('hashSelection().cohort'),'current-12104');
});
test('the current cohort resolves only audited native views and cannot receive historical overlays',async()=>{
 const f=fixture(),id='current-12104',positions=['all','res5-95','res32-47-plus78-99'];
 f.context.input={target:'SR215_bmr6366',cohort_id:id,range_id:'all',view_id:'primary',models:Array(12104).fill('fixture'),representatives:[]};
 f.context.catalog={id,available:true,models:12104,residue_ranges:positions.map(key=>({id:key,data:'primary.json',views:[{id:'primary',source_view_id:'primary',data:'primary.json',source_data_sha256:'verified'}]}))};
 f.context.target={id:'SR215_bmr6366'};
 f.run("figureSupplementLoader={enrich(){throw Error('archived figures used')}};metricOverlayLoader=figureSupplementLoader;json=async()=>({...input,_source_sha:'verified'})");
 const loaded=await f.run("savedViewSelection(currentCohortTarget(target,catalog),catalog.residue_ranges[0],'primary')");
 assert.equal(loaded.loaded.models.length,12104);
 assert.equal(await f.run('applySavedFigureSupplements(input)'),f.context.input);
 assert.equal((await f.run('applySavedModelOverlays(input,input)'))[0],f.context.input);
 f.run("json=async()=>({...input,_source_sha:'wrong'})");
 await assert.rejects(f.run("savedViewSelection(currentCohortTarget(target,catalog),catalog.residue_ranges[0],'primary')"),/audited catalog/);
});
