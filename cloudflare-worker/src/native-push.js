import { ApiError, need } from './security.js';
import { supabaseSessionVerifier } from './supabase-session.js';

export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function pushEndpoint(value) {
  need(typeof value === 'string' && value.length >= 32 && value.length <= 2048 && !/[\s\x00-\x1f\x7f]/.test(value));
  let url; try { url = new URL(value); } catch { throw new ApiError(400, 'Invalid push endpoint'); }
  const provider = url.hostname === 'fcm.googleapis.com' && url.pathname.startsWith('/fcm/send/') ||
    url.hostname === 'updates.push.services.mozilla.com' && url.pathname.startsWith('/wpush/v2/') ||
    url.hostname === 'web.push.apple.com' && url.pathname.startsWith('/');
  need(provider && url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash && !url.search && url.href === value, 400, 'Unsupported push endpoint');
  return value;
}
export function decodeKey(value, bytes) {
  need(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length === Math.ceil(bytes * 4 / 3));
  let raw; try { raw = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch { throw new ApiError(400, 'Invalid push key'); }
  need(raw.length === bytes && btoa(String.fromCharCode(...raw)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') === value);
  return raw;
}
export async function validateSubscription(value) {
  need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => ['endpoint','keys','expirationTime'].includes(k)));
  const endpoint = pushEndpoint(value.endpoint);
  need(value.expirationTime == null || Number.isSafeInteger(value.expirationTime) && value.expirationTime > Date.now());
  need(value.keys && Object.keys(value.keys).length === 2);
  const raw = decodeKey(value.keys.p256dh, 65); decodeKey(value.keys.auth, 16);
  need(raw[0] === 4);
  try { await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
  catch { throw new ApiError(400, 'Invalid push key'); }
  return { endpoint, p256dh: value.keys.p256dh, auth: value.keys.auth };
}
export async function boundedJson(response, maximum = 16384) {
  const reader = response.body?.getReader(); need(reader, 503, 'Push storage unavailable');
  const parts=[]; let length=0;
  for (;;) { const part=await reader.read(); if(part.done)break; length+=part.value.length;
    if(length>maximum){await reader.cancel();throw new ApiError(503,'Push storage unavailable');} parts.push(part.value); }
  const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(503,'Invalid service response');}
}
export function pushRepository(env, fetcher) {
  return async (operation, args) => {
    need(/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY || ''),503,'Push storage unavailable');
    const response=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/hatchai_push_'+operation,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
      headers:{apikey:env.SUPABASE_BACKEND_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
    if(response.status===409)throw new ApiError(409,'Subscription belongs to another account');
    if(response.status===403)throw new ApiError(403,'Incubator access denied');
    need(response.ok,503,'Push storage unavailable');return boundedJson(response);
  };
}
export async function nativePushFetch(request,env,fetcher=globalThis.fetch.bind(globalThis)) {
  const origin=request.headers.get('Origin');
  const origins=new Set((env.ONLINE_ALLOWED_ORIGINS||'').split(',').filter(x=>/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(x)||/^http:\/\/127\.0\.0\.1:\d+$/.test(x)));
  const headers={'Cache-Control':'no-store',Vary:'Origin'};
  if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  const json=(data,status=200)=>Response.json(data,{status,headers});
  try {
    need(!origin||origins.has(origin),403,'Origin not allowed');
    const url=new URL(request.url),operation=url.pathname.split('/').pop();
    const method=['public-key','status'].includes(operation)?'GET':'POST';
    need(['public-key','status','subscribe','unsubscribe','test'].includes(operation),404,'Not found');
    if(request.method==='OPTIONS'){
      need(request.headers.get('Access-Control-Request-Method')===method,405,'Method not allowed');
      need((request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).every(x=>['authorization','content-type'].includes(x)),400,'Headers not allowed');
      return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':method,'Access-Control-Allow-Headers':'Authorization, Content-Type'}});
    }
    need(request.method===method,405,'Method not allowed');
    need(env.NATIVE_PUSH_LIMITER?.limit,503,'Push rate limiter unavailable');
    // Separate keys prevent unauthenticated traffic sharing a signed-in budget.
    need((await env.NATIVE_PUSH_LIMITER.limit({key:'ip:'+(request.headers.get('CF-Connecting-IP')||'local')})).success,429,'Please retry later');
    const user=await supabaseSessionVerifier(env,fetcher)(request.headers.get('Authorization'));
    need((await env.NATIVE_PUSH_LIMITER.limit({key:user.id})).success,429,'Please retry later');
    if(operation==='public-key'){
      need(!url.search,400);need(typeof env.NATIVE_PUSH_VAPID_PUBLIC_KEY==='string',503,'Push configuration unavailable');
      const raw=decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY,65);need(raw[0]===4,503,'Push configuration unavailable');
      try{await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new ApiError(503,'Push configuration unavailable');}
      return json({publicKey:env.NATIVE_PUSH_VAPID_PUBLIC_KEY});
    }
    let body;
    if(method==='GET'){
      need([...url.searchParams.keys()].length===1 && url.searchParams.has('incubatorId'),400);
      body={incubatorId:url.searchParams.get('incubatorId')};
    }else{
      need(!url.search && (request.headers.get('Content-Type')||'').split(';')[0]==='application/json',400);
      // Bound the streaming body, even when Content-Length is absent or false.
      try{body=await boundedJson(request,4096);}catch{throw new ApiError(400,'Invalid subscription request');}
    }
    const fields=operation==='subscribe'?['incubatorId','subscription','deviceLabel']:operation==='unsubscribe'?['incubatorId','endpoint']:operation==='test'?['incubatorId','endpointHash']:['incubatorId'];
    need(body && Object.keys(body).length===fields.length && fields.every(k=>Object.hasOwn(body,k)) && uuid(body.incubatorId));
    // User-token read is independently subject to existing incubator RLS.
    const owned=await fetcher(env.SUPABASE_URL+'/rest/v1/incubators?select=id,owner_id&id=eq.'+body.incubatorId+'&owner_id=eq.'+user.id+'&limit=1',{
      redirect:'manual',signal:AbortSignal.timeout(8000),headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:request.headers.get('Authorization')}});
    need(owned.ok,503,'Incubator lookup unavailable');const rows=await boundedJson(owned);
    need(Array.isArray(rows)&&rows.length===1&&rows[0].id===body.incubatorId&&rows[0].owner_id===user.id,403,'Incubator access denied');
    const args={p_user:user.id,p_incubator:body.incubatorId};
    if(operation==='test') {
      need(env.NATIVE_PUSH_TEST_ENABLED==='true',503,'Controlled testing disabled');
      need(env.TEST_NOTIFICATION_LIMITER?.limit && (await env.TEST_NOTIFICATION_LIMITER.limit({key:'native-test:'+user.id})).success,429,'Please retry later');
      need(typeof body.endpointHash==='string'&&/^[0-9a-f]{64}$/.test(body.endpointHash));
      let record;
      try {record=await pushRepository(env,fetcher)('test_subscription',{...args,p_endpoint_hash:body.endpointHash});}
      catch {return json({code:'test_subscription_lookup_failed'},503);}
      need(record?.confirmed===true && record.subscription,503,'Subscription unavailable');
      const {sendNativeTest}=await import('./native-push-delivery.js');
      let outcome;const testId=crypto.randomUUID();
      try {outcome=await sendNativeTest(env,{endpoint:record.subscription.endpoint,keys:{p256dh:record.subscription.p256dh,auth:record.subscription.auth}},testId,fetcher);}
      catch(error) {
        const allowed=['test_stored_subscription_invalid','test_private_key_format','test_public_key_format','test_subject_format','test_vapid_pair_invalid','test_payload_encryption_failed'];
        return json({code:error instanceof ApiError&&allowed.includes(error.message)?error.message:'test_configuration_or_encryption_failed'},503);
      }
      if(outcome.outcome==='expired')await pushRepository(env,fetcher)('expire',{...args,p_endpoint:record.subscription.endpoint,p_p256dh:record.subscription.p256dh,p_auth:record.subscription.auth});
      // No automatic retry after a timeout or ambiguous provider response.
      if(outcome.outcome!=='accepted')return json({accepted:false,displayConfirmed:false,
        code:'test_'+outcome.outcome,...(Number.isInteger(outcome.providerStatus)?{providerStatus:outcome.providerStatus}:{})},503);
      return json({accepted:true,displayConfirmed:false,testId});
    }
    if(operation==='subscribe'){
      need(typeof body.deviceLabel==='string'&&body.deviceLabel.length<=80&&!/[\x00-\x1f\x7f<>]/.test(body.deviceLabel));
      const sub=await validateSubscription(body.subscription);
      Object.assign(args,{p_endpoint:sub.endpoint,p_p256dh:sub.p256dh,p_auth:sub.auth,p_label:body.deviceLabel});
    }else if(operation==='unsubscribe')args.p_endpoint=pushEndpoint(body.endpoint);
    const result=await pushRepository(env,fetcher)(operation,args);
    need(result&&result.confirmed===true,503,'Push storage not confirmed');
    if(operation==='status')need(Array.isArray(result.subscriptions)&&result.subscriptions.length<=20&&result.subscriptions.every(x=>/^[0-9a-f]{64}$/.test(x.endpointHash)&&typeof x.enabled==='boolean'),503);
    return json(operation==='status'?{subscriptions:result.subscriptions.map(x=>({endpointHash:x.endpointHash,enabled:x.enabled}))}:{registered:operation==='subscribe'});
  }catch(error){return json({error:error instanceof ApiError?error.message:'Push service unavailable'},error instanceof ApiError?error.status:503);}
}
