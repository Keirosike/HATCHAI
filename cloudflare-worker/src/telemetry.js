import {alertRepository} from './telemetry-alerts.js';
import { ApiError,need,verifyDevice,readBody,sha,canonical } from './security.js';
import { supabaseSessionVerifier } from './supabase-session.js';
import {authenticateApiKey} from './device-api-keys.js';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateTelemetry(value,now){
 need(exact(value,['eventId','capturedAt','temperatureCenti','humidityCenti','sensorValid','sensorAgeMs','heaterOn','fanOn','lowerOn','upperOn','autoMode','upperCameraOnline','lowerCameraOnline','upperChick','lowerChick']),400,'Invalid telemetry');
 need(uuid(value.eventId)&&Number.isSafeInteger(value.capturedAt)&&value.capturedAt<=now+60&&value.capturedAt>=now-604800,400,'Invalid capture time');
 for(const k of ['sensorValid','heaterOn','lowerOn','upperOn','autoMode'])need(typeof value[k]==='boolean',400,'Invalid telemetry');
 need(value.fanOn===null,400,'Fan feedback unavailable'); // Directly powered fan has no measured feedback.
 if(value.sensorValid){need(Number.isInteger(value.temperatureCenti)&&value.temperatureCenti>=-4000&&value.temperatureCenti<=8000&&Number.isInteger(value.humidityCenti)&&value.humidityCenti>=0&&value.humidityCenti<=10000&&Number.isInteger(value.sensorAgeMs)&&value.sensorAgeMs>=0&&value.sensorAgeMs<20000,400,'Invalid sensor sample');}
 else need(value.temperatureCenti===null&&value.humidityCenti===null&&value.sensorAgeMs===null,400,'Invalid sensor sample');
 for(const position of ['upper','lower']){const online=value[position+'CameraOnline'],chick=value[position+'Chick'];need(online===null||typeof online==='boolean',400,'Invalid camera status');need(online===true?typeof chick==='boolean':chick===null,400,'Invalid detection status');}
 return {...value};
}
async function jsonBody(response,max=65536){const reader=response.body?.getReader();need(reader,503,'Synchronization unavailable');let size=0;const parts=[];for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>max){await reader.cancel();throw new ApiError(503,'Synchronization unavailable');}parts.push(p.value);}const data=new Uint8Array(size);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new ApiError(503,'Synchronization unavailable');}}
export function telemetryRepository(env,fetcher=fetch){return async(operation,args)=>{
 need(env.SUPABASE_URL==='https://dihufafcztqjuudjeqdm.supabase.co'&&/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY||''),503,'Synchronization unavailable');
 const r=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/hatchai_sync_'+operation,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{apikey:env.SUPABASE_BACKEND_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(r.status===403)throw new ApiError(403,'Incubator access denied');if(r.status===409)throw new ApiError(409,'Synchronization conflict');need(r.ok,503,'Synchronization unavailable');return jsonBody(r);
};}
export async function telemetryFetch(request,env,dependencies={}){
 const now=dependencies.now?.()??Math.floor(Date.now()/1000),fetcher=dependencies.fetcher??fetch,repository=dependencies.repository??telemetryRepository(env,fetcher);
 const origins=new Set((env.ONLINE_ALLOWED_ORIGINS||'').split(',')),origin=request.headers.get('Origin');
 const headers={'Cache-Control':'no-store',Vary:'Origin'};if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const json=(value,status=200)=>Response.json(value,{status,headers});
 try{
  need(!origin||origins.has(origin),403,'Origin not allowed');need(env.TELEMETRY_ENABLED==='true',503,'Synchronization is not enabled');
  const url=new URL(request.url),device=url.pathname==='/device/telemetry',match=url.pathname.match(/^\/online\/incubators\/([0-9a-f-]{36})\/telemetry$/i);
  need(!url.search&&(device||match),404,'Not found');
  if(request.method==='OPTIONS'){need(!device&&request.headers.get('Access-Control-Request-Method')==='GET',405,'Method not allowed');need((request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).every(x=>x==='authorization'||x==='if-none-match'),400,'Headers not allowed');return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'Authorization, If-None-Match'}});}
  const limiter=env.TELEMETRY_RATE_LIMITER;need(limiter&&typeof limiter.limit==='function',503,'Synchronization unavailable');
  if(device){
   need(request.method==='POST'&&!origin,405,'Device POST required');const body=await readBody(request);
   const apiKeyMode=env.DEVICE_API_KEY_AUTH_ENABLED==='true';
   need(exact(body,apiKeyMode?['deviceId','keyId','issuedAt','nonce','sample']:['deviceId','keyId','issuedAt','nonce','sample','signature'])&&Number.isSafeInteger(body.issuedAt)&&Math.abs(now-body.issuedAt)<=60&&typeof body.nonce==='string'&&/^[A-Za-z0-9_-]{24,64}$/.test(body.nonce),401,'Unauthorized device');
   need((await limiter.limit({key:'device:'+request.headers.get('CF-Connecting-IP')})).success,429,'Rate limited');
   if(apiKeyMode){const identity=await authenticateApiKey(request,env,repository);need(identity.deviceId===body.deviceId&&identity.keyId===body.keyId,401,'Unauthorized device');}
   else await verifyDevice({NOTIFICATION_DEVICE_KEYS:env.TELEMETRY_DEVICE_KEYS},'/device/telemetry',body);
   need((await limiter.limit({key:'telemetry:'+body.deviceId})).success,429,'Rate limited');const sample=validateTelemetry(body.sample,now);
   const result=await repository('ingest',{p_device:body.deviceId,p_key:body.keyId,p_event:sample.eventId,p_nonce:await sha(body.nonce),p_hash:await sha(canonical(sample)),p_captured:new Date(sample.capturedAt*1000).toISOString(),p_payload:sample});
   need(result?.accepted===true&&result.eventId===sample.eventId,503,'Synchronization unavailable');
   if(env.TELEMETRY_ROLLUPS_ENABLED==='true'&&env.TELEMETRY_ALERTS_ENABLED==='true'){const work=()=> (dependencies.alertRepository??alertRepository(env,fetcher))('observe',{p_device:body.deviceId});if(dependencies.waitUntil)dependencies.waitUntil(work());else await work();}
   return json({accepted:true,eventId:sample.eventId,duplicate:result.duplicate===true});
  }
  need(request.method==='GET'&&uuid(match[1]),405,'GET required');const user=await supabaseSessionVerifier(env,fetcher)(request.headers.get('Authorization'));
  need((await limiter.limit({key:'read:'+user.id})).success,429,'Rate limited');const conditional=request.headers.get('If-None-Match');const version=conditional?.match(/^"[A-Za-z0-9_-]{43}\.([0-9a-f]{32})"$/)?.[1];
  const result=await repository(env.TELEMETRY_ROLLUPS_ENABLED==='true'?'read_v2':'read',{p_user:user.id,p_incubator:match[1],...(env.TELEMETRY_ROLLUPS_ENABLED==='true'?{p_history_version:version??null}:{})});
  need(result&&Array.isArray(result.history)&&result.history.length<=96&&[true,false].includes(result.online),503,'Synchronization unavailable');
  if(env.TELEMETRY_ROLLUPS_ENABLED==='true'){
   need(/^[0-9a-f]{32}$/.test(result.historyVersion)&&typeof result.historyUnchanged==='boolean'&&result.historyKind==='utc-30-minute'&&['online','stale','offline','unavailable'].includes(result.connection),503,'Synchronization unavailable');
  }
  // Authorization and ownership are rechecked before any conditional response.
  if(env.TELEMETRY_ROLLUPS_ENABLED==='true'&&env.TELEMETRY_ALERTS_ENABLED==='true'){const alerts=await(dependencies.alertRepository??alertRepository(env,fetcher))('read',{p_user:user.id,p_incubator:match[1]});need(Array.isArray(alerts?.alerts)&&alerts.alerts.length<=50,503,'Alert service unavailable');result.alerts=alerts.alerts;}
  const tag='"'+await sha(canonical({...result,serverTime:null,history:null,historyUnchanged:null}))+ (result.historyVersion?'.'+result.historyVersion:'')+'"';headers.ETag=tag;headers['Access-Control-Expose-Headers']='ETag';
  if(request.headers.get('If-None-Match')===tag)return new Response(null,{status:304,headers});
  return json(result);
 }catch(error){return json({error:error instanceof ApiError?error.message:'Synchronization unavailable'},error instanceof ApiError?error.status:503);}
}
