import { buildPushPayload } from '@block65/webcrypto-web-push';
import { pushEndpoint, validateSubscription, decodeKey, uuid } from './native-push.js';
import { validateDetection } from './cloud-notifications.js';
import { ApiError, need } from './security.js';
import { retryAfterMs, retryDeadline } from './native-push-retry.js';

export function chickPayload(event) {
  need(event && ['upper','lower'].includes(event.position) && /^[A-Za-z0-9_-]{16,96}$/.test(event.eventId));
  need(event.batchName===undefined || typeof event.batchName==='string' && event.batchName.length<=80 && !/[\x00-\x1f\x7f<>]/.test(event.batchName));
  return {type:'hatchai-chick-detected',position:event.position,eventId:event.eventId,...(event.batchName?{batchName:event.batchName}:{})};
}
// The gated private durable-outbox dispatcher invokes this sender. A valid
// stable private key is required. Tests use synthetic keys and mocked fetch.
export async function sendNativePush(env,subscription,message,fetcher=globalThis.fetch.bind(globalThis),now=()=>Date.now()) {
  if(env.NATIVE_PUSH_DELIVERY_ENABLED!=='true')return {outcome:'disabled'};
  return sendEncrypted(env,subscription,chickPayload(message),fetcher,now);
}

export async function sendNativeAlert(env,subscription,event,fetcher=globalThis.fetch.bind(globalThis),now=()=>Date.now()) {
 if(env.NATIVE_PUSH_DELIVERY_ENABLED!=='true'||env.TELEMETRY_ALERTS_ENABLED!=='true')return {outcome:'disabled'};
 need(event&&['temperature_high','temperature_critical','temperature_low','humidity_high','humidity_low','sensor_failure','sensor_stale','controller_offline'].includes(event.kind)&&['active','resolved'].includes(event.status)&&typeof event.eventId==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(event.eventId));
 return sendEncrypted(env,subscription,{type:'hatchai-telemetry-alert',eventId:event.eventId,kind:event.kind,status:event.status},fetcher,now);
}

export async function sendNativeTest(env,subscription,eventId,fetcher=globalThis.fetch.bind(globalThis),now=()=>Date.now()) {
  if(env.NATIVE_PUSH_TEST_ENABLED!=='true')return {outcome:'disabled'};
  need(typeof eventId==='string' && /^[A-Za-z0-9_-]{16,96}$/.test(eventId));
  return sendEncrypted(env,subscription,{type:'hatchai-native-test',eventId},fetcher,now);
}

async function sendEncrypted(env,subscription,payload,fetcher,now) {
  if(!env.NATIVE_PUSH_VAPID_PRIVATE_KEY || !env.NATIVE_PUSH_VAPID_PUBLIC_KEY || !env.NATIVE_PUSH_VAPID_SUBJECT)return {outcome:'unconfigured'};
  let sub;
  try {sub=await validateSubscription(subscription);pushEndpoint(sub.endpoint);}
  catch {throw new ApiError(503,'test_stored_subscription_invalid');}
  try {decodeKey(env.NATIVE_PUSH_VAPID_PRIVATE_KEY,32);}
  catch {throw new ApiError(503,'test_private_key_format');}
  try {decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY,65);}
  catch {throw new ApiError(503,'test_public_key_format');}
  need(/^mailto:[^\s@]+@[^\s@]+$/.test(env.NATIVE_PUSH_VAPID_SUBJECT)||/^https:\/\/[a-z0-9.-]+\/?$/.test(env.NATIVE_PUSH_VAPID_SUBJECT),503,'test_subject_format');
  // Check the configured public/private pair without exporting or logging it.
  const raw=decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY,65);
  const b64=value=>btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const jwk={kty:'EC',crv:'P-256',x:b64(raw.slice(1,33)),y:b64(raw.slice(33)),d:env.NATIVE_PUSH_VAPID_PRIVATE_KEY};
  try {
    const privateKey=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
    const publicKey=await crypto.subtle.importKey('raw',raw,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const probe=new TextEncoder().encode('HATCHAI VAPID configuration check');
    need(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,
      await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,probe),probe),503,'Push configuration unavailable');
  } catch {throw new ApiError(503,'test_vapid_pair_invalid');}
  let request;
  try {request=await buildPushPayload({data:payload,options:{ttl:300,urgency:'normal'}},{endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
    {publicKey:env.NATIVE_PUSH_VAPID_PUBLIC_KEY,privateKey:env.NATIVE_PUSH_VAPID_PRIVATE_KEY,subject:env.NATIVE_PUSH_VAPID_SUBJECT});}
  catch {throw new ApiError(503,'test_payload_encryption_failed');}
  let response;
  try{response=await fetcher(sub.endpoint,{...request,redirect:'manual',signal:AbortSignal.timeout(8000)});}catch{return {outcome:'unknown'};}
  const status=response.status;await response.body?.cancel(); // Never log or expose provider bodies.
  if(status===201||status===202)return {outcome:'accepted',displayConfirmed:false};
  if(status===404||status===410)return {outcome:'expired'};
  if(status===429||status>=500){
    const receivedAt=now(),delay=retryAfterMs(response.headers.get('Retry-After'),receivedAt);
    if(delay===null)return {outcome:'failed'};
    return {outcome:'retryable',retryAfterMs:delay,retryNotBefore:receivedAt+delay};
  }
  return {outcome:'failed',providerStatus:status}; // Numeric status only; never expose provider bodies.
}

// Future camera integration must supply a reviewed durable repository and a
// verifier for the actual camera registry. Never trust event-supplied placement.
export function nativeDispatch({authorize,repository,send,now=()=>Date.now()}) {
  return {
    async accept(envelope){
      need(envelope && uuid(envelope.incubatorId) && new TextEncoder().encode(JSON.stringify(envelope)).length<=4096);
      const detection=validateDetection(envelope.event,Math.floor(now()/1000));
      const source=await authorize(envelope);const event=chickPayload({...detection,batchName:source?.batchName});
      need(source?.enabled===true && source.incubatorId===envelope.incubatorId && source.position===event.position && source.cameraId===envelope.cameraId && source.cameraId===detection.cameraId && source.batchId===detection.batchId,403,'Event access denied');
      // Atomic durable claim must bind event ID to immutable content, camera,
      // ownership, enabled subscriptions and outbox rows before returning.
      const accepted=await repository.accept({source,event:{...detection,...event},now:now()});
      need(accepted && ['accepted','duplicate'].includes(accepted.status),409,'Event not accepted');
      return {accepted:true,duplicate:accepted.status==='duplicate'};
    },
    async deliverOne(){
      const item=await repository.claim(now());if(!item)return {processed:false};
      need(item.leaseId && Number.isInteger(item.attempt) && item.attempt>=1 && item.attempt<=3 && item.expiresAt>now(),503,'Invalid delivery claim');
      let result;try{result=await send(item.subscription,item.event);}catch{result={outcome:'unknown'};}
      const allowed=['accepted','expired','retryable','unknown','failed','disabled','unconfigured'];
      if(!allowed.includes(result?.outcome))result={outcome:'unknown'};
      const retryAt=retryDeadline(result,item,now());
      need(await repository.finish(item.leaseId,{outcome:result.outcome,retryAt,disableSubscription:result.outcome==='expired'}),503,'Delivery result unconfirmed');
      return {processed:true,outcome:result.outcome,displayConfirmed:false};
    }
  };
}
