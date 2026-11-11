import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {authenticateApiKey,deviceApiKeyFetch} from '../src/device-api-keys.js';
import {telemetryFetch} from '../src/telemetry.js';

const key=Buffer.alloc(32,7).toString('base64url');
const pepper=Buffer.alloc(32,9).toString('base64url');
const device='hatchai-inc01-controller',keyId='controller-sync-v1';
const limiter={limit:async()=>({success:true})};

test('API key authentication is verifier-only and rejects malformed keys',async()=>{
  const env={DEVICE_API_KEY_PEPPER:pepper};let args;
  const repository=async(op,value)=>{assert.equal(op,'device_api_key_auth');args=value;return true;};
  const request=new Request('https://worker/device/telemetry',{headers:{'X-HatchAI-Device':device,'X-HatchAI-Key-Id':keyId,'X-HatchAI-Api-Key':key}});
  assert.deepEqual(await authenticateApiKey(request,env,repository),{deviceId:device,keyId});
  assert.notEqual(args.p_verifier,key);assert.equal(args.p_verifier.length,43);
  await assert.rejects(()=>authenticateApiKey(new Request(request.url,{headers:{'X-HatchAI-Device':device,'X-HatchAI-Key-Id':keyId,'X-HatchAI-Api-Key':'bad'}}),env,repository));
});

test('enrollment is gated, rate limited, bounded, and never returns the API key',async()=>{
  const base={DEVICE_API_KEY_PEPPER:pepper,DEVICE_API_KEY_ENROLLMENT_ENABLED:'true',TELEMETRY_RATE_LIMITER:limiter};
  let call;const repository=async(op,args)=>{call={op,args};return true;};
  const body={deviceId:device,keyId,setupToken:Buffer.alloc(32,3).toString('base64url'),apiKey:key};
  const response=await deviceApiKeyFetch(new Request('https://worker/device/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),base,{repository});
  assert.equal(response.status,200);assert.equal((await response.text()).includes(key),false);assert.equal(call.op,'device_api_key_enroll');assert.notEqual(call.args.p_verifier,key);
  const off=await deviceApiKeyFetch(new Request('https://worker/device/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{...base,DEVICE_API_KEY_ENROLLMENT_ENABLED:'false'},{repository});
  assert.equal(off.status,503);
});

test('owner enrollment token requires Supabase auth, allowed origin and ownership RPC',async()=>{
  const origin='https://myhatchai.web.app',env={DEVICE_API_KEY_PEPPER:pepper,DEVICE_API_KEY_ENROLLMENT_ENABLED:'true',TELEMETRY_RATE_LIMITER:limiter,ONLINE_ALLOWED_ORIGINS:origin,SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_key'};
  const fetcher=async()=>Response.json({id:'17275f94-f94b-4f89-b1c4-752edf099bc1',role:'authenticated'});let call;
  const repository=async(op,args)=>{call={op,args};return {id:'11111111-1111-4111-8111-111111111111',keyId,expiresAt:new Date(Date.now()+300000).toISOString()};};
  const request=new Request('https://worker/online/device-enrollment',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'},body:JSON.stringify({deviceId:device})});
  const response=await deviceApiKeyFetch(request,env,{fetcher,repository});const value=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(value.setupToken.length,43);assert.equal(call.op,'device_enrollment_start');assert.notEqual(call.args.p_token_hash,value.setupToken);
  const foreign=await deviceApiKeyFetch(new Request(request.url,{method:'POST',headers:{Origin:'https://evil.invalid',Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'},body:JSON.stringify({deviceId:device})}),env,{fetcher,repository});assert.equal(foreign.status,403);
});

test('telemetry API-key mode preserves validation, device binding and ingestion',async()=>{
  const now=Math.floor(Date.now()/1000),event='11111111-1111-4111-8111-111111111111';
  const sample={eventId:event,capturedAt:now,temperatureCenti:3720,humidityCenti:5500,sensorValid:true,sensorAgeMs:100,heaterOn:false,fanOn:null,lowerOn:false,upperOn:false,autoMode:true,upperCameraOnline:null,lowerCameraOnline:null,upperChick:null,lowerChick:null};
  const body={deviceId:device,keyId,issuedAt:now,nonce:'n'.repeat(32),sample};let ingested=0;
  const repository=async(op)=>{if(op==='device_api_key_auth')return true;if(op==='ingest'){ingested++;return {accepted:true,eventId:event};}throw Error(op);};
  const env={DEVICE_API_KEY_AUTH_ENABLED:'true',DEVICE_API_KEY_PEPPER:pepper,TELEMETRY_ENABLED:'true',TELEMETRY_RATE_LIMITER:limiter,ONLINE_ALLOWED_ORIGINS:''};
  const response=await telemetryFetch(new Request('https://worker/device/telemetry',{method:'POST',headers:{'Content-Type':'application/json','X-HatchAI-Device':device,'X-HatchAI-Key-Id':keyId,'X-HatchAI-Api-Key':key},body:JSON.stringify(body)}),env,{repository,now:()=>now});
  assert.equal(response.status,200);assert.equal(ingested,1);
});

test('PostgreSQL verifier functions enforce one-time enrollment and revocation',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('17275f94-f94b-4f89-b1c4-752edf099bc1');CREATE TABLE public.incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);INSERT INTO public.incubators VALUES('87ce3cf3-a455-4bc3-a7bb-049882d985fa','17275f94-f94b-4f89-b1c4-752edf099bc1','${device}');CREATE TABLE public.hatchai_sync_devices(device_id text PRIMARY KEY,incubator_id uuid NOT NULL REFERENCES public.incubators(id),key_id text NOT NULL,role text NOT NULL,position text,enabled boolean NOT NULL);INSERT INTO public.hatchai_sync_devices VALUES('${device}','87ce3cf3-a455-4bc3-a7bb-049882d985fa','${keyId}','controller',null,true);`);
    const migration=await readFile(new URL('../../supabase/migrations/202611110001_device_api_keys_REVIEW.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    const hash='a'.repeat(43),verifier='b'.repeat(43);
    await db.query('SELECT hatchai_device_enrollment_start($1,$2,$3,$4)',['17275f94-f94b-4f89-b1c4-752edf099bc1',device,keyId,hash]);
    assert.equal((await db.query('SELECT hatchai_device_api_key_enroll($1,$2,$3,$4) ok',[hash,device,keyId,verifier])).rows[0].ok,true);
    assert.equal((await db.query('SELECT hatchai_device_api_key_auth($1,$2,$3) ok',[device,keyId,verifier])).rows[0].ok,true);
    assert.equal((await db.query('SELECT hatchai_device_api_key_enroll($1,$2,$3,$4) ok',[hash,device,keyId,verifier])).rows[0].ok,true);
    await assert.rejects(()=>db.query('SELECT hatchai_device_api_key_enroll($1,$2,$3,$4)',[hash,device,keyId,'c'.repeat(43)]));
    assert.equal((await db.query('SELECT hatchai_device_api_key_revoke($1,$2) ok',[device,keyId])).rows[0].ok,true);
    assert.equal((await db.query('SELECT hatchai_device_api_key_auth($1,$2,$3) ok',[device,keyId,verifier])).rows[0].ok,false);
    await db.exec("UPDATE hatchai_device_enrollment_tokens SET created_at=now()-interval '3 days',used_at=now()-interval '2 days'");
    assert.equal((await db.query('SELECT hatchai_device_api_key_cleanup() n')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_device_enrollment_tokens')).rows[0].n,0);
    const metadata=(await db.query("SELECT p.proname,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hatchai_device_%' ORDER BY p.proname")).rows;
    assert.equal(metadata.length,5);assert.equal(metadata.every(row=>row.owner==='postgres'&&row.prosecdef&&row.proconfig?.includes('search_path=pg_catalog')),true);
    await db.exec(`UPDATE hatchai_sync_devices SET enabled=false`);
    assert.equal((await db.query('SELECT hatchai_device_api_key_auth($1,$2,$3) ok',[device,keyId,verifier])).rows[0].ok,false);
    await db.exec('SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT hatchai_device_api_key_auth($1,$2,$3)',[device,keyId,verifier]));
  }finally{await db.close();}
});

test('PostgreSQL redemption rechecks ownership and key id',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('17275f94-f94b-4f89-b1c4-752edf099bc1'),('27275f94-f94b-4f89-b1c4-752edf099bc1');CREATE TABLE public.incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);INSERT INTO public.incubators VALUES('87ce3cf3-a455-4bc3-a7bb-049882d985fa','17275f94-f94b-4f89-b1c4-752edf099bc1','${device}');CREATE TABLE public.hatchai_sync_devices(device_id text PRIMARY KEY,incubator_id uuid NOT NULL REFERENCES public.incubators(id),key_id text NOT NULL,role text NOT NULL,position text,enabled boolean NOT NULL);INSERT INTO public.hatchai_sync_devices VALUES('${device}','87ce3cf3-a455-4bc3-a7bb-049882d985fa','${keyId}','controller',null,true);`);
    await db.exec(await readFile(new URL('../../supabase/migrations/202611110001_device_api_keys_REVIEW.sql',import.meta.url),'utf8'));
    const hash='d'.repeat(43),verifier='e'.repeat(43);
    await assert.rejects(()=>db.query('SELECT hatchai_device_enrollment_start($1,$2,$3,$4)',['17275f94-f94b-4f89-b1c4-752edf099bc1',device,'wrong-v1',hash]));
    await db.query('SELECT hatchai_device_enrollment_start($1,$2,$3,$4)',['17275f94-f94b-4f89-b1c4-752edf099bc1',device,keyId,hash]);
    await db.exec(`UPDATE incubators SET owner_id='27275f94-f94b-4f89-b1c4-752edf099bc1'`);
    await assert.rejects(()=>db.query('SELECT hatchai_device_api_key_enroll($1,$2,$3,$4)',[hash,device,keyId,verifier]));
    assert.equal((await db.query('SELECT api_key_verifier IS NULL ok FROM hatchai_sync_devices')).rows[0].ok,true);
  }finally{await db.close();}
});

test('redemption locks ownership and cleanup remains scheduled after enrollment closes',async()=>{
  const migration=await readFile(new URL('../../supabase/migrations/202611110001_device_api_keys_REVIEW.sql',import.meta.url),'utf8');
  assert.match(migration,/FOR UPDATE OF registry FOR SHARE OF incubator/);
  const worker=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  assert.match(worker,/DEVICE_API_KEY_ENROLLMENT_ENABLED==='true'\|\|env\.DEVICE_API_KEY_AUTH_ENABLED==='true'/);
});
