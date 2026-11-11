import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {telemetryFetch} from '../src/telemetry.js';
import {apiKeyVerifier} from '../src/device-api-keys.js';
import {b64,hmacKey,signingMessage} from '../src/security.js';

// Synthetic credentials, isolated PostgreSQL, and a fake PostgREST transport.
// Exercise the production repository adapter rather than injecting a repository.
test('real telemetry RPC adapter matches migrations and rejects unauthenticated uploads in both modes',async()=>{
  const db=new PGlite();
  const device='hatchai-inc01-controller',keyId='controller-sync-v1';
  const owner='17275f94-f94b-4f89-b1c4-752edf099bc1';
  const incubator='87ce3cf3-a455-4bc3-a7bb-049882d985fa';
  const key=Buffer.alloc(32,7).toString('base64url');
  const env={SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_BACKEND_KEY:'sb_secret_isolated_test_only',
    DEVICE_API_KEY_PEPPER:Buffer.alloc(32,9).toString('base64url'),DEVICE_API_KEY_AUTH_ENABLED:'true',
    TELEMETRY_ENABLED:'true',TELEMETRY_RATE_LIMITER:{limit:async()=>({success:true})},
    TELEMETRY_DEVICE_KEYS:JSON.stringify({[device]:{[keyId]:key}})};
  try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${owner}');
      CREATE TABLE public.incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL,device_id text NOT NULL);
      INSERT INTO public.incubators VALUES('${incubator}','${owner}','${device}');`);
    const sql=async path=>readFile(new URL('../../supabase/'+path,import.meta.url),'utf8');
    await db.exec(await sql('migrations/202611100003_telemetry_REVIEW.sql'));
    await db.exec(await sql('sprint4_registry_REVIEW.sql'));
    const migration=await sql('migrations/202611110001_device_api_keys_REVIEW.sql');
    await db.exec(migration);await db.exec(migration);
    await assert.rejects(()=>db.query('SELECT hatchai_device_enrollment_start($1,$2,$3,$4)',
      ['27275f94-f94b-4f89-b1c4-752edf099bc1',device,keyId,'a'.repeat(43)]));
    await db.query('SELECT hatchai_device_enrollment_start($1,$2,$3,$4)',[owner,device,keyId,'a'.repeat(43)]);
    const verifier=await apiKeyVerifier(env,device,key);
    assert.equal((await db.query('SELECT hatchai_device_api_key_enroll($1,$2,$3,$4) ok',['a'.repeat(43),device,keyId,verifier])).rows[0].ok,true);
    // The reviewed registry intentionally starts disabled; enrollment does not activate it.
    assert.equal((await db.query('SELECT hatchai_device_api_key_auth($1,$2,$3) ok',[device,keyId,verifier])).rows[0].ok,false);
    await db.exec(`UPDATE hatchai_sync_devices SET enabled=true WHERE role='controller'`);
    const calls=[];
    const fetcher=async(url,options)=>{
      const name=new URL(url).pathname.split('/').pop();calls.push(name);
      assert.equal(options.redirect,'manual');assert.equal(options.headers.apikey,env.SUPABASE_BACKEND_KEY);
      const args=JSON.parse(options.body);
      let query,values;
      if(name==='hatchai_device_api_key_auth'){
        query='SELECT hatchai_device_api_key_auth($1,$2,$3) result';values=[args.p_device,args.p_key,args.p_verifier];
      }else if(name==='hatchai_sync_ingest'){
        query='SELECT hatchai_sync_ingest($1,$2,$3,$4,$5,$6,$7) result';
        values=[args.p_device,args.p_key,args.p_event,args.p_nonce,args.p_hash,args.p_captured,args.p_payload];
      }else return Response.json({error:'RPC not installed by migration'},{status:404});
      await db.exec('SET ROLE service_role');
      try{return Response.json((await db.query(query,values)).rows[0].result);}
      finally{await db.exec('RESET ROLE');}
    };
    const now=Math.floor(Date.now()/1000);
    const sample={eventId:'11111111-1111-4111-8111-111111111111',capturedAt:now,temperatureCenti:3750,humidityCenti:5500,
      sensorValid:true,sensorAgeMs:100,heaterOn:true,fanOn:null,lowerOn:false,upperOn:false,autoMode:true,
      upperCameraOnline:null,lowerCameraOnline:null,upperChick:null,lowerChick:null};
    const body={deviceId:device,keyId,issuedAt:now,nonce:'n'.repeat(32),sample};
    const headers={'Content-Type':'application/json','X-HatchAI-Device':device,'X-HatchAI-Key-Id':keyId,'X-HatchAI-Api-Key':key};
    const send=(value=body,h=headers,settings=env)=>telemetryFetch(new Request('https://worker/device/telemetry',
      {method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(value)}),settings,{fetcher,now:()=>now});
    assert.equal((await send()).status,200,'valid API-key upload must resolve the SQL RPC installed by the migration');
    assert.deepEqual(calls,['hatchai_device_api_key_auth','hatchai_sync_ingest']);
    for(const h of [{},{Authorization:'Bearer '+key},{...headers,'X-HatchAI-Api-Key':'bad'},
      {...headers,'X-HatchAI-Api-Key':Buffer.alloc(32,8).toString('base64url')},
      {...headers,'X-HatchAI-Device':'hatchai-inc01-cam01'},{...headers,'X-HatchAI-Key-Id':'wrong-v1'}]){
      assert.equal((await send(body,h)).status,401);
    }
    assert.equal((await send({...body,keyId:'wrong-v1'})).status,401);
    assert.equal((await send({...body,signature:'a'.repeat(43)})).status,401);
    assert.equal((await send(body,headers,{...env,TELEMETRY_ENABLED:'false'})).status,503);
    assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_telemetry')).rows[0].n,1);
    await db.query('SELECT hatchai_device_api_key_revoke($1,$2)',[device,keyId]);
    assert.equal((await send()).status,401,'revoked API key must not ingest');
    const fallback={...env,DEVICE_API_KEY_AUTH_ENABLED:'false'};
    assert.equal((await send(body,{},fallback)).status,401,'API key mode disabled does not permit unsigned uploads');
    const signed={...body,nonce:'m'.repeat(32),sample:{...sample,eventId:'22222222-2222-4222-8222-222222222222'}};
    signed.signature=b64(await crypto.subtle.sign('HMAC',await hmacKey(key),await signingMessage('/device/telemetry',signed)));
    assert.equal((await send({...signed,signature:'a'.repeat(43)},{},fallback)).status,401);
    assert.equal((await send(signed,{},fallback)).status,200,'existing independent HMAC fallback remains available');
    await db.exec(`UPDATE hatchai_sync_devices SET enabled=false WHERE role='controller'`);
    assert.notEqual((await send(signed,{},fallback)).status,200);
    assert.equal((await db.query('SELECT count(*)::int n FROM hatchai_telemetry')).rows[0].n,2);
  }finally{await db.close();}
});
