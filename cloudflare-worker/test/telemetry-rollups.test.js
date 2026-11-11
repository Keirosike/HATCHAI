import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa',user='00000000-0000-4000-8000-000000000001';
async function setup(){const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);INSERT INTO incubators VALUES('${inc}','${user}','hatchai-inc01-controller');`);
 for(const name of ['202611100003_telemetry_REVIEW.sql','202611100006_telemetry_rollups_REVIEW.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query("INSERT INTO hatchai_sync_devices VALUES('hatchai-inc01-controller',$1,'v1','controller',null,true)",[inc]);return db;}
function sample(at,t=3700){return {eventId:crypto.randomUUID(),capturedAt:at,temperatureCenti:t,humidityCenti:5500,sensorValid:true,sensorAgeMs:0,heaterOn:true,fanOn:null,lowerOn:false,upperOn:false,autoMode:true,upperCameraOnline:null,lowerCameraOnline:null,upperChick:null,lowerChick:null};}
async function add(db,p,hash='H'.repeat(43),nonce=crypto.randomUUID().replaceAll('-','').padEnd(43,'n')){return (await db.query('SELECT hatchai_sync_ingest($1,$2,$3,$4,$5,$6,$7) AS r',['hatchai-inc01-controller','v1',p.eventId,nonce,hash,new Date(p.capturedAt*1000).toISOString(),p])).rows[0].r;}
test('rollups atomically deduplicate events and slots, preserve latest and old raw data, and isolate owners',async()=>{
 const db=await setup();try{
 const now=Math.floor(Date.now()/1000),at=now-now%5;const a=sample(at,3600),b=sample(at-5,3800);
 assert.equal((await add(db,a)).aggregated,true);assert.equal((await add(db,a)).duplicate,true);
 assert.equal((await add(db,sample(at,7900),'J'.repeat(43))).aggregated,false);
 await Promise.all([add(db,b),add(db,sample(at-10,3700))]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hatchai_telemetry')).rows[0].n,0);
 const sums=(await db.query('SELECT sum(valid_count)::int AS n,sum(temperature_sum)::int AS t FROM hatchai_telemetry_windows')).rows[0];assert.equal(sums.n,3);assert.equal(sums.t,11100);
 const current=(await db.query('SELECT hatchai_sync_read_v2($1,$2) AS r',[user,inc])).rows[0].r;assert.equal(current.latest.sample.temperatureCenti,3600);assert.equal(current.connection,'online');
 await assert.rejects(()=>db.query('SELECT hatchai_sync_read_v2($1,$2)',['00000000-0000-4000-8000-000000000099',inc]));
 await assert.rejects(()=>add(db,{...a,heaterOn:false},'Z'.repeat(43)));
 await db.exec('SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT * FROM hatchai_telemetry_latest'));await assert.rejects(()=>db.query('SELECT hatchai_sync_finalize()'));await db.exec('RESET ROLE');
 }finally{await db.close();}
});
test('UTC boundary, bounded late policy, finalized immutability and invalid readings',async()=>{
 const db=await setup();try{
 const now=Math.floor(Date.now()/1000),start=now-now%1800;
 await add(db,sample(start));await add(db,sample(start-1));
 const counts=await db.query('SELECT interval_start,valid_count FROM hatchai_telemetry_windows ORDER BY interval_start');assert.ok(counts.rows.length>=1);
 const bad=sample(now);Object.assign(bad,{sensorValid:false,temperatureCenti:null,humidityCenti:null,sensorAgeMs:null});await add(db,bad);
 const late=sample(start-3600);assert.equal((await add(db,late)).aggregated,false);
 await db.exec('UPDATE hatchai_telemetry_windows SET finalized_at=now()');
 const before=(await db.query('SELECT sum(valid_count)::int AS n FROM hatchai_telemetry_windows')).rows[0].n;
 await add(db,sample(start+5));assert.equal((await db.query('SELECT sum(valid_count)::int AS n FROM hatchai_telemetry_windows')).rows[0].n,before);
 const r=(await db.query('SELECT hatchai_sync_read_v2($1,$2) AS r',[user,inc])).rows[0].r;assert.equal(r.historyKind,'utc-30-minute');assert.ok(r.history.every(p=>p.completeness==='partial'));
 }finally{await db.close();}
});
test('finalization reports weighted averages and completeness, retains legacy rows, and cleans only expired receipts',async()=>{
 const db=await setup();try{
 const now=Math.floor(Date.now()/1000),start=now-now%1800-3600;
 await db.query("INSERT INTO hatchai_telemetry_windows(incubator_id,interval_start,interval_end,temperature_sum,humidity_sum,temperature_min,temperature_max,humidity_min,humidity_max,valid_count) VALUES($1,to_timestamp($2),to_timestamp($2)+interval '30 minutes',1332000,1980000,3600,3800,5000,6000,360)",[inc,start]);
 assert.equal((await db.query('SELECT hatchai_sync_finalize() AS n')).rows[0].n,1);assert.equal((await db.query('SELECT hatchai_sync_finalize() AS n')).rows[0].n,0);
 const result=(await db.query('SELECT hatchai_sync_read_v2($1,$2) AS r',[user,inc])).rows[0].r;
 assert.equal(result.history[0].averageTemperatureCenti,3700);assert.equal(result.history[0].averageHumidityCenti,5500);assert.equal(result.history[0].completeness,'complete');
 const old=sample(now-86400*10);await db.query("INSERT INTO hatchai_telemetry(device_id,event_id,incubator_id,captured_at,payload_hash,payload) VALUES('hatchai-inc01-controller',$1,$2,to_timestamp($3),$4,$5)",[old.eventId,inc,old.capturedAt,'X'.repeat(43),old]);
 await db.query("INSERT INTO hatchai_sync_receipts VALUES('hatchai-inc01-controller',gen_random_uuid(),$1,$2,now()-interval '9 days',now())",['X'.repeat(43),inc]);
 await db.query('SELECT hatchai_sync_cleanup_v2()');assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_sync_receipts')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_telemetry')).rows[0].n,1);
 }finally{await db.close();}
});
