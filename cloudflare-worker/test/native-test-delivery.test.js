import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import * as webpush from 'web-push';
import ece from 'http_ece';
import {sendNativeTest,sendNativePush} from '../src/native-push-delivery.js';
import {nativePushFetch} from '../src/native-push.js';
const user='00000000-0000-4000-8000-000000000001',inc='00000000-0000-4000-8000-000000000002';
const pair=webpush.generateVAPIDKeys(),key=createECDH('prime256v1');key.generateKeys();
const auth=randomBytes(16),sub={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-native-test',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
const env={NATIVE_PUSH_TEST_ENABLED:'true',NATIVE_PUSH_DELIVERY_ENABLED:'false',NATIVE_PUSH_VAPID_PUBLIC_KEY:pair.publicKey,NATIVE_PUSH_VAPID_PRIVATE_KEY:pair.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test',SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',SUPABASE_BACKEND_KEY:'sb_secret_synthetic',ONLINE_ALLOWED_ORIGINS:'https://myhatchai.web.app',NATIVE_PUSH_LIMITER:{limit:async()=>({success:true})},TEST_NOTIFICATION_LIMITER:{limit:async()=>({success:true})}};
const id='synthetic_test_000001';
test('native manual test is independent of chick delivery and uses encrypted fixed-type payload',async()=>{
  let sends=0;
  const result=await sendNativeTest(env,sub,id,async(url,request)=>{
    sends++;assert.equal(url,sub.endpoint);
    const data=JSON.parse(ece.decrypt(Buffer.from(request.body),{version:'aes128gcm',privateKey:key,authSecret:auth}));
    assert.deepEqual(data,{type:'hatchai-native-test',eventId:id});return new Response(null,{status:201});
  });
  assert.equal(result.outcome,'accepted');assert.equal(result.displayConfirmed,false);assert.equal(sends,1);
  assert.equal((await sendNativePush(env,sub,{})).outcome,'disabled');
  assert.equal((await sendNativeTest({...env,NATIVE_PUSH_TEST_ENABLED:'false'},sub,id)).outcome,'disabled');
});
test('mismatched VAPID pair is rejected before any send',async()=>{
  let sends=0;await assert.rejects(()=>sendNativeTest({...env,NATIVE_PUSH_VAPID_PRIVATE_KEY:webpush.generateVAPIDKeys().privateKey},sub,id,async()=>{sends++;}));assert.equal(sends,0);
});
test('test endpoint enforces ownership, gate, limiter and never returns subscription capabilities',async()=>{
  const request=()=>new Request('https://worker.test/online/push/test',{method:'POST',headers:{Origin:'https://myhatchai.web.app',Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'},body:JSON.stringify({incubatorId:inc,endpointHash:createHash('sha256').update(sub.endpoint).digest('hex')})});
  let owner=true,sends=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:user,role:'authenticated'});
    if(url.includes('/incubators?'))return Response.json(owner?[{id:inc,owner_id:user}]:[]);
    if(url.endsWith('/rpc/hatchai_push_test_subscription')){assert.equal(JSON.parse(options.body).p_user,user);return Response.json({confirmed:true,subscription:{endpoint:sub.endpoint,...sub.keys}});}
    assert.equal(url,sub.endpoint);sends++;return new Response(null,{status:201});
  };
  assert.equal((await nativePushFetch(request(),{...env,NATIVE_PUSH_TEST_ENABLED:'false'},fetcher)).status,503);
  owner=false;assert.equal((await nativePushFetch(request(),env,fetcher)).status,403);owner=true;
  assert.equal((await nativePushFetch(request(),{...env,TEST_NOTIFICATION_LIMITER:{limit:async()=>({success:false})}},fetcher)).status,429);
  const result=await nativePushFetch(request(),env,fetcher);assert.equal(result.status,200);const data=await result.json();
  assert.equal(data.accepted,true);assert.equal(data.displayConfirmed,false);assert.match(data.testId,/^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(data).sort(),['accepted','displayConfirmed','testId']);assert.equal(sends,1);
});
test('test endpoint diagnostics expose only allowlisted stage codes and numeric provider status',async()=>{
  const request=()=>new Request('https://worker.test/online/push/test',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'},body:JSON.stringify({incubatorId:inc,endpointHash:'a'.repeat(64)})});
  let stage='storage';
  const fetcher=async url=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:user,role:'authenticated'});
    if(url.includes('/incubators?'))return Response.json([{id:inc,owner_id:user}]);
    if(url.endsWith('/rpc/hatchai_push_test_subscription'))return stage==='storage'?new Response('private-provider-buffer',{status:403}):Response.json({confirmed:true,subscription:{endpoint:sub.endpoint,...sub.keys}});
    return new Response('private-provider-buffer',{status:403});
  };
  let result=await nativePushFetch(request(),env,fetcher);assert.deepEqual(await result.json(),{code:'test_subscription_lookup_failed'});
  stage='provider';result=await nativePushFetch(request(),env,fetcher);assert.deepEqual(await result.json(),{accepted:false,displayConfirmed:false,code:'test_failed',providerStatus:403});
  result=await nativePushFetch(request(),{...env,NATIVE_PUSH_VAPID_PRIVATE_KEY:'invalid'},fetcher);assert.deepEqual(await result.json(),{code:'test_private_key_format'});
});
test('native worker displays fixed test content and never follows payload URLs',async()=>{
  const handlers={},shown=[];let opened;
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://myhatchai.web.app'},registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened=url}};
  runInNewContext(await readFile(new URL('../../public/native-push/service-worker.js',import.meta.url),'utf8'),{self,URL});
  let pending;handlers.push({data:{text:()=>'{valid}',json:()=>({type:'hatchai-native-test',eventId:id,url:'https://evil.invalid'})},waitUntil:p=>pending=p});await pending;
  assert.equal(shown[0][0],'HATCHAI Test Notification');assert.equal(shown[0][1].body,'Your HATCHAI notification system is working.');
  handlers.notificationclick({notification:{close(){}},waitUntil:p=>pending=p});await pending;assert.equal(opened,'https://myhatchai.web.app/online-login.html');
});
test('native worker records one local test receipt without payload or subscription data',async()=>{
  const handlers={},stored=new Map();let blocked=false;
  const cache={put:async(k,r)=>stored.set(k,await r.text()),match:async k=>stored.has(k)?new Response(stored.get(k)):undefined};
  const self={addEventListener:(n,f)=>handlers[n]=f,location:{origin:'https://myhatchai.web.app'},registration:{showNotification:async()=>{if(blocked){const e=new Error();e.name='NotAllowedError';throw e;}}}};
  runInNewContext(await readFile(new URL('../../public/native-push/service-worker.js',import.meta.url),'utf8'),{self,URL,Response,caches:{open:async()=>cache}});
  const push=async()=>{let p;handlers.push({data:{text:()=>'{valid}',json:()=>({type:'hatchai-native-test',eventId:id})},waitUntil:value=>p=value});await p;};
  await push();assert.equal(stored.size,1);let result=JSON.parse([...stored.values()][0]);assert.equal(result.display,'shown');assert.deepEqual(Object.keys(result).sort(),['at','code','display','testId']);assert.equal(result.testId,id);
  blocked=true;await push();assert.equal(stored.size,1);result=JSON.parse([...stored.values()][0]);assert.equal(result.display,'failed');assert.equal(result.code,'NotAllowedError');
  let reply,p;handlers.message({data:{type:'HATCHAI_NATIVE_PUSH_DIAGNOSTIC'},source:{url:'https://myhatchai.web.app/online-login.html'},ports:[{postMessage:value=>reply=value}],waitUntil:value=>p=value});await p;assert.equal(reply.display,'failed');
  reply=null;handlers.message({data:{type:'HATCHAI_NATIVE_PUSH_DIAGNOSTIC'},source:{url:'https://evil.invalid/'},ports:[{postMessage:value=>reply=value}],waitUntil(){}});assert.equal(reply,null);
});
test('review-only test subscription RPC permits backend read of one enabled owner subscription only',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE incubators(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id));INSERT INTO auth.users VALUES('${user}');INSERT INTO incubators VALUES('${inc}','${user}');`);
    for(const file of ['202611090002_native_push_subscriptions.sql','202611100002_native_push_test_subscription_REVIEW.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
    await db.query('INSERT INTO web_push_subscriptions(user_id,incubator_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)',[user,inc,sub.endpoint,sub.keys.p256dh,sub.keys.auth]);
    const args=[user,inc,createHash('sha256').update(sub.endpoint).digest('hex')];
    await db.query('INSERT INTO web_push_subscriptions(user_id,incubator_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)',[user,inc,sub.endpoint+'-second-phone',sub.keys.p256dh,sub.keys.auth]);
    for(const role of ['anon','authenticated']){
      await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query('SELECT hatchai_push_test_subscription($1,$2,$3)',args));await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    const result=(await db.query('SELECT hatchai_push_test_subscription($1,$2,$3) AS r',args)).rows[0].r;
    assert.equal(result.confirmed,true);assert.equal(result.subscription.endpoint,sub.endpoint);
    await assert.rejects(()=>db.query('SELECT hatchai_push_test_subscription($1,$2,$3)',[user,inc,'0'.repeat(64)]));
    await assert.rejects(()=>db.query('SELECT hatchai_push_test_subscription($1,$2,$3)',[user,user,args[2]]));
    await assert.rejects(()=>db.query('SELECT hatchai_push_test_subscription($1,$2,$3)',[inc,inc,args[2]]));await db.exec('RESET ROLE');
    await db.exec('UPDATE web_push_subscriptions SET enabled=false');await assert.rejects(()=>db.query('SELECT hatchai_push_test_subscription($1,$2,$3)',args));
    const verification=await db.exec(await readFile(new URL('../../supabase/verify_native_push_test_rpc_READ_ONLY.sql',import.meta.url),'utf8'));
    assert.equal(verification.length,3);assert.equal(verification[0].rows.length,1);
    assert.equal(verification[0].rows[0].only_owner_and_backend_acl,true);
    assert.equal(verification[1].rows[0].subscriptions,2);
  }finally{await db.close();}
});
