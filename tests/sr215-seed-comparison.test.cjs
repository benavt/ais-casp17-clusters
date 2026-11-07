'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const api=require('../seed-comparison.js');
const dir=path.join(__dirname,'../sr215-no-afcluster');
const catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));
const bytes=fs.readFileSync(path.join(dir,'seed-comparison.json'));
const input={...JSON.parse(bytes),_source_sha:crypto.createHash('sha256').update(bytes).digest('hex')};

test('the public score payload binds all 72 audited seed/method pairs',()=>{
 const scores=api.validate(input,catalog.comparison.sha256);
 assert.equal(scores.size,72);
 for(const range of catalog.residue_ranges)for(const view of range.views)for(const pool of ['whole','TM80']){
  const rows=api.compare(scores,range.id,view.id,pool,'RPF_DP');
  assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>r.seed),[202611710,202611710,202611711,202611711,202611712,202611712]);
  assert.deepEqual([...new Set(rows.map(r=>r.method))],['MCMC50','Gumbel50']);
 }
 const row=api.compare(scores,'all','primary','whole','RPF_DP')[0];
 assert.equal(row.original,.56);assert.equal(row.filtered,.75);assert.equal(row.change.toFixed(2),'0.19');
});

test('the seed table rejects a changed digest, missing cell or invalid metric',()=>{
 assert.throws(()=>api.validate(input,'wrong'),/audit binding/);
 const rows=input.rows.slice();rows[0]=rows[1];
 assert.throws(()=>api.validate({...input,rows},input._source_sha),/missing or invalid/);
 const map=api.validate(input,input._source_sha);
 assert.throws(()=>api.compare(map,'all','primary','whole','invented'),/Unknown/);
});
