import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import ece from 'http_ece';
import * as webpush from 'web-push';
import { nativePushFetch, pushEndpoint, validateSubscription } from '../src/native-push.js';
import { sendNativePush, nativeDispatch, chickPayload } from '../src/native-push-delivery.js';
const user='17275f94-f94b-4f89-b1c4-752edf099bc1',inc='87ce3cf3-a455-4bc3-a7bb-049882d985fa';
const key=createECDH('prime256v1');key.generateKeys();const auth=randomBytes(16);
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-only',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
const vapid=webpush.generateVAPIDKeys();
const env={SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_only_value',SUPABASE_BACKEND_KEY:'sb_secret_mock_only_value',ONLINE_ALLOWED_ORIGINS:'https://myhatchai.web.app',NATIVE_PUSH_LIMITER:{limit:async()=>({success:true})},NATIVE_PUSH_VAPID_PUBLIC_KEY:vapid.publicKey};
const token='Bearer '+ 'a'.repeat(40);
function req(op,body,headers={}){return new Request('https://worker.test/online/push/'+op,{method:body?'POST':'GET',headers:{Origin:'https://myhatchai.web.app',Authorization:token,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});}
function upstream({owner=true,invalid=false,rpcStatus=200}={}){return async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return invalid?new Response(null,{status:401}):Response.json({id:user,role:'authenticated'});
  if(url.includes('/incubators?'))return Response.json(owner?[{id:inc,owner_id:user}]:[]);
  assert.equal(options.headers.apikey,env.SUPABASE_BACKEND_KEY);assert.equal(JSON.parse(options.body).p_user,user);
  return rpcStatus===200?Response.json({confirmed:true,subscriptions:[]}):new Response('sensitive-provider-error',{status:rpcStatus});
};}
test('native endpoints require a valid user, reject invalid/expired tokens and do not leak errors',async()=>{
  for(const op of ['public-key','status?incubatorId='+inc,'subscribe','unsubscribe']){
    const body=['subscribe','unsubscribe'].includes(op)?{}:null;
    assert.equal((await nativePushFetch(req(op,body,{Authorization:''}),env,upstream())).status,401);
    assert.equal((await nativePushFetch(req(op,body),env,upstream({invalid:true}))).status,401);
  }
});
test('native CORS preflight allows approved POST and rejects foreign origins/headers',async()=>{
  const make=(origin,header)=>new Request('https://worker.test/online/push/subscribe',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':header}});
  const r=await nativePushFetch(make('https://myhatchai.web.app','authorization,content-type'),env);assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://myhatchai.web.app');
  assert.equal((await nativePushFetch(make('https://evil.test','authorization'),env)).status,403);
  assert.equal((await nativePushFetch(make('https://myhatchai.web.app','x-user-id'),env)).status,400);
});
test('ownership, server-derived identity, registration, status and unsubscribe',async()=>{
  const body={incubatorId:inc,subscription,deviceLabel:'Android'};
  assert.equal((await nativePushFetch(req('subscribe',body),env,upstream({owner:false}))).status,403);
  assert.equal((await nativePushFetch(req('subscribe',{...body,user_id:user}),env,upstream())).status,400);
  assert.deepEqual(await(await nativePushFetch(req('subscribe',body),env,upstream())).json(),{registered:true});
  assert.deepEqual(await(await nativePushFetch(req('status?incubatorId='+inc),env,upstream())).json(),{subscriptions:[]});
  assert.deepEqual(await(await nativePushFetch(req('unsubscribe',{incubatorId:inc,endpoint:subscription.endpoint}),env,upstream())).json(),{registered:false});
});
test('duplicate registration confirms; atomic database conflicts cannot reassign ownership',async()=>{
  const body={incubatorId:inc,subscription,deviceLabel:'Android'};
  for(let i=0;i<2;i++)assert.equal((await nativePushFetch(req('subscribe',body),env,upstream())).status,200);
  const r=await nativePushFetch(req('subscribe',body),env,upstream({rpcStatus:409}));assert.equal(r.status,409);assert.ok(!(await r.text()).includes('sensitive-provider'));
});
test('request bounds, invalid keys, rate limits and backend privilege fail closed',async()=>{
  const body={incubatorId:inc,subscription,deviceLabel:'x'.repeat(5000)};
  assert.equal((await nativePushFetch(req('subscribe',body),env,upstream())).status,400);
  assert.equal((await nativePushFetch(req('public-key'),{...env,NATIVE_PUSH_LIMITER:null},upstream())).status,503);
  assert.equal((await nativePushFetch(req('public-key'),{...env,NATIVE_PUSH_LIMITER:{limit:async()=>({success:false})}},upstream())).status,429);
  assert.equal((await nativePushFetch(req('status?incubatorId='+inc),{...env,SUPABASE_BACKEND_KEY:'sb_publishable_wrong'},upstream())).status,503);
  await assert.rejects(()=>validateSubscription({...subscription,keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}}));
});
test('push destinations reject private hosts, suffix attacks, ports, credentials, fragments and HTTP',()=>{
  for(const bad of ['http://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/private','https://localhost/secret','https://fcm.googleapis.com.evil.test/fcm/send/test','https://user@fcm.googleapis.com/fcm/send/test','https://fcm.googleapis.com:444/fcm/send/test','https://fcm.googleapis.com/fcm/send/test#fragment','https://fcm.googleapis.com/fcm/send/test?redirect=internal'])assert.throws(()=>pushEndpoint(bad));
});
test('RFC8291 independent http_ece decrypt and RFC8292 independent Node ES256 verification',async()=>{
  let called=0;
  const configured={...env,NATIVE_PUSH_DELIVERY_ENABLED:'true',NATIVE_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test'};
  const message={position:'upper',eventId:'synthetic_event_000001',batchName:'Upper batch'};
  const result=await sendNativePush(configured,subscription,message,async(url,options)=>{
    called++;assert.equal(url,subscription.endpoint);assert.equal(options.redirect,'manual');assert.equal(options.headers['content-encoding'],'aes128gcm');
    const decrypted=ece.decrypt(Buffer.from(options.body),{version:'aes128gcm',privateKey:key,authSecret:auth});assert.deepEqual(JSON.parse(decrypted.toString()),chickPayload(message));
    const jwt=options.headers.authorization.match(/^vapid t=([^,]+), k=/)[1],parts=jwt.split('.');
    const raw=Buffer.from(vapid.publicKey,'base64url');const publicKey=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')}});
    assert.equal(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
    const claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.aud,'https://fcm.googleapis.com');assert.ok(claims.exp>Date.now()/1000&&claims.exp<Date.now()/1000+86400);
    return new Response(null,{status:201});
  });assert.equal(called,1);assert.equal(result.outcome,'accepted');assert.equal(result.displayConfirmed,false);
});
test('delivery gate, missing key, expired subscription, retries, unknown outcome and redirects',async()=>{
  const event={position:'lower',eventId:'synthetic_event_000002'};
  assert.equal((await sendNativePush(env,subscription,event,()=>{throw Error('must not send');})).outcome,'disabled');
  assert.equal((await sendNativePush({...env,NATIVE_PUSH_DELIVERY_ENABLED:'true'},subscription,event)).outcome,'unconfigured');
  const configured={...env,NATIVE_PUSH_DELIVERY_ENABLED:'true',NATIVE_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test'};
  for(const [status,outcome] of [[410,'expired'],[404,'expired'],[429,'retryable'],[503,'retryable'],[302,'failed']])assert.equal((await sendNativePush(configured,subscription,event,async()=>new Response(null,{status}))).outcome,outcome);
  assert.equal((await sendNativePush(configured,subscription,event,async()=>{throw Error('secret');})).outcome,'unknown');
});
test('prepared dispatch enforces source placement, durable dedup and bounded retry contract',async()=>{
  const events=new Set();let finished;
  const repository={accept:async({event})=>{const status=events.has(event.eventId)?'duplicate':'accepted';events.add(event.eventId);return {status};},claim:async()=>({leaseId:'lease',attempt:3,expiresAt:200,subscription,event:{position:'lower',eventId:'synthetic_event_000002'}}),finish:async(_,value)=>{finished=value;return true;}};
  const dispatch=nativeDispatch({authorize:async()=>({enabled:true,incubatorId:inc,cameraId:'lower',position:'lower',batchId:'synthetic-batch'}),repository,send:async()=>({outcome:'expired'}),now:()=>100});
  const envelope={incubatorId:inc,cameraId:'lower',event:{position:'lower',eventId:'synthetic_event_000002',cameraId:'lower',batchId:'synthetic-batch',detectedAt:0,type:'chick_detected'}};
  assert.equal((await dispatch.accept(envelope)).duplicate,false);assert.equal((await dispatch.accept(envelope)).duplicate,true);
  await assert.rejects(()=>dispatch.accept({...envelope,cameraId:'upper'}));
  await dispatch.deliverOne();assert.equal(finished.disableSubscription,true);assert.equal(finished.retryAt,null);
});

test('sender preserves numeric and HTTP-date Retry-After and rejects overflow',async()=>{
  const receivedAt=Date.UTC(2026,10,10),configured={...env,NATIVE_PUSH_DELIVERY_ENABLED:'true',NATIVE_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test'};
  for(const header of ['3600',new Date(receivedAt+3600000).toUTCString()]){
    const result=await sendNativePush(configured,subscription,{position:'upper',eventId:'synthetic_retry_000001'},async()=>new Response(null,{status:429,headers:{'Retry-After':header}}),()=>receivedAt);
    assert.equal(result.retryAfterMs,3600000);assert.equal(result.retryNotBefore,receivedAt+3600000);
  }
  const failed=await sendNativePush(configured,subscription,{position:'upper',eventId:'synthetic_retry_000001'},async()=>new Response(null,{status:503,headers:{'Retry-After':'9'.repeat(100)}}),()=>receivedAt);
  assert.equal(failed.outcome,'failed');
});

test('dispatcher persists long retry deadline and terminates at event expiry, without sleeping',async()=>{
  const time=Date.UTC(2026,10,10);let saved;let expiresAt=time+7200000;
  const dispatcher=nativeDispatch({authorize:async()=>{},now:()=>time,send:async()=>({outcome:'retryable',retryAfterMs:3600000,retryNotBefore:time+3600000}),
    repository:{claim:async()=>({leaseId:'lease',attempt:1,expiresAt,subscription,event:{}}),finish:async(_,result)=>{saved=result;return true;}}});
  await dispatcher.deliverOne();assert.equal(saved.retryAt,time+3600000);
  expiresAt=time+3600000;await dispatcher.deliverOne();assert.equal(saved.retryAt,null);
});
