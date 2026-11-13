'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {gzipSync}=require('node:zlib'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(__dirname+'/../packed_assets.js','utf8');
const base='https://benavt.github.io/ais-casp17-clusters/',remote='https://benavt.github.io/sr215-cohort-atlas/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const saved=Buffer.from('MODEL        1\nATOM saved scientific coordinates\nENDMDL\n');
const zipped=gzipSync(saved),raw=Buffer.from('raw ZIP or gzip identity bytes');
const record=(bytes,url)=>({bytes:bytes.length,sha256:hash(bytes),content_type:'application/octet-stream',...(url?{url}:{})});
async function fixture(options={}){
 const packed=options.packed||{files:{'TARGET/model.pdb':record(saved),'TARGET/remote.json':record(saved,remote+'assets/remote.json.gz')}};
 const external=options.external||{schema_version:1,files:{'TARGET/ensemble.pdb.gz':record(raw,remote+'assets/ensemble.pdb.gz'),'TARGET/selection.zip':record(raw,remote+'assets/selection.zip')}};
 const calls=[],handlers=[],downloads=[],blobs=new Map(),errors=[],errorBox={hidden:true,textContent:''};
 class LocalURL extends URL{static createObjectURL(blob){const key='blob:checked-'+blobs.size;blobs.set(key,blob);return key}static revokeObjectURL(){}}
 async function fetch(input,init){
  calls.push({input,init,url:String(input.url||input)});const url=calls.at(-1).url;
  if(url===base+'packed-assets.json')return new Response(JSON.stringify(packed));
  if(url===base+'external-assets.json')return new Response(options.externalBadJSON?'invalid':JSON.stringify(external),{status:options.externalStatus||200});
  if(options.response)return options.response(input,init);
  const request=input instanceof Request?input:null;
  const bytes=url.startsWith(remote+'assets/ensemble')||url.startsWith(remote+'assets/selection')?raw:zipped;
  return new Response(request?.method==='HEAD'?null:options.corrupt?Buffer.from('invalid'):bytes,{headers:{'Content-Encoding':'identity','X-Source':'native'}});
 }
 const context={URL:LocalURL,Request,Response,Headers,Blob,DecompressionStream,crypto:options.noSubtle?{}:webcrypto,AISExplorerTMStates:{sha256:b=>hash(b)},console:{error:e=>errors.push(e)},location:{href:base+'index.html#TARGET'},setTimeout(){},alert:e=>errors.push(e),document:{currentScript:{src:base+'packed_assets.js'},addEventListener(name,handler,capture){assert.equal(name,'click');assert.equal(capture,true);handlers.push(handler)},getElementById(){return errorBox},createElement(){return {click(){downloads.push({name:this.download,blob:blobs.get(this.href)})}}}},fetch};
 context.window=context;vm.runInNewContext(source,context);
 if(!options.invalid)await context.AISPackedAssetsReady;
 function click(key,options={}){
  const anchor={href:base+key,download:options.download===undefined?'saved-original.pdb':options.download,dataset:options.dataset||{},textContent:'Download',setAttribute(){},removeAttribute(){}},event={target:{closest:()=>anchor},preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true}};
  if(options.href)anchor.href=options.href;
  handlers[0]?.(event);return {event,anchor};
 }
 return {context,calls,handlers,downloads,errors,errorBox,click};
}
async function settled(predicate){for(let n=0;n<100&&!predicate();n++)await new Promise(r=>setTimeout(r,5));assert(predicate())}
test('local logical packed fetch decompresses and verifies original bytes',async()=>{
 const f=await fixture(),response=await f.context.fetch('TARGET/model.pdb');
 assert.equal(await response.text(),saved.toString());assert.equal(response.headers.get('content-length'),String(saved.length));assert.equal(response.headers.get('content-encoding'),null);assert.equal(f.calls.at(-1).url,base+'TARGET/model.pdb.gz');
});
test('remote logical packed record fetches allowed physical gzip and decompresses',async()=>{
 const f=await fixture(),response=await f.context.fetch(base+'TARGET/remote.json');assert.equal(await response.text(),saved.toString());assert.equal(f.calls.at(-1).url,remote+'assets/remote.json.gz');
});
test('raw external records preserve already-compressed identity bytes and exact physical URL',async()=>{
 const f=await fixture(),response=await f.context.fetch('TARGET/ensemble.pdb.gz?cache=caller');assert.deepEqual(Buffer.from(await response.arrayBuffer()),raw);assert.equal(f.calls.at(-1).url,remote+'assets/ensemble.pdb.gz');assert.equal(f.calls.at(-1).input.redirect,'error');
});
test('HEAD preserves method and headers without reading or decompressing bodies',async()=>{
 for(const key of ['TARGET/model.pdb','TARGET/remote.json','TARGET/ensemble.pdb.gz']){
  const f=await fixture(),response=await f.context.fetch(new Request(base+key,{method:'HEAD',headers:{Authorization:'Bearer bounded-test'}}));assert.equal(await response.text(),'');assert.equal(f.calls.at(-1).input.method,'HEAD');assert.equal(f.calls.at(-1).input.headers.get('Authorization'),'Bearer bounded-test');
 }
});
test('asset Request headers, auth, cache, credentials, abort signal and init overrides survive',async()=>{
 const f=await fixture(),controller=new AbortController(),request=new Request(base+'TARGET/remote.json',{headers:{Authorization:'Bearer test','X-Old':'before'},cache:'no-store',credentials:'include',signal:controller.signal});
 await f.context.fetch(request,{headers:{Authorization:'Bearer override','X-New':'after'}});const sent=f.calls.at(-1).input;
 assert.equal(sent.headers.get('Authorization'),'Bearer override');assert.equal(sent.headers.get('X-Old'),null);assert.equal(sent.headers.get('X-New'),'after');assert.equal(sent.cache,'no-store');assert.equal(sent.credentials,'include');controller.abort();assert(sent.signal.aborted);assert(!request.bodyUsed);
});
test('POST bodies and Request identity pass through unchanged; method init wins',async()=>{
 const f=await fixture(),request=new Request(base+'TARGET/model.pdb',{method:'POST',body:'exact-body',headers:{Authorization:'Bearer test'}});await f.context.fetch(request);assert.equal(f.calls.at(-1).input,request);assert.equal(await request.text(),'exact-body');
 const init={method:'POST',body:'override-body'};await f.context.fetch('TARGET/model.pdb',init);assert.equal(f.calls.at(-1).input,'TARGET/model.pdb');assert.equal(f.calls.at(-1).init,init);
});
test('unrelated origins, sibling base paths and unmapped relative paths pass through exactly',async()=>{
 const f=await fixture();for(const input of ['https://elsewhere.org/ais-casp17-clusters/TARGET/model.pdb','https://benavt.github.io/ais-casp17-clusters-extra/TARGET/model.pdb','other.json','../unrelated.json']){
  const init={headers:{'X-Test':'same'}};await f.context.fetch(input,init);assert.equal(f.calls.at(-1).input,input);assert.equal(f.calls.at(-1).init,init);
 }
});
test('download capture supports local packed physical link, remote packed logical link and raw remote',async()=>{
 for(const [key,dataset,expected] of [['TARGET/model.pdb.gz',{packedFile:'TARGET/model.pdb'},saved],['TARGET/remote.json',{},saved],['TARGET/ensemble.pdb.gz',{},raw],['TARGET/selection.zip',{},raw]]){
  const f=await fixture(),{event}=f.click(key,{dataset,download:'logical-name.pdb'});assert(event.defaultPrevented&&event.stopped);await settled(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'logical-name.pdb');assert.deepEqual(Buffer.from(await f.downloads[0].blob.arrayBuffer()),expected);
 }
});
test('downloads retain exemptions and do not intercept mismatched or unlisted paths',async()=>{
 const f=await fixture();for(const [key,options] of [['TARGET/remote.json',{dataset:{appManagedDownload:'true'}}],['unlisted.pdb',{}],['TARGET/model.pdb.gz',{}],['TARGET/model.pdb',{href:'https://other.org/TARGET/model.pdb'}],['wrong.pdb',{dataset:{packedFile:'TARGET/model.pdb'}}]])assert(!f.click(key,options).event.defaultPrevented);assert.equal(f.downloads.length,0);
});
test('download fallback SHA works without WebCrypto and preserves default logical name',async()=>{
 const f=await fixture({noSubtle:true});f.click('TARGET/model.pdb.gz',{download:'',dataset:{packedFile:'TARGET/model.pdb'}});await settled(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'model.pdb');
});
test('integrity failures reject fetch and prevent corrupt raw external downloads',async()=>{
 const external={schema_version:1,files:{'TARGET/ensemble.pdb.gz':{...record(raw,remote+'assets/ensemble.pdb.gz'),sha256:'0'.repeat(64)}}};
 const f=await fixture({external});await assert.rejects(f.context.fetch('TARGET/ensemble.pdb.gz'),/hash verification/);f.click('TARGET/ensemble.pdb.gz');await settled(()=>!f.errorBox.hidden);assert.equal(f.downloads.length,0);
 const bad=await fixture({packed:{files:{'TARGET/model.pdb':{...record(saved),bytes:1}}}});await assert.rejects(bad.context.fetch('TARGET/model.pdb'),/size verification/);
});
test('manifest errors fail closed for canonical assets while unrelated fetch remains native',async()=>{
 for(const options of [{externalBadJSON:true},{externalStatus:404},{external:{schema_version:2,files:{}}},{external:{schema_version:1,files:{'../escape':record(raw,remote+'ok')}}}]){
  const f=await fixture({...options,invalid:true});await assert.rejects(f.context.AISPackedAssetsReady);await assert.rejects(f.context.fetch('TARGET/model.pdb'));assert.equal(f.calls.length,2);assert(f.click('TARGET/model.pdb').event.defaultPrevented);assert.equal(f.downloads.length,0);await f.context.fetch('https://elsewhere.org/data');assert.equal(f.calls.length,3);
 }
});
test('remote allowlist rejects wrong scheme/origin/base, credentials, query, fragment and traversal',async()=>{
 for(const url of ['http://benavt.github.io/sr215-cohort-atlas/a','https://evil.org/sr215-cohort-atlas/a','https://benavt.github.io/other/a',remote+'../escape',remote+'%2e%2e/escape',remote+'foo/%2fescape',remote+'file?token=x',remote+'file#x','https://user@benavt.github.io/sr215-cohort-atlas/a']){
  const f=await fixture({external:{schema_version:1,files:{'TARGET/raw':record(raw,url)}},invalid:true});await assert.rejects(f.context.AISPackedAssetsReady,/Invalid/);
 }
});
test('404 asset responses retain native status without attempted decompression',async()=>{
 const f=await fixture({response:()=>new Response('missing',{status:404})});const response=await f.context.fetch('TARGET/remote.json');assert.equal(response.status,404);assert.equal(await response.text(),'missing');
});
test('actual integrated inventory validates without reading scientific payloads',async()=>{
 const path=__dirname+'/../';
 const packed=JSON.parse(fs.readFileSync(path+'packed-assets.json','utf8')),external=JSON.parse(fs.readFileSync(path+'external-assets.json','utf8'));
 const f=await fixture({packed,external});assert.equal(f.calls.length,2);assert.equal(Object.keys(external.files).length,284);
});
