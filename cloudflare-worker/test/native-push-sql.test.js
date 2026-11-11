import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const user='17275f94-f94b-4f89-b1c4-752edf099bc1',other='00000000-0000-4000-8000-000000000002',inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa';
test('actual PostgreSQL RPC grants, ownership, multi-device uniqueness, refresh races and retention',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id));
      INSERT INTO auth.users VALUES('${user}'),('${other}');INSERT INTO incubators VALUES('${inc}','${user}');`);
    // Load the real existing-table draft by discovery; no production database.
    const {readdir}=await import('node:fs/promises');const dir=new URL('../../supabase/migrations/',import.meta.url);
    const file=(await readdir(dir)).find(x=>x.includes('push')&&x!=='202611100001_native_push_rpc_REVIEW.sql');
    assert.ok(file,'existing subscription schema required');await db.exec(await readFile(new URL(file,dir),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/202611100001_native_push_rpc_REVIEW.sql',import.meta.url),'utf8'));
    const endpoint='https://fcm.googleapis.com/fcm/send/synthetic-db-test';
    const add=(u=user,e=endpoint)=>db.query('SELECT hatchai_push_subscribe($1,$2,$3,$4,$5,$6)',[u,inc,e,'B'.repeat(87),'C'.repeat(22),'Android']);
    await db.exec('SET ROLE authenticated');await assert.rejects(()=>add());await assert.rejects(()=>db.query('INSERT INTO web_push_subscriptions(user_id,incubator_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)',[user,inc,endpoint,'B'.repeat(87),'C'.repeat(22)]));await db.exec('RESET ROLE');
    await add();await Promise.all([add(),add(),add(user,endpoint+'-phone2')]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM web_push_subscriptions')).rows[0].n,2);
    await assert.rejects(()=>add(other));
    await db.query('UPDATE incubators SET owner_id=$1 WHERE id=$2',[other,inc]);await assert.rejects(()=>add(other));await db.query('UPDATE incubators SET owner_id=$1 WHERE id=$2',[user,inc]);
    const status=await db.query('SELECT hatchai_push_status($1,$2) AS result',[user,inc]);assert.equal(status.rows[0].result.subscriptions.length,2);assert.match(status.rows[0].result.subscriptions[0].endpointHash,/^[0-9a-f]{64}$/);
    await db.query('SELECT hatchai_push_expire($1,$2,$3,$4,$5)',[user,inc,endpoint,'D'.repeat(87),'C'.repeat(22)]);
    assert.equal((await db.query('SELECT enabled FROM web_push_subscriptions WHERE endpoint=$1',[endpoint])).rows[0].enabled,true);
    await db.query('SELECT hatchai_push_unsubscribe($1,$2,$3)',[user,inc,endpoint]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM web_push_subscriptions WHERE enabled')).rows[0].n,1);
    await db.exec("UPDATE web_push_subscriptions SET updated_at=now()-interval '31 days'");
    await db.query('SELECT hatchai_push_cleanup()');assert.equal((await db.query('SELECT count(*)::int AS n FROM web_push_subscriptions')).rows[0].n,1);
    await db.exec('SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT hatchai_push_cleanup()'));await db.exec('RESET ROLE');
    await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT hatchai_push_status($1,$2) AS result',[user,inc])).rows[0].result.confirmed,true);await db.exec('RESET ROLE');
    for(let n=0;n<19;n++)await add(user,endpoint+'-quota-'+n);
    await assert.rejects(()=>add(user,endpoint+'-over-quota'));
  }finally{await db.close();}
});
