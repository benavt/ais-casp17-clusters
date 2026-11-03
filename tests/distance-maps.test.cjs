'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const nodes=new Map(),plots=[];
 const element=()=>({children:[],append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
 const context=vm.createContext({console,window:{addEventListener(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},createElement:element},AtlasResponsive:{async react(...args){plots.push(args)}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),context);
 return{nodes,plots,context,run:code=>vm.runInContext(code,context)};
}
test('distance maps preserve discontinuous residue identities and equal-width matrix cells',async()=>{
 const f=fixture(),entry={positions:[32,33,78,79],sample_count:11000,note:'Saved summaries.',views:{primary:true},median_matrix:[[0,1,2,3],[1,0,4,5],[2,4,0,6],[3,5,6,0]],variance_matrix:[[0,2,4,6],[2,0,8,10],[4,8,0,12],[6,10,12,0]]};
 f.context.fixtureEntry=entry;f.run('data={target:"SR215",range_id:"selected38",view_id:"primary"};supplementaryMetadataCatalog={targets:{SR215:{ranges:{selected38:fixtureEntry}}}};configureDistanceMaps()');
 assert.match(f.nodes.get('heatmaps').children[0].textContent,/canonical residues 32–33, 78–79/);
 await f.run('drawDistanceMaps()');assert.equal(f.plots.length,2);
 for(const [i,[,traces,layout]]of f.plots.entries()){
  assert.equal(traces[0].z,i?entry.variance_matrix:entry.median_matrix);assert.equal(traces[0].x,entry.positions);assert.equal(traces[0].y,entry.positions);
  for(const axis of [layout.xaxis,layout.yaxis]){assert.equal(axis.type,'category');assert.equal(axis.categoryarray,entry.positions);assert.equal(axis.categoryorder,'array');}
 }
});
test('existing image-based summaries remain available when numeric summaries are absent',()=>{
 const f=fixture();f.run('data={target:"other",heatmaps:[{file:"median.png",name:"Median"},{file:"variance.png",name:"Variance"}]};configureDistanceMaps()');
 assert.deepEqual(f.nodes.get('heatmaps').children.map(a=>[a.href,a.children[0].src,a.children[0].alt]),[['median.png','median.png','Median'],['variance.png','variance.png','Variance']]);
});
