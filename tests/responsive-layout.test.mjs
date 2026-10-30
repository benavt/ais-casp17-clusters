import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../responsive.js',import.meta.url),'utf8');
const screens=[[320,568],[390,844],[430,932],[768,1024],[1024,768],[1366,768],[1440,900],[844,390]];
for(const [screenWidth,screenHeight]of screens){
 test(`square matrix fits ${screenWidth}×${screenHeight} without changing data`,()=>{
  const window={innerWidth:screenWidth,innerHeight:screenHeight,addEventListener(){}};
  vm.runInNewContext(code,{window,document:{addEventListener(){}},setTimeout,clearTimeout});
  const width=screenWidth-48,node={id:'medoidTM',style:{},getBoundingClientRect:()=>({width}),closest:()=>null};
  for(const n of [2,29,132]){
   const labels=Array.from({length:n},(_,i)=>`Cluster ${i+1}`),matrix=Array.from({length:n},()=>Array(n).fill(.5));
   const source={type:'heatmap',x:labels,y:labels,z:matrix,colorbar:{title:{text:'TM similarity'}}},before=JSON.stringify(source);
   const result=window.AtlasResponsive.prepare(node,[source],{height:1000,yaxis:{scaleanchor:'x'}},{}),{margin,xaxis,height}=result.layout;
   const xspan=(width-margin.l-margin.r)*(xaxis.domain[1]-xaxis.domain[0]),yspan=height-margin.t-margin.b;
   assert(Math.abs(xspan-yspan)<1.1,'The heat map must fill a square rather than a tall empty canvas');
   assert.equal(node.style.height,height+'px','Document flow must reserve the rendered plot height');
   const positions=xaxis.tickvals.map(label=>labels.indexOf(label)*xspan/n);for(let i=1;i<positions.length;i++)assert(positions[i]-positions[i-1]>=30,'Keep final endpoint labels from crowding adjacent ticks');
   assert.equal(result.data[0].colorbar.orientation,'h');assert.equal(result.data[0].z,matrix);assert.equal(result.data[0].x,labels);
   assert.equal(JSON.stringify(source),before,'Responsive formatting must preserve the source trace');
   assert.equal(xaxis.range[1],n-.5);assert.equal(result.layout.yaxis.range[0],n-.5);
  }
 });
 test(`other plot types fit ${screenWidth}×${screenHeight}`,()=>{
  const window={innerWidth:screenWidth,innerHeight:screenHeight,addEventListener(){}};
  vm.runInNewContext(code,{window,document:{addEventListener(){}},setTimeout,clearTimeout});
  const width=screenWidth-48;
  for(const type of ['scattergl','violin','scatter']){
   const node={id:type==='scattergl'?'pca':type,style:{},getBoundingClientRect:()=>({width}),closest:()=>null};
   const values=[.2,.5,.9],source={type,x:[1,2,3],y:values};
   const spec=window.AtlasResponsive.prepare(node,[source],{xaxis:{title:{text:'Structure'}},yaxis:{title:{text:'Similarity'},range:[0,1]}},{});
   assert(!('marker'in spec.data[0]),'Traces without markers must omit the marker property for Plotly compatibility');assert.equal(spec.layout.width,width);assert.deepEqual([...spec.layout.yaxis.range],[0,1]);assert(spec.layout.height>=320);assert.equal(spec.data[0].y,values);assert.equal(spec.config.displayModeBar,type==='scattergl'?false:width>=600);
  }
 });
}
test('serializes resize and data renders for the same Plotly element',async()=>{
 let active=0,maximum=0,calls=0;
 const window={innerWidth:390,innerHeight:844,addEventListener(){},Plotly:{async react(){active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;calls++}}};
 vm.runInNewContext(code,{window,document:{addEventListener(){}},setTimeout,clearTimeout});
 const node={id:'pca',style:{},dataset:{responsiveObserved:'true'},getBoundingClientRect:()=>({width:340}),closest:()=>null,nextElementSibling:{classList:{contains:()=>true}}};
 await Promise.all([1,2,3].map(()=>window.AtlasResponsive.react(node,[{type:'scatter',x:[1],y:[.5]}],{},{})));
 assert.equal(calls,3);assert.equal(maximum,1,'Overlapping Plotly renders can corrupt mutable trace state');
});

test('explorer thumbnails fit compact widths and retain the original scientific arrays',()=>{
 const window={innerWidth:1440,innerHeight:900,addEventListener(){}};
 vm.runInNewContext(code,{window,document:{addEventListener(){}},setTimeout,clearTimeout});
 const source={type:'scattergl',x:[1,2,3],y:[4,5,6],customdata:[0,1,2],marker:{color:['red','green','blue'],size:4.5},showlegend:false},before=JSON.stringify(source);
 for(const width of [96,150,230]){
  const panel={classList:{contains:()=>false}},node={id:'pca',style:{},getBoundingClientRect:()=>({width}),closest:selector=>selector==='.cluster-view'?panel:null};
  const spec=window.AtlasResponsive.prepare(node,[source],{xaxis:{title:{text:'PC1'}},yaxis:{title:{text:'PC2'}}},{});
  assert.equal(spec.layout.width,width,'A thumbnail must not acquire a larger artificial minimum width');
  assert(spec.layout.height<width);assert.equal(spec.layout.xaxis.visible,false);assert.equal(spec.layout.hovermode,false);
  assert.equal(spec.data[0].x,source.x);assert.equal(spec.data[0].customdata,source.customdata);assert.equal(JSON.stringify(source),before);
 }
});

test('featured explorer view restores axes and shares the plot toolbar',async()=>{
 const window={innerWidth:390,innerHeight:844,addEventListener(){},Plotly:{async react(node,traces,layout){node.layout=layout}}};
 vm.runInNewContext(code,{window,document:{addEventListener(){},createElement(){throw Error('A projection must use the shared explorer toolbar')}},setTimeout,clearTimeout});
 const panel={classList:{contains:()=>true}},node={id:'umap',style:{},dataset:{responsiveObserved:'true'},getBoundingClientRect:()=>({width:336}),closest:selector=>selector==='.cluster-view'?panel:null};
 const spec=window.AtlasResponsive.prepare(node,[{type:'scattergl',x:[1],y:[2]}],{xaxis:{title:{text:'UMAP 1'}},yaxis:{title:{text:'UMAP 2'}}},{});
 assert.equal(spec.layout.xaxis.visible,true);assert.equal(spec.layout.xaxis.title.text,'UMAP 1');assert.equal(spec.layout.hovermode,'closest');assert.equal(spec.config.displayModeBar,false);assert(spec.layout.height<500);
 await window.AtlasResponsive.react(node,[{type:'scattergl',x:[1],y:[2]}],{},{});
});
