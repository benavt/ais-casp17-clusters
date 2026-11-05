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
