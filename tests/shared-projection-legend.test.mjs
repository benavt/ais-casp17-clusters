import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const responsive=fs.readFileSync(new URL('../responsive.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map();
 for(const id of ['pca','umap','tsne','projectionLegend','plots','projection','color'])nodes.set(id,{id,value:id==='projection'?'all':'ais_method',style:{},parentElement:{hidden:false},events:{},removeAllListeners(name){delete this.events[name]},on(name,fn){this.events[name]=fn}});
 const sample={target:'TEST',view_id:'primary',models:['a','b','c','d'],methods:['AFS2','AFS3','AFS2','AFS3'],clusters:['C1','C2','C1','C2'],projections:Object.fromEntries(['pca','umap','tsne'].map(key=>[key,{axes:['X','Y'],xy:[[0,1],[2,3],[4,5],[6,7]]}])),schemes:[{key:'ais_method',name:'AIS Method',type:'categorical',values:['AFS2','AFS3','AFS2','AFS3'],colors:{AFS2:'#aabbcc',AFS3:'#445566'}},{key:'clusters',name:'Saved child clusters',type:'categorical',values:['C1','C2','C1','C2'],colors:{C1:'#112233',C2:'#778899'}},{key:'mean_plddt',name:'Mean pLDDT',type:'continuous',values:[55,null,90,null],range:[55,90],colorscale:[[0,'#000000'],[1,'#ffffff']]},{key:'ptm',name:'pTM',type:'continuous',values:[.4,null,.8,null],range:[.4,.8],colorscale:[[0,'#000000'],[1,'#ffffff']]}]};
 const context=vm.createContext({console,document:{getElementById:id=>nodes.get(id)},window:{addEventListener(){}},AtlasResponsive:{async react(node,traces,layout){node.data=traces;node.layout=layout}},Plotly:{Plots:{resize(){}}},fixture:sample});
 vm.runInContext(app+'\ndata=fixture;',context);
 return {nodes,context,sample,draw:()=>vm.runInContext('drawProjections()',context)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const scheme of ['ais_method','clusters'])test(`one shared ${scheme} legend filters all projections and survives redraw`,async()=>{
 const f=fixture();f.nodes.get('color').value=scheme;const original=JSON.stringify(f.sample);await f.draw();const legend=f.nodes.get('projectionLegend');assert.equal(legend.data.length,2);
 for(const method of ['pca','umap','tsne']){const plot=f.nodes.get(method);assert.equal(plot.layout.showlegend,false);assert(plot.data.every(t=>t.showlegend===false&&!t.marker.showscale));assert.deepEqual([...plot.data.flatMap(t=>t.customdata)].sort(),[0,1,2,3]);}
 assert.equal(legend.events.plotly_legendclick({curveNumber:0}),false);await flush();
 for(const method of ['pca','umap','tsne'])assert.equal(f.nodes.get(method).data[0].visible,'legendonly');
 await f.draw();assert.equal(legend.data[0].visible,'legendonly');
 legend.events.plotly_legendclick({curveNumber:0});await flush();for(const method of ['pca','umap','tsne'])assert.equal(f.nodes.get(method).data[0].visible,true);
 legend.events.plotly_legenddoubleclick({curveNumber:1});await flush();for(const method of ['pca','umap','tsne']){assert.equal(f.nodes.get(method).data[0].visible,'legendonly');assert.equal(f.nodes.get(method).data[1].visible,true);}
 legend.events.plotly_legenddoubleclick({curveNumber:1});await flush();assert(legend.data.every(t=>t.visible===true));
 assert.equal(JSON.stringify(f.sample),original,'Legend interaction must not change scientific inputs');
});
for(const scheme of ['mean_plddt','ptm'])test(`${scheme} has one shared scale and a shared missing-value key`,async()=>{
 const f=fixture();f.nodes.get('color').value=scheme;await f.draw();const legend=f.nodes.get('projectionLegend');assert.equal(legend.data.filter(t=>t.marker.showscale).length,1);const numeric=legend.data.find(t=>t.meta.numeric),missing=legend.data.find(t=>!t.meta.numeric);
 assert.deepEqual([...numeric.marker.color],f.sample.schemes.find(s=>s.key===scheme).range);assert.equal(missing.name,'Not calculable');assert.equal(missing.marker.color,'#808080');
 for(const method of ['pca','umap','tsne'])assert(f.nodes.get(method).data.every(t=>!t.marker.showscale&&!t.showlegend));
 legend.events.plotly_legendclick({curveNumber:legend.data.indexOf(missing)});await flush();
 for(const method of ['pca','umap','tsne']){const traces=f.nodes.get(method).data;assert.equal(traces.find(t=>!t.meta.numeric).visible,'legendonly');assert.equal(traces.find(t=>t.meta.numeric).visible,true);}
 f.nodes.get('color').value='ais_method';await f.draw();assert(f.nodes.get('pca').data.every(t=>t.visible===true),'Changing color schemes resets category filtering');
});
test('switching target or saved view clears stale hidden categories',async()=>{
 const f=fixture();await f.draw();f.nodes.get('projectionLegend').events.plotly_legendclick({curveNumber:0});await flush();f.sample.view_id='k2';await f.draw();assert(f.nodes.get('pca').data.every(t=>t.visible===true));
 f.nodes.get('projectionLegend').events.plotly_legendclick({curveNumber:0});await flush();f.sample.target='NEXT';await f.draw();assert(f.nodes.get('pca').data.every(t=>t.visible===true));
});
for(const width of [296,366,720,1480])test(`shared categorical legend and continuous scale fit ${width}px`,()=>{
 const window={innerWidth:width+24,innerHeight:844,addEventListener(){}};vm.runInNewContext(responsive,{window,document:{addEventListener(){}},setTimeout,clearTimeout});const node={id:'projectionLegend',style:{},getBoundingClientRect:()=>({width}),closest:()=>null};
 const categories=Array.from({length:29},(_,i)=>({name:'C1.'+i,showlegend:true,marker:{color:'#112233'}}));const spec=window.AtlasResponsive.prepare(node,categories,{xaxis:{visible:false},yaxis:{visible:false}},{});assert(spec.layout.height<=260);assert(spec.layout.height>=52);assert.equal(spec.config.displayModeBar,false);
 const colors=[[0,'#000'],[1,'#fff']],source={showlegend:false,marker:{showscale:true,color:[0,1],colorscale:colors}};const numeric=window.AtlasResponsive.prepare(node,[source],{},{});assert.equal(numeric.data[0].marker.colorbar.orientation,'h');assert.equal(numeric.data[0].marker.colorscale,colors);assert(!source.marker.colorbar,'Responsive shared scale must not mutate its source');
});
test('plot controls contain only reset and PNG and work without a legend toolbar',async()=>{
 const calls=[],bars=[];const document={addEventListener(){},createElement(tag){return {tag,children:[],setAttribute(){},append(child){this.children.push(child)}}}};const window={innerWidth:1440,innerHeight:900,addEventListener(){},Plotly:{async react(node,traces,layout){node.layout=layout},relayout(node,update){calls.push(['reset',update])},downloadImage(node,options){calls.push(['png',options])}}};vm.runInNewContext(responsive,{window,document,setTimeout,clearTimeout});
 const node={id:'pca',style:{},dataset:{responsiveObserved:'true'},getBoundingClientRect:()=>({width:450}),closest:()=>null,insertAdjacentElement(position,bar){bars.push(bar)}};await window.AtlasResponsive.react(node,[{x:[1],y:[2],showlegend:false}],{},{});assert.deepEqual(bars[0].children.map(b=>b.textContent),['Reset plot','Save PNG']);bars[0].children[0].onclick();bars[0].children[1].onclick();assert.equal(calls[0][0],'reset');assert.equal(calls[1][1].format,'png');
 await window.AtlasResponsive.react({...node,id:'projectionLegend'},[],{},{});assert.equal(bars.length,1,'The shared key must not get its own plot controls');
});
