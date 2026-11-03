import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const logicalJSON=relative=>{const plain=new URL(relative,import.meta.url);return JSON.parse(fs.existsSync(plain)?fs.readFileSync(plain,'utf8'):gunzipSync(fs.readFileSync(new URL(relative+'.gz',import.meta.url))).toString('utf8'))};
const metadata=logicalJSON('../target-context.json');
test('target context records have an explicit revision and project write-up state',()=>{
 assert.equal(metadata.schema_version,1);assert.match(metadata.revision,/^\d{4}-\d{2}-\d{2}_/);assert.equal(Object.keys(metadata.targets).length,5);
 for(const entry of Object.values(metadata.targets))assert(['placeholder','draft','reviewed'].includes(entry.project_writeup.status));
});
for(const [target,entry]of Object.entries(metadata.targets))test(`${target} references belong to the frozen analysis construct`,()=>{
 const analysis=JSON.parse(gunzipSync(fs.readFileSync(new URL(`../${target}/primary.json.gz`,import.meta.url))));
 assert.equal(entry.provenance.analysis_sequence_sha256,analysis.provenance.sequence_sha256);
 assert.equal(entry.provenance.pdb_construct_sequence_sha256,analysis.provenance.sequence_sha256);
 const bmrb=entry.references.find(r=>r.kind==='bmrb'),pdb=entry.references.find(r=>r.kind==='pdb'),uniprot=entry.references.find(r=>r.kind==='uniprot');
 assert.equal(bmrb.id,target.split('_bmr')[1]);assert(pdb&&uniprot);
 assert(entry.provenance.source_urls.includes(`https://data.rcsb.org/rest/v1/core/entry/${pdb.id}`));
 assert(entry.provenance.source_urls.includes(`https://rest.uniprot.org/uniprotkb/${uniprot.id}.json`));
 assert.equal(new Set(entry.references.map(r=>r.url)).size,entry.references.length);
 for(const reference of entry.references){const url=new URL(reference.url);assert.equal(url.protocol,'https:');assert.equal(url.username,'');assert.equal(url.password,'');}
});
test('unresolved organism annotations do not become asserted biological context',()=>{
 for(const entry of Object.values(metadata.targets))if(entry.review_notes?.some(r=>r.field==='organism'&&r.status==='unresolved'))assert.equal(entry.organism,null);
});
