/* Lossless static transport for large scientific artifacts on GitHub Pages. */
(function () {
 'use strict';
 const rawFetch=window.fetch.bind(window),script=document.currentScript,base=new URL('.',script.src),manifest=rawFetch(new URL('packed-assets.json',base),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Packed artifact inventory unavailable');return r.json()});
 async function entry(input){const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return null;const key=decodeURIComponent(url.pathname.slice(base.pathname.length));return (await manifest).files[key]||null}
 window.fetch=async function(input,init){
  const record=await entry(input);if(!record)return rawFetch(input,init);
  const request=new Request(input,init),url=new URL(request.url),packed=new URL(url);packed.pathname+='.gz';
  const response=await rawFetch(new Request(packed,request));if(!response.ok)return response;
  const headers=new Headers(response.headers);headers.set('Content-Type',record.content_type);headers.set('Content-Length',String(record.bytes));headers.delete('Content-Encoding');
  if(request.method==='HEAD')return new Response(null,{status:response.status,headers});
  if(typeof DecompressionStream==='undefined')throw Error('This browser needs gzip stream support to open these scientific artifacts. Use a current browser.');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')),{status:response.status,headers});
 };
 // Resolve the inventory once, then install a synchronous capture handler so
 // navigation is canceled before its default action, including keyboard clicks.
 manifest.then(index=>{
  document.addEventListener('click',event=>{
   const anchor=event.target.closest?.('a[download]');if(!anchor||event.defaultPrevented||anchor.href.startsWith('blob:'))return;
   const url=new URL(anchor.href);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
   const key=decodeURIComponent(url.pathname.slice(base.pathname.length)),record=index.files[key];if(!record)return;
   event.preventDefault();event.stopImmediatePropagation();
   const original=anchor.textContent;anchor.textContent='Preparing download…';anchor.setAttribute('aria-busy','true');
   fetch(url.href).then(r=>{if(!r.ok)throw Error('Download unavailable: '+r.status);return r.arrayBuffer()}).then(async bytes=>{
    if(bytes.byteLength!==record.bytes)throw Error('Artifact size verification failed');
    if(crypto.subtle){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==record.sha256)throw Error('Artifact hash verification failed');}
    const link=document.createElement('a'),blob=URL.createObjectURL(new Blob([bytes],{type:record.content_type}));link.href=blob;link.download=anchor.download||url.pathname.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
   }).catch(error=>{const box=document.getElementById('error');if(box){box.hidden=false;box.textContent=error.message}else alert(error.message)}).finally(()=>{anchor.textContent=original;anchor.removeAttribute('aria-busy')});
  },true);
 }).catch(error=>console.error(error));
})();
