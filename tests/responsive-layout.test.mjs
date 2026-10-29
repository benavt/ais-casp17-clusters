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
   assert(!('marker'in spec.data[0]),'Traces without markers must omit the marker property for Plotly compatibility');assert.equal(spec.layout.width,width);assert.deepEqual([...spec.layout.yaxis.range],[0,1]);assert(spec.layout.height>=320);assert.equal(spec.data[0].y,values);assert.equal(spec.config.displayModeBar,width>=600);
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
