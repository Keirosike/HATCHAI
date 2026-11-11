import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {controllerCameraFetch} from '../src/controller-camera-events.js';
import {apiKeyVerifier} from '../src/device-api-keys.js';
const inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa',owner='00000000-0000-4000-8000-000000000002',sub='00000000-0000-4000-8000-000000000003';
test('offline camera relay: real authenticated RPCs, delayed events, lost ACK, durable dedup, ownership and revocation',async()=>{
 const readMigration=await readFile(new URL('../../supabase/migrations/202611110002_controller_camera_relay_REVIEW.sql',import.meta.url),'utf8');
 const db=new PGlite(),device='hatchai-inc01-controller',keyId='controller-sync-v1',key=Buffer.alloc(32,7).toString('base64url');
 const env={SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_BACKEND_KEY:'sb_secret_isolated_test_only',DEVICE_API_KEY_PEPPER:Buffer.alloc(32,9).toString('base64url'),CAMERA_EVENTS_ENABLED:'true',DEVICE_API_KEY_AUTH_ENABLED:'true',CAMERA_EVENT_LIMITER:{limit:async()=>({success:true})}};
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}');CREATE TABLE incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);INSERT INTO incubators VALUES('${inc}','${owner}','${device}');CREATE TABLE web_push_subscriptions(id uuid PRIMARY KEY,user_id uuid NOT NULL,incubator_id uuid NOT NULL,enabled boolean,endpoint text,p256dh text,auth text,updated_at timestamptz);INSERT INTO web_push_subscriptions VALUES('${sub}','${owner}','${inc}',true,'https://example.invalid/push','synthetic','synthetic',now());`);
 for(const name of ['migrations/202611100003_telemetry_REVIEW.sql','sprint4_registry_REVIEW.sql','migrations/202611100004_camera_outbox_REVIEW.sql','migrations/202611110001_device_api_keys_REVIEW.sql','migrations/202611110002_controller_camera_relay_REVIEW.sql','migrations/202611110002_controller_camera_relay_REVIEW.sql'])await db.exec(await readFile(new URL('../../supabase/'+name,import.meta.url),'utf8'));
 const verifier=await apiKeyVerifier(env,device,key);await db.query('UPDATE hatchai_sync_devices SET enabled=true,api_key_verifier=CASE WHEN role=\'controller\' THEN $1 ELSE NULL END',[verifier]);
 const fetcher=async(url,options)=>{const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(options.body);assert.equal(options.redirect,'manual');assert.equal(options.headers.apikey,env.SUPABASE_BACKEND_KEY);const fields=name==='hatchai_device_api_key_auth'?['p_device','p_key','p_verifier']:name==='hatchai_camera_relay_accept'?['p_controller','p_key','p_verifier','p_camera','p_event','p_nonce','p_hash','p_detected','p_received','p_source','p_confidence']:null;assert.ok(fields,'must use installed RPC');await db.exec('SET ROLE service_role');try{return Response.json((await db.query(`SELECT ${name}(${fields.map((_,i)=>'$'+(i+1)).join(',')}) result`,fields.map(f=>args[f]))).rows[0].result);}catch(e){return Response.json({error:'isolated SQL rejection'},{status:e.code==='42501'?403:e.code==='23505'?409:400});}finally{await db.exec('RESET ROLE');}};
 const now=Math.floor(Date.now()/1000);let nonce=0;
 const event={cameraId:'hatchai-inc01-cam01',eventId:'11111111-1111-4111-8111-111111111111',incarnation:7,sequence:1,detectedAt:now-10*86400,receivedAt:now-10*86400,timeSource:'controller-rtc',confidence:850,confirmed:true};
 const headers={'Content-Type':'application/json','X-HatchAI-Device':device,'X-HatchAI-Key-Id':keyId,'X-HatchAI-Api-Key':key};
 const send=(eventValue=event,h=headers,settings=env,extra={})=>controllerCameraFetch(new Request(extra.url||'https://worker/device/controller-camera-events',{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify({deviceId:device,keyId,issuedAt:now,nonce:String(++nonce).padStart(32,'n'),event:eventValue,...extra.body})}),settings,{fetcher,now:()=>now});
 let response=await send();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).duplicate,false);
 assert.equal((await (await send()).json()).duplicate,true,'lost acknowledgement retry');
 const replayNonce='r'.repeat(32);assert.equal((await send(event,headers,env,{body:{nonce:replayNonce}})).status,200);assert.equal((await send(event,headers,env,{body:{nonce:replayNonce}})).status,409,'replayed transport nonce rejected');
 await db.query('UPDATE incubators SET device_id=$1 WHERE id=$2',['another-controller',inc]);assert.equal((await send()).status,403,'registry controller cannot relay after ownership mapping changes');await db.query('UPDATE incubators SET device_id=$1 WHERE id=$2',[device,inc]);
 assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_camera_outbox')).rows[0].n,1,'one push even for delayed offline upload');
 const lower={...event,cameraId:'hatchai-inc01-cam02',eventId:'22222222-2222-4222-8222-222222222222',detectedAt:null,receivedAt:null,timeSource:'unknown'};assert.equal((await send(lower)).status,200);
 assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_camera_outbox')).rows[0].n,2);
 const records=(await db.query('SELECT hatchai_camera_read($1,$2) result',[owner,inc])).rows[0].result.captures;assert.equal(records.length,2);assert.ok(records.some(r=>r.capturedAt===null&&r.timeSource==='unknown'));assert.ok(records.some(r=>Math.floor(Date.parse(r.capturedAt)/1000)===event.detectedAt));
 await assert.rejects(()=>db.query('SELECT hatchai_camera_read($1,$2)',[sub,inc]));
 for(const h of [{},{Authorization:'Bearer '+key},{...headers,'X-HatchAI-Api-Key':Buffer.alloc(32,8).toString('base64url')},{...headers,'X-HatchAI-Key-Id':'wrong'}])assert.equal((await send(event,h)).status,401);
 for(const changed of [{confirmed:false},{confidence:499},{cameraId:'unknown'},{detectedAt:null},{sequence:0},{extra:true}])assert.equal((await send({...event,...changed})).status,400);
 assert.equal((await send({...event,confidence:900})).status,409,'same event ID cannot change payload');
 assert.equal((await send(event,headers,{...env,CAMERA_EVENTS_ENABLED:'false'})).status,503);
 assert.equal((await send(event,headers,{...env,DEVICE_API_KEY_AUTH_ENABLED:'false'})).status,503);
 assert.equal((await send(event,headers,env,{url:'http://worker/device/controller-camera-events'})).status,400);
 assert.equal((await send(event,{...headers,Origin:'https://example.invalid'})).status,405);
 await db.exec("UPDATE hatchai_camera_outbox SET state='accepted';UPDATE hatchai_camera_events SET received_at=now()-interval '31 days'");await db.query('SELECT hatchai_camera_cleanup()');assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_camera_events')).rows[0].n,0);assert.equal((await (await send()).json()).duplicate,true);assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_camera_outbox')).rows[0].n,0,'history cleanup must not recreate push');
 await db.exec('SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT * FROM hatchai_camera_relay_receipts'));await assert.rejects(()=>db.query('SELECT hatchai_camera_relay_accept(null,null,null,null,null,null,null,null,null,null,null)'));await db.exec('RESET ROLE');
 // New pending push is cancelled after controller revocation, with atomic SQL recheck.
 const fresh={...event,eventId:'33333333-3333-4333-8333-333333333333',sequence:2};assert.equal((await send(fresh)).status,200);
 await db.query('SELECT hatchai_device_api_key_revoke($1,$2)',[device,keyId]);assert.equal((await send()).status,401);assert.equal((await db.query('SELECT hatchai_camera_claim() result')).rows[0].result,null);
 assert.equal((await db.query("SELECT count(*)::int n FROM hatchai_camera_outbox WHERE state='cancelled'")).rows[0].n,1);
 await db.exec('ALTER TABLE hatchai_camera_relay_receipts ALTER COLUMN created_at DROP NOT NULL');await assert.rejects(()=>db.exec(readMigration),/Existing camera relay schema is incompatible/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});

