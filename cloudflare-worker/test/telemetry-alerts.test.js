import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {dispatchAlert} from '../src/telemetry-alerts.js';
const inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa',user='00000000-0000-4000-8000-000000000001';
async function setup(){const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${user}');CREATE TABLE incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);INSERT INTO incubators VALUES('${inc}','${user}','hatchai-inc01-controller');CREATE TABLE web_push_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,incubator_id uuid NOT NULL,endpoint text NOT NULL,p256dh text NOT NULL,auth text NOT NULL,enabled boolean NOT NULL DEFAULT true);INSERT INTO web_push_subscriptions(user_id,incubator_id,endpoint,p256dh,auth) VALUES('${user}','${inc}','https://synthetic.invalid/device1','mock','mock'),('${user}','${inc}','https://synthetic.invalid/device2','mock','mock');`);
 for(const name of ['202611100003_telemetry_REVIEW.sql','202611100006_telemetry_rollups_REVIEW.sql','202611100007_telemetry_alerts_REVIEW.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query("INSERT INTO hatchai_sync_devices VALUES('hatchai-inc01-controller',$1,'v1','controller',null,true)",[inc]);
 await db.query("INSERT INTO hatchai_alert_rules VALUES($1,'temperature_high',true,3850,3800,0,0)",[inc]);
 await db.query("INSERT INTO hatchai_telemetry_latest VALUES($1,'hatchai-inc01-controller',gen_random_uuid(),now(),now(),$2)",[inc,{sensorValid:true,temperatureCenti:3860,humidityCenti:5500,sensorAgeMs:0}]);return db;}
const observe=db=>db.query("SELECT hatchai_alert_observe('hatchai-inc01-controller') AS n");
test('telemetry alert transitions deduplicate, hysteresis resolves, all owned devices queue, revoked ownership cancels',async()=>{
 const db=await setup();try{
 assert.equal((await observe(db)).rows[0].n,1);assert.equal((await observe(db)).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_alert_outbox')).rows[0].n,2);
 await db.exec("UPDATE hatchai_telemetry_latest SET payload=jsonb_set(payload,'{temperatureCenti}','3820')");assert.equal((await observe(db)).rows[0].n,0);
 await db.exec("UPDATE hatchai_telemetry_latest SET payload=jsonb_set(payload,'{temperatureCenti}','3790')");assert.equal((await observe(db)).rows[0].n,1);
 const job=(await db.query('SELECT hatchai_alert_claim() AS r')).rows[0].r;assert.ok(job.leaseId);assert.equal(job.event.kind,'temperature_high');
 assert.equal((await db.query('SELECT hatchai_alert_finish($1,$2) AS ok',[job.leaseId,'accepted'])).rows[0].ok,true);
 assert.equal((await db.query('SELECT hatchai_alert_finish($1,$2) AS ok',[job.leaseId,'accepted'])).rows[0].ok,false);
 await db.exec("UPDATE incubators SET owner_id='00000000-0000-4000-8000-000000000099'");assert.equal((await db.query('SELECT hatchai_alert_claim() AS r')).rows[0].r,null);
 await db.exec('SET ROLE authenticated');await assert.rejects(()=>observe(db));await assert.rejects(()=>db.query('SELECT * FROM hatchai_alert_events'));await db.exec('RESET ROLE');
 }finally{await db.close();}
});
test('freshness, sensor failures, offline, debounce and recovery are independent of history averages',async()=>{
 const db=await setup();try{
 await db.exec("UPDATE hatchai_alert_rules SET debounce_seconds=60;UPDATE hatchai_telemetry_latest SET captured_at=now()-interval '2 minutes',received_at=now()-interval '2 minutes'");assert.equal((await observe(db)).rows[0].n,0);
 await db.query("INSERT INTO hatchai_alert_rules VALUES($1,'controller_offline',true,null,null,0,0),($1,'sensor_failure',true,null,null,0,0)",[inc]);assert.equal((await observe(db)).rows[0].n,1);
 await db.exec("UPDATE hatchai_telemetry_latest SET captured_at=now(),received_at=now(),payload=jsonb_set(payload,'{sensorValid}','false')");assert.equal((await observe(db)).rows[0].n,2);
 await db.exec("UPDATE hatchai_telemetry_latest SET payload=jsonb_set(payload,'{sensorValid}','true')");await observe(db);
 await db.exec("UPDATE hatchai_alert_state SET since_at=now()-interval '61 seconds' WHERE kind='temperature_high'");assert.equal((await observe(db)).rows[0].n,1);
 await db.exec("UPDATE hatchai_sync_devices SET enabled=false");assert.equal((await observe(db)).rows[0].n,0);
 }finally{await db.close();}
});
test('alert dispatcher gates fail closed and preserves long Retry-After without waiting',async()=>{
 let calls=0;assert.deepEqual(await dispatchAlert({}, {repository:async()=>{calls++;}}),{processed:false});assert.equal(calls,0);
 const env={TELEMETRY_ENABLED:'true',TELEMETRY_ROLLUPS_ENABLED:'true',TELEMETRY_ALERTS_ENABLED:'true',NATIVE_PUSH_DELIVERY_ENABLED:'true'};let finish;
 const start=Date.now();const r=await dispatchAlert(env,{repository:async(op,args)=>op==='claim'?{leaseId:'synthetic',attempt:1,subscription:{endpoint:'mock',keys:{p256dh:'mock',auth:'mock'}},event:{}}:(finish=args,true),send:async()=>({outcome:'retryable',retryAfterMs:86400000})});assert.equal(r.outcome,'retryable');assert.ok(Date.parse(finish.p_retry)>=start+86400000);
});
