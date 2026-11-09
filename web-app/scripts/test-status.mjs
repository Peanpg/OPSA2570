import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
function moduleFrom(file, dependencies, env = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { exports, require: name => { if (!(name in dependencies)) throw Error('Unexpected import '+name); return dependencies[name]; }, crypto, process: { env }, Date, Set, Promise, URL, Request, Response, console }, { filename: file });
  return exports;
}
const ids = new Set(['00-065138']);
const contract = moduleFrom('lib/status-contract.ts', {});
assert.equal(contract.parseChange({id:'bad',completed:true,expectedRevision:null}, ids), null);
assert.equal(contract.parseChange({id:'00-065138',completed:'yes',expectedRevision:null}, ids), null);
assert.equal(contract.parseChange({id:'00-065138',completed:true}, ids), null);
assert.ok(contract.parseChange({id:'00-065138',completed:true,expectedRevision:null}, ids));
const state = new Map();
async function fakeSql(strings, ...v) {
  const q = strings.join('?').replace(/\s+/g,' ').trim();
  if(q.startsWith('CREATE TABLE')) { assert.ok(q.includes('namphong_load_campaign_2570')); return []; }
  if(q.startsWith('INSERT')) {
    if(state.has(v[0]))return [];
    const row={facility_id:v[0],completed:v[1],revision:v[2],updated_at:new Date().toISOString()};state.set(v[0],row);return [row];
  }
  if(q.startsWith('UPDATE')) {
    const current=state.get(v[2]);if(!current||current.revision!==v[3])return [];
    const row={...current,completed:v[0],revision:v[1],updated_at:new Date().toISOString()};state.set(v[2],row);return [row];
  }
  if(q.includes('WHERE facility_id'))return state.has(v[0])?[state.get(v[0])]:[];
  if(q.startsWith('SELECT'))return [...state.values()];
  throw Error('Unexpected SQL '+q);
}
const db = moduleFrom('db/status.ts', {'@neondatabase/serverless':{neon:()=>fakeSql}}, {DATABASE_URL:'mock-only'});
const input={id:'00-065138',completed:true,expectedRevision:null};
const simultaneous = await Promise.all([db.changeStatus(input), db.changeStatus(input)]);
assert.equal(simultaneous.filter(Boolean).length,1,'Only one first insert can win');
const saved=simultaneous.find(Boolean);
const toggles=await Promise.all([db.changeStatus({...input,completed:false,expectedRevision:saved.revision}),db.changeStatus({...input,completed:false,expectedRevision:saved.revision})]);
assert.equal(toggles.filter(Boolean).length,1,'Only one revision update can win');
assert.equal((await db.getStatus(input.id)).completed,0,'Undo retains a row/revision');
assert.equal(await db.changeStatus({...input,expectedRevision:saved.revision}),null,'Stale request cannot overwrite undo');
const route=moduleFrom('app/api/status/route.ts', {
  'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},
  '@/db/status':db, '@/lib/status-contract':contract,
  '@/app/transformers.json':JSON.parse(fs.readFileSync('app/transformers.json','utf8'))
}, {DATABASE_URL:'mock-only'});
const send=(body,origin='https://load.example')=>route.PUT(new Request('https://load.example/api/status',{method:'PUT',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await send(input,'https://wrong.example')).status,403);
assert.equal((await send({...input,id:'missing'})).status,400);
const alreadyFalse=await send({...input,completed:false});
assert.equal(alreadyFalse.status,200,'Same desired result is idempotent');
assert.equal((await send(input)).status,409,'Opposite intent with stale revision conflicts');
const latest=await db.getStatus(input.id);
const both=await Promise.all([send({...input,expectedRevision:latest.revision}),send({...input,expectedRevision:latest.revision})]);
assert.deepEqual(both.map(r=>r.status),[200,200],'Two users checking same point succeed safely');
const result=await (await route.GET()).json();
assert.equal(result.statuses.length,1);
assert.equal(result.statuses[0].completed,1);
assert.equal(new Set(JSON.parse(fs.readFileSync('app/transformers.json','utf8')).map(p=>p.pea)).size,43);
console.log('PASS: validation, same-origin checks, 43 unique points, concurrent insert/update, undo revision retention, stale-write protection, idempotent double checks, GET statuses. Database mocked; not a live Neon test.');
