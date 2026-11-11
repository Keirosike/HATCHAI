import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa';
const sql=await readFile(new URL('../../supabase/sprint4_registry_REVIEW.sql',import.meta.url),'utf8');
async function setup(device='hatchai-inc01-controller') {
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);`);
 await db.query('INSERT INTO incubators VALUES($1,$2,$3)',[inc,'00000000-0000-4000-8000-000000000001',device]);
 await db.exec(await readFile(new URL('../../supabase/migrations/202611100003_telemetry_REVIEW.sql',import.meta.url),'utf8'));
 return db;
}
test('registry draft inserts three distinct disabled identities and refuses replacement atomically',async()=>{
 const db=await setup();try {
 await db.exec(sql);
 const rows=(await db.query('SELECT device_id,key_id,role,position,enabled FROM hatchai_sync_devices ORDER BY device_id')).rows;
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.key_id)).size,3);
 assert.ok(rows.every(r=>r.enabled===false));
 assert.deepEqual(rows.filter(r=>r.role==='camera').map(r=>r.position).sort(),['lower','upper']);
 await assert.rejects(()=>db.exec(sql),/already populated/);await db.exec('ROLLBACK');
 assert.deepEqual((await db.query('SELECT device_id,key_id,role,position,enabled FROM hatchai_sync_devices ORDER BY device_id')).rows,rows);
 }finally{await db.close();}
});
test('registry draft refuses mapping drift and unprivileged execution without adding records',async()=>{
 for(const drift of [true,false]) {
 const db=await setup(drift?'unexpected-controller':'hatchai-inc01-controller');try{
 if(!drift)await db.exec('SET ROLE authenticated');
 await assert.rejects(()=>db.exec(sql));await db.exec('ROLLBACK; RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hatchai_sync_devices')).rows[0].n,0);
 }finally{await db.close();}}
});
