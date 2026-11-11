// Isolated workerd, synthetic keys, fake provider and Supabase. No live delivery.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {createECDH,randomBytes,verify,createPublicKey} from 'node:crypto';
import * as webpush from 'web-push';
import ece from 'http_ece';
import assert from 'node:assert/strict';
import {productionCompatibility} from './runtime-config.mjs';
const compiled=await build({stdin:{contents:`
  import {sendNativePush} from './src/native-push-delivery.js';
  import {nativePushFetch} from './src/native-push.js';
  import {retryDeadline} from './src/native-push-retry.js';
  export default {async fetch(request,env){
    if(new URL(request.url).pathname==='/retry-policy-test'){
      const {result,item,now}=await request.json();return Response.json({deadline:retryDeadline(result,item,now)});
    }
    if(new URL(request.url).pathname==='/crypto-test'){
      const {subscription,vapid,retryAfter,receivedAt}=await request.json();let captured;
      const outcome=await sendNativePush({...env,...vapid,NATIVE_PUSH_DELIVERY_ENABLED:'true'},subscription,{position:'upper',eventId:'runtime_event_0000001'},async(_url,options)=>{captured={headers:options.headers,body:Array.from(options.body)};return retryAfter?new Response(null,{status:429,headers:{'Retry-After':retryAfter}}):new Response(null,{status:201});},()=>receivedAt??Date.now());
      return Response.json({outcome,captured});
    }
    return nativePushFetch(request,{...env,NATIVE_PUSH_LIMITER:{limit:async()=>({success:true})}},async(url)=>url.endsWith('/auth/v1/user')?Response.json({id:'17275f94-f94b-4f89-b1c4-752edf099bc1',role:'authenticated'}):url.includes('/incubators?')?Response.json([{id:'87ce3cf3-a455-4bc3-a7bb-049882d985fa',owner_id:'17275f94-f94b-4f89-b1c4-752edf099bc1'}]):Response.json({confirmed:true,subscriptions:[]}));
  }};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
const compatibility=productionCompatibility();console.log('Native runtime settings: '+JSON.stringify(compatibility));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,...compatibility,bindings:{SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_runtime_only',SUPABASE_BACKEND_KEY:'sb_secret_mock_runtime_only',ONLINE_ALLOWED_ORIGINS:'https://myhatchai.web.app'},outboundService:()=>{throw Error('No external networking permitted');}}));
try{
  const key=createECDH('prime256v1');key.generateKeys();const auth=randomBytes(16),vapid=webpush.generateVAPIDKeys();
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-runtime',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
  const response=await mf.dispatchFetch('http://localhost/crypto-test',{method:'POST',body:JSON.stringify({subscription,vapid:{NATIVE_PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,NATIVE_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test'}})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.outcome.outcome,'accepted');
  const decrypted=ece.decrypt(Buffer.from(result.captured.body),{version:'aes128gcm',privateKey:key,authSecret:auth});assert.equal(JSON.parse(decrypted).position,'upper');
  const jwt=result.captured.headers.authorization.match(/^vapid t=([^,]+), k=/)[1].split('.'),raw=Buffer.from(vapid.publicKey,'base64url');
  const pub=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')}});
  assert.ok(verify('sha256',Buffer.from(jwt[0]+'.'+jwt[1]),{key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(jwt[2],'base64url')));
  const receivedAt=Date.UTC(2026,10,10);
  for(const retryAfter of ['3600',new Date(receivedAt+3600000).toUTCString()]){
    const retried=await mf.dispatchFetch('http://localhost/crypto-test',{method:'POST',body:JSON.stringify({subscription,retryAfter,receivedAt,vapid:{NATIVE_PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,NATIVE_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,NATIVE_PUSH_VAPID_SUBJECT:'mailto:test@example.test'}})});
    const value=await retried.json();assert.equal(value.outcome.retryAfterMs,3600000);assert.equal(value.outcome.retryNotBefore,receivedAt+3600000);
  }
  const policy=await mf.dispatchFetch('http://localhost/retry-policy-test',{method:'POST',body:JSON.stringify({result:{outcome:'retryable',retryAfterMs:3600000},item:{attempt:1,expiresAt:receivedAt+7200000},now:receivedAt})});
  assert.equal((await policy.json()).deadline,receivedAt+3600000);
  const api='http://localhost/online/push/',headers={Origin:'https://myhatchai.web.app',Authorization:'Bearer '+'a'.repeat(40)};
  assert.equal((await mf.dispatchFetch(api+'status?incubatorId=87ce3cf3-a455-4bc3-a7bb-049882d985fa',{headers})).status,200);
  assert.equal((await mf.dispatchFetch(api+'public-key')).status,401);
  assert.equal((await mf.dispatchFetch(api+'subscribe',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({incubatorId:'87ce3cf3-a455-4bc3-a7bb-049882d985fa',subscription,deviceLabel:'Runtime'})})).status,200);
  const preflight=await mf.dispatchFetch(api+'subscribe',{method:'OPTIONS',headers:{Origin:'https://myhatchai.web.app','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(preflight.status,204);
  console.log('PASS: workerd RFC8291 independent decryption, RFC8292 independent signature verification, 3 retry checks and 4 native API requests (8 total); no live upstream.');
}finally{await mf.dispose();}
