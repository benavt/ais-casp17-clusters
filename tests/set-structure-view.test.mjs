import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const reference=[[1,2,3],[5,-1,2],[-3,4,8],[0,-2,-5],[4,5,-1]];
function fixture(){
 const nodes=new Map(['setStructureView','structureHint','spin','structureScope','structureColor','structureScopeNote','structureRegionLegend','pairSection'].map(id=>[id,{value:id==='structureScope'?'clustering':'cluster',hidden:true,children:[],options:[],style:{},setAttribute(k,v){this[k]=v},replaceChildren(){this.children=[]},append(...a){this.children.push(...a)}}]));
 const context=vm.createContext({console,document:{getElementById:id=>nodes.get(id)},window:{addEventListener(){}},fixtureMeta:{chain:'A',expected_ca_count:5,canonical_positions:[1,2,3,4,5],sequence_sha256:'seq1'},fixtureData:{target:'TEST',view_id:'density',range_id:'all'}});
 vm.runInContext(app+'\ndata=fixtureData;clusteringResidueCatalog={targets:{TEST:{views:{density:fixtureMeta,primary:fixtureMeta}}}};',context);
 const run=code=>vm.runInContext(code,context);
 const viewer={_aisModels:[],_aisDescriptor:{color:'#123456'},camera:[0,0,0,-100,0,0,0,1],slab:{near:-80,far:80},getView(){return this.camera.slice()},setView(c){this.camera=c.slice()},getSlab(){return {...this.slab}},setSlab(near,far){this.slab={near,far}},spin(){},zoomTo(){this.fits=(this.fits||0)+1},render(){}};
 context.fixtureViewer=viewer;run('viewer=fixtureViewer;selected="C1"');
 return{nodes,context,run,viewer,meta:context.fixtureMeta};
}
function model(points,start=1){
 const atoms=points.flatMap((p,i)=>['CA','CB'].map(atom=>({atom,chain:'A',resi:start+i,icode:'',x:p[0],y:p[1],z:p[2],style:{}})));
 return {atoms,selectedAtoms:s=>atoms.filter(a=>(!s.atom||s.atom===a.atom)&&(!s.chain||a.chain===s.chain)),setStyle(s,style){for(const a of atoms)if(!s.predicate||s.predicate(a))a.style=style}};
}
function close(a,b,tolerance=1e-9){assert.equal(a.length,b.length);a.flat(Infinity).forEach((v,i)=>assert.ok(Math.abs(v-b.flat(Infinity)[i])<tolerance,`${v} vs ${b.flat(Infinity)[i]}`))}
function fit(mobile,ref=reference){const f=fixture();f.context.mobile=mobile;f.context.ref=ref;return JSON.parse(JSON.stringify(f.run('const fitted=rigidViewFit(mobile,ref);({rotation:fitted.rotation,aligned:mobile.map(p=>transformViewPoint(p,fitted))})')))}
function determinant(m){return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])}
function selectionFixture(){
 const f=fixture(),raw=['SAVED anchor bytes\n','SAVED mobile bytes\n','SAVED second mobile bytes\n'],mobile=reference.map(([x,y,z])=>[-y+11,x-7,z+5]),second=reference.map(([x,y,z])=>[x-20,-y+3,-z+9]);
 const sources=new Map([[raw[0],[reference]],[raw[1],[mobile]],[raw[2],[second]]]),requests=new Map(),blobs=new Map(),added=[];
 for(const id of ['clusterSelect','clusterRows','error','modelTitle','modelInfo','structure','ensemblePdb','ensemblePse','modelMode','pca','umap','tsne'])f.nodes.set(id,{value:id==='modelMode'?'medoid':'',children:[],options:id==='modelMode'?[{value:'medoid'},{value:'ensemble'}]:[],setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}});
 const representatives=raw.map((coordinate_text,i)=>({cluster:'C'+(i+1),model:'model-'+i,method:'fixture',count:1,color:'#123456',file:'models/C'+(i+1)+'.pdb',format:'pdb',...(i===0?{coordinate_text}:{})}));
 f.nodes.get('clusterRows').children=representatives.map(rep=>({dataset:{cluster:rep.cluster},classList:{toggle(){},remove(){}},setAttribute(){}}));
 Object.assign(f.context.fixtureData,{representatives,models:representatives.map(rep=>rep.model),clusters:representatives.map(rep=>rep.cluster),schemes:[],projections:Object.fromEntries(['pca','umap','tsne'].map(method=>[method,{xy:[[0,1],[2,3],[4,5]],axes:['x','y']}]))});
 Object.assign(f.context,{AbortSignal,Blob,URL:{createObjectURL(blob){const url='blob:fixture-'+blobs.size;blobs.set(url,blob);return url},revokeObjectURL(){}},Plotly:{relayout(){}},fetch:url=>new Promise((resolve,reject)=>requests.set(url,{resolve,reject}))});
 f.viewer.removeAllModels=()=>{f.viewer._aisModels=[]};
 f.viewer.addModel=(text,format)=>{assert.equal(format,'pdb');added.push(text);return model(sources.get(text)[0],0)};
 f.viewer.addModels=(text,format)=>{assert.equal(format,'pdb');added.push(text);return sources.get(text).map((points,i)=>model(points,i))};
 f.viewer._aisModels=[model(reference)];f.viewer._aisDescriptor=representatives[0];f.viewer._aisEnsemble=false;
 return {...f,raw,sources,requests,blobs,added,representatives,resolve(label,text=raw[1]){const request=requests.get('models/'+label+'.pdb');assert.ok(request,'selection must have requested '+label);request.resolve({ok:true,text:async()=>text})}};
}
test('rigid fit recovers translated identity, arbitrary proper rotations, and 180-degree rotations',()=>{
 const axes=[[1,0,0],[0,1,0],[0,0,1],[1,2,3]];
 for(const axis of axes)for(const angle of [0,.73,Math.PI]){
  const unit=axis.map(x=>x/Math.hypot(...axis)),[x,y,z]=unit,c=Math.cos(angle),s=Math.sin(angle),d=1-c;
  const r=[[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
  const mobile=reference.map(p=>r.map((row,i)=>row.reduce((sum,v,j)=>sum+v*p[j],i*7+10))),result=fit(mobile);
  close(result.aligned,reference);assert.ok(Math.abs(determinant(result.rotation)-1)<1e-10);
 }
});
test('planar triangles fit while collinear, coincident and nonfinite inputs reject',()=>{
 const planar=[[0,0,0],[1,0,0],[0,1,0]],mobile=planar.map(([x,y,z])=>[y+5,-x+8,z-3]);close(fit(mobile,planar).aligned,planar);
 for(const points of [[[0,0,0],[1,0,0],[2,0,0]],[[1,1,1],[1,1,1],[1,1,1]],[[0,0,0],[NaN,1,1],[2,2,0]]])assert.throws(()=>fit(points,points),/orientation|coordinates/);
});
test('a reflection stays a proper rotation with nonzero residual, never mirrors or rescales',()=>{
 const result=fit(reference.map(([x,y,z])=>[-x,y,z]));assert.ok(Math.abs(determinant(result.rotation)-1)<1e-10);
 assert.ok(result.aligned.flat().some((v,i)=>Math.abs(v-reference.flat()[i])>.1));
 close(result.aligned.slice(0,1).map(p=>[Math.hypot(...p.map((x,i)=>x-result.aligned[1][i]))]),[[Math.hypot(...reference[0].map((x,i)=>x-reference[1][i]))]]);
});
test('pin copies canonical CA coordinates, camera and slab, then aligns zero-numbered frames and all atoms',()=>{
 const f=fixture();f.viewer._aisModels=[model(reference)];f.run('setStructureView()');assert.equal(f.nodes.get('setStructureView').textContent,'Release view');assert.equal(f.nodes.get('setStructureView')['aria-pressed'],'true');
 const saved=JSON.parse(f.run('JSON.stringify(structureViewAnchor)'));f.viewer.camera[0]=99;f.viewer.slab.near=-3;f.viewer._aisModels[0].atoms[0].x=999;
 assert.equal(f.run('structureViewAnchor.camera.view[0]'),0);assert.equal(f.run('structureViewAnchor.camera.slab.near'),-80);assert.equal(f.run('structureViewAnchor.reference[0][0]'),1);
 const frames=[model(reference.map(([x,y,z])=>[-y+11,x-7,z+5]),0),model(reference.map(([x,y,z])=>[x-20,-y+3,-z+9]),1)];f.viewer._aisModels=frames;
 assert.equal(f.run('alignStructureToSetView()'),true);
 for(const frame of frames)close(frame.atoms.map(a=>[a.x,a.y,a.z]),reference.flatMap(p=>[p,p]));
 f.run('frameSelectedStructure(structureViewAnchor.camera)');close(f.viewer.camera,saved.camera.view);assert.deepEqual(f.viewer.slab,saved.camera.slab);assert.equal(f.viewer.fits,undefined);
});
test('one invalid ensemble frame releases the pin before changing any atom',()=>{
 const f=fixture();f.viewer._aisModels=[model(reference)];f.run('setStructureView()');const frames=[model(reference.map(p=>p.map(v=>v+10))),model(reference.slice(1))];f.viewer._aisModels=frames;const before=JSON.stringify(frames.map(m=>m.atoms));
 assert.equal(f.run('alignStructureToSetView()'),false);assert.equal(JSON.stringify(frames.map(m=>m.atoms)),before);assert.equal(f.run('structureViewAnchor'),null);assert.match(f.nodes.get('structureHint').textContent,/released/);
});
test('restyling preserves pinned pan, zoom, rotation and slab without repeated transforms',()=>{
 const f=fixture();f.viewer._aisModels=[model(reference)];f.run('setStructureView()');f.viewer.camera=[7,8,9,-250,.2,0,0,Math.sqrt(.96)];f.viewer.slab={near:-150,far:160};const camera=f.viewer.camera.slice(),coords=JSON.stringify(f.viewer._aisModels[0].atoms.map(a=>[a.x,a.y,a.z]));
 f.run('restyleStructureViews();restyleStructureViews()');close(f.viewer.camera,camera);assert.deepEqual(f.viewer.slab,{near:-150,far:160});assert.equal(JSON.stringify(f.viewer._aisModels[0].atoms.map(a=>[a.x,a.y,a.z])),coords);assert.equal(f.viewer.fits,undefined);
 f.run('setStructureView()');assert.equal(f.run('structureViewAnchor'),null);f.run('frameSelectedStructure()');assert.equal(f.viewer.fits,1);
});
test('same-target label scheme keeps the anchor; changes of target, range, sequence or mask release it',()=>{
 for(const change of ['data.target="OTHER"','data.range_id="regional"','fixtureMeta.sequence_sha256="seq2"','fixtureMeta.canonical_positions=[1,2,3,4]']){
  const f=fixture();f.viewer._aisModels=[model(reference)];f.run('setStructureView();data.view_id="primary"');assert.equal(f.run('alignStructureToSetView()'),true);f.run(change);assert.equal(f.run('alignStructureToSetView()'),false);assert.equal(f.run('structureViewAnchor'),null);
 }
});
test('missing representative or canonical map disables Set view, and a degenerate anchor cannot pin',()=>{
 const f=fixture();f.run('updateStructureViewControls()');assert.equal(f.nodes.get('setStructureView').disabled,true);f.viewer._aisModels=[model(reference)];f.run('clusteringResidueCatalog={};updateStructureViewControls()');assert.equal(f.nodes.get('setStructureView').disabled,true);
 const other=fixture();other.viewer._aisModels=[model(reference.map((p,i)=>[i,0,0]))];other.run('setStructureView()');assert.equal(other.run('structureViewAnchor'),null);assert.match(other.nodes.get('structureHint').textContent,/Could not set view/);
});
test('Clear keeps the latest pinned camera for the next model while disabling the empty-scene button',async()=>{
 const f=selectionFixture();f.run('setStructureView()');f.viewer.camera=[9,8,7,-220,0,.3,0,Math.sqrt(.91)];f.viewer.slab={near:-170,far:180};const camera=f.viewer.camera.slice();
 f.run('clearStructure()');assert.equal(f.nodes.get('setStructureView').disabled,true);assert.equal(f.run('structureViewAnchor!==null'),true);close(JSON.parse(f.run('JSON.stringify(structureViewAnchor.activeCamera.view)')),camera);
 f.representatives[1].coordinate_text=f.raw[1];await f.run('choose("C2")');close(f.viewer.camera,camera);assert.deepEqual(f.viewer.slab,{near:-170,far:180});assert.equal(f.nodes.get('setStructureView').disabled,false);close(f.viewer._aisModels[0].atoms.map(a=>[a.x,a.y,a.z]),reference.flatMap(p=>[p,p]));
});
test('Reset during an asynchronous selection wins over the camera captured before the fetch',async()=>{
 const f=selectionFixture();f.run('setStructureView()');const initial=f.viewer.camera.slice();f.viewer.camera=[7,6,5,-330,.2,0,0,Math.sqrt(.96)];f.viewer.slab={near:-190,far:210};
 const pending=f.run('choose("C2")');assert.equal(f.nodes.get('setStructureView').disabled,true);assert.equal(f.viewer._aisModels.length,0);
 // This is the Reset view handler, exercised while the source request is pending.
 f.run('frameSelectedStructure(structureViewAnchor.camera)');f.resolve('C2');await pending;
 close(f.viewer.camera,initial);assert.deepEqual(f.viewer.slab,{near:-80,far:80});assert.equal(f.viewer.fits,undefined);assert.equal(f.viewer._aisDescriptor.cluster,'C2');
});
test('a stale selection cannot replace a newer model or camera, and source downloads stay exact',async()=>{
 const f=selectionFixture();f.run('setStructureView()');const scientific=JSON.stringify({models:f.context.fixtureData.models,clusters:f.context.fixtureData.clusters,projections:f.context.fixtureData.projections}),pending=f.run('choose("C2")');
 f.run('frameSelectedStructure(structureViewAnchor.camera)');f.representatives[2].coordinate_text=f.raw[2];await f.run('choose("C3")');const camera=f.viewer.camera.slice(),href=f.nodes.get('structure').href,anchor=f.run('JSON.stringify(structureViewAnchor)');
 f.resolve('C2');await pending;
 assert.deepEqual(f.added,[f.raw[2]]);assert.equal(f.viewer._aisDescriptor.cluster,'C3');close(f.viewer.camera,camera);assert.equal(f.run('JSON.stringify(structureViewAnchor)'),anchor);assert.equal(f.nodes.get('structure').href,href);assert.equal(await f.blobs.get(href).text(),f.raw[2]);assert.equal(f.representatives[2].coordinate_text,f.raw[2]);close(f.viewer._aisModels[0].atoms.map(a=>[a.x,a.y,a.z]),reference.flatMap(p=>[p,p]));assert.equal(JSON.stringify({models:f.context.fixtureData.models,clusters:f.context.fixtureData.clusters,projections:f.context.fixtureData.projections}),scientific);
});
test('Clear cancels an in-flight model, and an unassigned selection preserves the pin without a false representative',async()=>{
 const f=selectionFixture();f.run('setStructureView()');const pending=f.run('choose("C2")');f.run('clearStructure()');f.resolve('C2');await pending;assert.deepEqual(f.added,[]);assert.equal(f.viewer._aisDescriptor,null);assert.equal(f.nodes.get('setStructureView').disabled,true);
 f.representatives[2].coordinate_text=f.raw[2];await f.run('choose("C3")');f.viewer.camera=[3,2,1,-250,0,0,0,1];await f.run('choose("C1.unassigned")');assert.equal(f.viewer._aisDescriptor,null);assert.equal(f.viewer._aisModels.length,0);assert.match(f.nodes.get('modelInfo').textContent,/left unassigned/);assert.equal(f.nodes.get('structure').href,undefined);assert.equal(f.nodes.get('setStructureView').disabled,true);assert.equal(f.run('structureViewAnchor!==null'),true);
 await f.run('choose("C3")');close(f.viewer.camera,[3,2,1,-250,0,0,0,1]);assert.equal(f.viewer._aisDescriptor.cluster,'C3');
});
test('an asynchronous source failure leaves the pin usable for a subsequent valid model',async()=>{
 const f=selectionFixture();f.run('setStructureView()');f.viewer.camera=[5,4,3,-270,0,0,0,1];const pending=f.run('choose("C2")');f.requests.get('models/C2.pdb').reject(new Error('fixture network failure'));await assert.rejects(pending,/fixture network failure/);assert.equal(f.run('structureViewAnchor!==null'),true);assert.equal(f.viewer._aisModels.length,0);assert.equal(f.nodes.get('setStructureView').disabled,true);
 f.representatives[2].coordinate_text=f.raw[2];await f.run('choose("C3")');close(f.viewer.camera,[5,4,3,-270,0,0,0,1]);assert.equal(f.viewer._aisDescriptor.cluster,'C3');
});
test('choosing an ensemble aligns every frame but preserves representative and ensemble download bytes',async()=>{
 const f=selectionFixture(),ensemble='SAVED ensemble bytes\n';f.sources.set(ensemble,[reference.map(([x,y,z])=>[-y+11,x-7,z+5]),reference.map(([x,y,z])=>[x-20,-y+3,-z+9])]);Object.assign(f.representatives[1],{coordinate_text:f.raw[1],ensemble_file:'models/C2-ensemble.pdb',ensemble_text:ensemble,ensemble_pse:'models/C2.pse'});f.run('setStructureView()');f.nodes.get('modelMode').value='ensemble';await f.run('choose("C2")');
 assert.equal(f.viewer._aisModels.length,2);for(const frame of f.viewer._aisModels)close(frame.atoms.map(a=>[a.x,a.y,a.z]),reference.flatMap(p=>[p,p]));assert.equal(await f.blobs.get(f.nodes.get('structure').href).text(),f.raw[1]);assert.equal(await f.blobs.get(f.nodes.get('ensemblePdb').href).text(),ensemble);assert.equal(f.nodes.get('ensemblePse').href,'models/C2.pse');assert.equal(f.representatives[1].coordinate_text,f.raw[1]);assert.equal(f.representatives[1].ensemble_text,ensemble);
});
