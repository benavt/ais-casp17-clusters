'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{gzipSync}=require('node:zlib'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../packed_assets.js'),'utf8'),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({subtle=true}={}){
 const saved='MODEL        1\nREMARK SAVED MODEL\nENDMDL\nEND\n',key='TARGET/cluster-ensembles/Cluster_1.pdb',blobs=new Map(),requests=[],downloads=[],handlers=[];
 class LocalURL extends URL{static createObjectURL(blob){const key='blob:checked-'+blobs.size;blobs.set(key,blob);return key}static revokeObjectURL(){}}
 const index={files:{[key]:{sha256:createHash('sha256').update(saved).digest('hex'),bytes:Buffer.byteLength(saved),content_type:'text/plain'}}};
 const context={URL:LocalURL,Request,Response,Headers,Blob,DecompressionStream,crypto:subtle?webcrypto:{},AISExplorerTMStates:require('../tm_states.js'),console,location:{href:'https://example.org/atlas/#TARGET?view=density'},setTimeout(){},document:{currentScript:{src:'https://example.org/atlas/packed_assets.js'},addEventListener(name,fn){handlers.push(fn)},getElementById(){return null},createElement(){return{click(){downloads.push({href:this.href,name:this.download,blob:blobs.get(this.href)})}}}},async fetch(input){const url=String(input.url||input);requests.push(url);if(url.endsWith('packed-assets.json'))return new Response(JSON.stringify(index));assert(url.endsWith(key+'.gz'));return new Response(gzipSync(saved))}};
 context.window=context;vm.runInNewContext(source,context);await tick();
 function click({packedFile=key,href='https://example.org/atlas/'+key+'.gz',download='Cluster_1.pdb',appManagedDownload,onclick}={}){const anchor={href,download,dataset:{...(packedFile?{packedFile}:{}),...(appManagedDownload===undefined?{}:{appManagedDownload})},textContent:'PDB',setAttribute(){},removeAttribute(){}},event={target:{closest:()=>anchor},preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true}};handlers[0](event);if(!event.stopped)onclick?.(event);return event}
 return {saved,key,downloads,requests,click};
}
test('physical cluster links stay copyable while ordinary clicks verify and deliver original uncompressed bytes',async()=>{
 const f=await fixture(),event=f.click();assert(event.defaultPrevented&&event.stopped);
 for(const deadline=Date.now()+5000;Date.now()<deadline&&!f.downloads.length;)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].name,'Cluster_1.pdb');assert.equal(await f.downloads[0].blob.text(),f.saved);assert.equal(f.requests.filter(url=>url.endsWith(f.key+'.gz')).length,1);
});
test('download capture preserves external links, mismatched artifact paths and dedicated state-download handlers',async()=>{
 const f=await fixture();for(const options of [{href:'https://elsewhere.org/'+f.key+'.gz'},{href:'https://example.org/atlas/different.pdb.gz'},{packedFile:null}])assert(!f.click(options).defaultPrevented);await tick();assert.equal(f.downloads.length,0);assert.equal(f.requests.length,1);
});

test('private previews verify hashes even without browser WebCrypto',async()=>{
 const f=await fixture({subtle:false});f.click();for(const deadline=Date.now()+5000;Date.now()<deadline&&!f.downloads.length;)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.downloads.length,1);assert.equal(await f.downloads[0].blob.text(),f.saved);
});

test('explicit app-managed native links reach their busy/route-aware handler without a second generic download',async()=>{
 const f=await fixture();let customCalls=0;const event=f.click({appManagedDownload:'true',onclick(e){customCalls++;e.preventDefault()}});await tick();
 assert.equal(customCalls,1);assert(event.defaultPrevented);assert(!event.stopped);assert.equal(f.downloads.length,0);assert.equal(f.requests.length,1);
 // A false or unrelated marker does not exempt an existing registered link.
 const ordinary=f.click({appManagedDownload:'false'});assert(ordinary.stopped&&ordinary.defaultPrevented);
 for(const deadline=Date.now()+5000;Date.now()<deadline&&!f.downloads.length;)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.downloads.length,1);assert.equal(await f.downloads[0].blob.text(),f.saved);
});
