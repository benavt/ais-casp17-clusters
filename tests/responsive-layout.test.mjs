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
   assert.equal(spec.layout.width,width);assert.deepEqual([...spec.layout.yaxis.range],[0,1]);assert(spec.layout.height>=320);assert.equal(spec.data[0].y,values);assert.equal(spec.config.displayModeBar,width>=600);
  }
 });
}
