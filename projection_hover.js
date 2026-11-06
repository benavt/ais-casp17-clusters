/* Prefer nearby saved state samples without moving the cursor or changing data. */
(function(root){'use strict';
const RADIUS=12,bindings=new WeakMap();
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function decorate(trace,data,scheme,{state_id,method,color}){
 const label=method==='mcmc50'?'MCMC50':'DISCO50';
 // A small SVG sample layer supports exact Plotly point-number hovering above the GL population.
 return {...trace,type:'scatter',marker:{...trace.marker,color,line:{...trace.marker.line,color}},text:trace.customdata.map(i=>`<b>Highlighted · ${label} · ${escape(state_id)}</b><br>${escape(data.models[i])}<br>${escape(data.methods[i])} · ${escape(data.clusters[i])}${scheme.type==='continuous'&&Number.isFinite(scheme.values[i])?'<br>'+escape(scheme.name)+': '+scheme.values[i].toFixed(3):''}`),hoverinfo:undefined,hovertemplate:'%{text}<extra></extra>',hoverlabel:{bgcolor:'#ffffff',bordercolor:color,font:{color:'#202020'}},meta:{...trace.meta,stateSampleHover:true,state_id,stateColor:color,samplingMethod:method}};
}
function nearest(node,event,radius=RADIUS,click=false){
 const layout=node._fullLayout,xa=layout?.xaxis,ya=layout?.yaxis;
 if(!xa?.d2p||!ya?.d2p||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY)||(!click&&(layout._dragging||event.buttons)))return null;
 const rect=node.getBoundingClientRect(),x=event.clientX-rect.left-xa._offset,y=event.clientY-rect.top-ya._offset;
 if(x<0||y<0||x>xa._length||y>ya._length)return null;
 let best=null,distance=radius*radius;
 for(const [curveNumber,trace]of (node.data||[]).entries()){
  if(!trace.meta?.stateSampleHover||trace.visible===false||trace.visible==='legendonly')continue;
  for(let pointNumber=0;pointNumber<trace.x.length;pointNumber++){
   const px=xa.d2p(trace.x[pointNumber]),py=ya.d2p(trace.y[pointNumber]);
   if(!Number.isFinite(px)||!Number.isFinite(py)||px<0||py<0||px>xa._length||py>ya._length)continue;
   const d=(px-x)**2+(py-y)**2;
   if(d<=distance&&(d<distance||best===null)){distance=d;best={curveNumber,pointNumber,index:trace.customdata[pointNumber],color:trace.meta.stateColor};}
  }
 }
 return best;
}
function bind(node,Plotly=root.Plotly){
 if(bindings.has(node))return bindings.get(node);
 let frame=null,current=null,pointer=null;
 function clear(unhover=false){current=null;node.removeAttribute('data-state-sample-hover');if(unhover)Plotly.Fx.unhover(node)}
 function schedule(event){
  pointer=event;if(frame!==null)root.cancelAnimationFrame(frame);
  frame=root.requestAnimationFrame(()=>{frame=null;const picked=nearest(node,pointer);if(!picked){if(current)clear(false);return}current=picked;node.setAttribute('data-state-sample-hover','true');Plotly.Fx.hover(node,[{curveNumber:picked.curveNumber,pointNumber:picked.pointNumber}]);});
 }
 node.addEventListener('mousemove',schedule);
 node.addEventListener('mouseup',schedule);
 node.addEventListener('mouseleave',()=>{pointer=null;if(frame!==null){root.cancelAnimationFrame(frame);frame=null}if(current)clear(true)});
 node.addEventListener('mousedown',event=>{pointer=event;if(current)clear(false)});
 node.on?.('plotly_hover',event=>{
  const picked=nearest(node,pointer),point=event.points?.[0];
  if(picked&&point&&(point.curveNumber!==picked.curveNumber||point.pointNumber!==picked.pointNumber))schedule(pointer);
 });
 node.on?.('plotly_afterplot',()=>{current=null;node.removeAttribute('data-state-sample-hover')});
 const api={pick:event=>nearest(node,event,RADIUS,true),clear};bindings.set(node,api);return api;
}
const api={RADIUS,decorate,nearest,bind};root.AISProjectionHover=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
