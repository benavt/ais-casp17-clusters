/* Lossless static transport. Load before the atlas app. No scientific bytes change. */
(function () {
 'use strict';
 const rawFetch=window.fetch.bind(window),base=new URL('.',document.currentScript.src);
 const remoteBase='https://benavt.github.io/sr215-cohort-atlas/';
 const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
 function safePath(value){
  if(typeof value!=='string'||!value||/[\\\\?#\x00-\x1f]/.test(value)||value.startsWith('/'))return false;
  try{return value.split('/').every(part=>part&&decodeURIComponent(part)!=='.'&&decodeURIComponent(part)!=='..'&&!/[\\\\/]/.test(decodeURIComponent(part)))}catch(_){return false}
 }
 function remoteURL(value){
  if(typeof value!=='string'||!value.startsWith(remoteBase)||!safePath(value.slice(remoteBase.length)))throw Error('Invalid external artifact URL');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.origin!=='https://benavt.github.io'||url.username||url.password||url.search||url.hash)throw Error('Invalid external artifact URL');
  return url.href;
 }
 function validate(index,external){
  if(!index||typeof index!=='object'||!index.files||typeof index.files!=='object'||Array.isArray(index.files)||(external&&index.schema_version!==1))throw Error('Invalid artifact inventory');
  for(const [key,record] of Object.entries(index.files)){
   if(!safePath(key)||!record||!Number.isSafeInteger(record.bytes)||record.bytes<0||!/^[a-f0-9]{64}$/.test(record.sha256)||typeof record.content_type!=='string'||!record.content_type||/[\r\n]/.test(record.content_type))throw Error('Invalid artifact record: '+key);
   if(external||own(record,'url'))remoteURL(record.url);
  }
  return index.files;
 }
 async function inventory(name,external){
  const response=await rawFetch(new URL(name,base),{cache:'no-cache'});
  if(!response.ok)throw Error('Artifact inventory unavailable: '+name);
  return validate(await response.json(),external);
 }
 let ready=null,manifestError=null;
 const manifests=Promise.all([inventory('packed-assets.json',false),inventory('external-assets.json',true)]).then(([packed,external])=>{
  for(const key of Object.keys(packed))if(own(external,key))throw Error('Ambiguous artifact record: '+key);
  ready={packed,external};return ready;
 });
 // Retain a rejected promise for callers while avoiding an unhandled rejection.
 manifests.catch(error=>{manifestError=error;console.error(error)});
 window.AISPackedAssetsReady=manifests;
 function localKey(input){
  const value=typeof input==='string'||input instanceof URL?String(input):input.url;
  const url=new URL(value,location.href);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return null;
  const suffix=url.pathname.slice(base.pathname.length);
  if(!safePath(suffix))return null;
  try{const key=decodeURIComponent(suffix);return safePath(key)?key:null}catch(_){return null}
 }
 function find(index,key){
  if(own(index.packed,key))return {record:index.packed[key],packed:true,key};
  if(own(index.external,key))return {record:index.external[key],packed:false,key};
  return null;
 }
 async function verify(bytes,record){
  if(bytes.byteLength!==record.bytes)throw Error('Artifact size verification failed');
  const digest=crypto.subtle?[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''):window.AISExplorerTMStates?.sha256(new Uint8Array(bytes));
  if(digest!==record.sha256)throw Error('Artifact hash verification failed');
  return bytes;
 }
 async function load(request,asset){
  const {record,packed,key}=asset,url=new URL(request.url);
  const physical=record.url?remoteURL(record.url):new URL(key+'.gz',base).href;
  const target=new URL(physical);if(!record.url)target.search=url.search;
  const redirected=new Request(target,request);
  // An external mapping authorizes this exact URL, never a redirect destination.
  const response=await rawFetch(record.url?new Request(redirected,{redirect:'error'}):redirected);
  if(!response.ok)return response;
  if(record.url&&response.url&&response.url!==target.href)throw Error('External artifact redirected');
  const headers=new Headers(response.headers);headers.set('Content-Type',record.content_type);headers.set('Content-Length',String(record.bytes));headers.delete('Content-Encoding');
  if(request.method==='HEAD')return new Response(null,{status:response.status,statusText:response.statusText,headers});
  let body=response;
  if(packed){
   if(typeof DecompressionStream==='undefined')throw Error('This browser needs gzip stream support to open these scientific artifacts. Use a current browser.');
   body=new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
  }
  const bytes=await verify(await body.arrayBuffer(),record);
  return new Response(bytes,{status:response.status,statusText:response.statusText,headers});
 }
 window.fetch=async function(input,init){
  const key=localKey(input);if(key===null)return rawFetch(input,init);
  const method=String(init?.method===undefined?(input.method||'GET'):init.method).toUpperCase();
  // Constructing a Request from another Request transfers its body. Never do
  // that for operations which this transport does not handle.
  if(method!=='GET'&&method!=='HEAD')return rawFetch(input,init);
  // Request construction follows browser URL resolution and preserves overrides.
  const request=new Request(typeof input==='string'||input instanceof URL?new URL(String(input),location.href):input,init);
  if(request.method!=='GET'&&request.method!=='HEAD')return rawFetch(input,init);
  const asset=find(await manifests,key);if(!asset)return rawFetch(input,init);
  return load(request,asset);
 };
 function showError(error){const box=document.getElementById('error');if(box){box.hidden=false;box.textContent=error.message}else alert(error.message)}
  document.addEventListener('click',event=>{
   const anchor=event.target.closest?.('a[download]');if(!anchor||event.defaultPrevented||anchor.href.startsWith('blob:')||anchor.dataset.appManagedDownload==='true')return;
   const requestKey=localKey(anchor.href);if(requestKey===null)return;
   const index=ready;
   if(!index){event.preventDefault();event.stopImmediatePropagation();showError(manifestError||Error('Artifact inventory is loading. Please retry the download.'));return}
   const key=anchor.dataset.packedFile||requestKey;
   const asset=find(index,key);if(!asset||(asset.packed?requestKey!==key&&requestKey!==key+'.gz':requestKey!==key))return;
   event.preventDefault();event.stopImmediatePropagation();
   const original=anchor.textContent;anchor.textContent='Preparing download…';anchor.setAttribute('aria-busy','true');
   load(new Request(new URL(key,base)),asset).then(response=>{if(!response.ok)throw Error('Download unavailable: '+response.status);return response.arrayBuffer()}).then(bytes=>{
    const link=document.createElement('a'),blob=URL.createObjectURL(new Blob([bytes],{type:asset.record.content_type}));link.href=blob;link.download=anchor.download||key.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
   }).catch(showError).finally(()=>{anchor.textContent=original;anchor.removeAttribute('aria-busy')});
  },true);
})();
