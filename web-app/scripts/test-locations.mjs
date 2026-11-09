import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
function moduleFrom(file,dependencies){
  const exports={};
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  vm.runInNewContext(js,{exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected import '+name);return dependencies[name];},Date,Set,Promise,URL,Request,Response,process:{env:{DATABASE_URL:'mock-only'}}});
  return exports;
}
const contract=moduleFrom('lib/location-contract.ts',{});
const original={id:crypto.randomUUID(),token:crypto.randomUUID(),name:' ทีม 1 ',lat:16.70,long:102.85,accuracy:8,capturedAt:Date.now()};
assert.equal(contract.parseLocation(original).name,'ทีม 1');
for(const patch of [{lat:91},{long:Infinity},{accuracy:-1},{name:''},{name:'x'.repeat(81)},{name:'bad\nname'},{capturedAt:Date.now()-46000},{capturedAt:Date.now()+20000},{token:'invalid'}])assert.equal(contract.parseLocation({...original,...patch}),null);
let clock=Date.now();const rows=new Map();
async function sql(strings,...v){
  const q=strings.join('?').replace(/\s+/g,' ').trim();
  if(q.startsWith('CREATE TABLE')){assert.ok(q.includes('namphong_load_team_locations'));return [];}
  if(q.startsWith('INSERT')){
    const old=rows.get(v[0]);if(old&&(old.token_hash!==v[1]||old.capturedAt>v[6]))return [];
    rows.set(v[0],{id:v[0],token_hash:v[1],name:v[2],lat:v[3],long:v[4],accuracy:v[5],capturedAt:v[6],updatedAt:clock});return [{id:v[0]}];
  }
  if(q.startsWith('DELETE')){assert.ok(q.includes('90 seconds'));for(const [id,p] of rows)if(clock-p.updatedAt>=90000||clock-p.capturedAt>=90000)rows.delete(id);return [];}
  if(q.startsWith('SELECT'))return [...rows.values()].map(p=>({id:p.id,name:p.name,lat:p.lat,long:p.long,accuracy:p.accuracy,captured_at:new Date(p.capturedAt).toISOString(),updated_at:new Date(p.updatedAt).toISOString()}));
  throw Error('Unexpected SQL '+q);
}
const db=moduleFrom('db/locations.ts',{'node:crypto':crypto,'@neondatabase/serverless':{neon:()=>sql}});
const p=contract.parseLocation(original);
assert.equal(await db.saveLocation(p),true);
assert.notEqual(rows.get(p.id).token_hash,p.token,'Raw token is never stored');
assert.equal(await db.saveLocation({...p,token:crypto.randomUUID(),capturedAt:p.capturedAt+1}),false,'A different token cannot move another team');
assert.equal(await db.saveLocation({...p,capturedAt:p.capturedAt-1}),false,'Late old GPS cannot overwrite newer coordinates');
assert.equal(await db.saveLocation({...p,name:'ทีมหนึ่ง',lat:16.71,capturedAt:p.capturedAt+1}),true);
const publicRows=await db.listLocations();assert.equal(publicRows.length,1);assert.equal(publicRows[0].lat,16.71);assert.ok(!('token_hash' in publicRows[0]));
clock+=90001;assert.equal((await db.listLocations()).length,0,'Position expires after 90 seconds');assert.equal(rows.size,0,'Expired coordinates are purged');
const route=moduleFrom('app/api/locations/route.ts',{'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},'@/db/locations':db,'@/lib/location-contract':contract});
const send=(body,origin='https://load.example')=>route.PUT(new Request('https://load.example/api/locations',{method:'PUT',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await send(original,'https://other.example')).status,403);
assert.equal((await send({...original,lat:999})).status,400);
clock=Date.now();assert.equal((await send({...original,capturedAt:clock})).status,200);
assert.equal((await send({...original,token:crypto.randomUUID(),capturedAt:clock+1})).status,409);
const response=await route.GET();const result=await response.json();assert.equal(result.positions.length,1);assert.ok(result.serverTime);assert.match(response.headers.get('Cache-Control'),/no-store/);
console.log('PASS: GPS validation, source freshness, token ownership/hash, out-of-order protection, 90-second expiry, same-origin API and no-store responses. Database mocked; no real GPS or production writes.');
