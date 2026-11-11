import {ApiError,need,readBody,sha,canonical} from './security.js';
import {authenticateApiKey,apiKeyVerifier,deviceRepository} from './device-api-keys.js';
import {cameraRepository} from './camera-events.js';
const exact=(body,fields)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===fields.length&&fields.every(f=>Object.hasOwn(body,f));
const cameras=new Set(['hatchai-inc01-cam01','hatchai-inc01-cam02']);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const timestamp=(value,now)=>value===null||Number.isSafeInteger(value)&&value>=1704067200&&value<=now+60;
export async function controllerCameraFetch(request,env,dependencies={}){
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 try{
  const url=new URL(request.url);need(url.protocol==='https:',400,'HTTPS required');
  need(url.pathname==='/device/controller-camera-events'&&!url.search&&request.method==='POST'&&!request.headers.has('Origin'),405,'Device POST required');
  need(env.CAMERA_EVENTS_ENABLED==='true'&&env.DEVICE_API_KEY_AUTH_ENABLED==='true',503,'Controller camera relay is disabled');
  const limiter=env.CAMERA_EVENT_LIMITER;need(limiter?.limit,503,'Camera service unavailable');
  need((await limiter.limit({key:'relay-ip:'+request.headers.get('CF-Connecting-IP')})).success,429,'Rate limited');
  const fetcher=dependencies.fetcher??fetch;
  const identity=await authenticateApiKey(request,env,dependencies.deviceRepository??deviceRepository(env,fetcher));
  const now=dependencies.now?.()??Math.floor(Date.now()/1000),body=await readBody(request);
  need(exact(body,['deviceId','keyId','issuedAt','nonce','event'])&&body.deviceId===identity.deviceId&&body.keyId===identity.keyId&&Number.isSafeInteger(body.issuedAt)&&Math.abs(now-body.issuedAt)<=60&&typeof body.nonce==='string'&&/^[A-Za-z0-9_-]{24,64}$/.test(body.nonce),401,'Unauthorized device');
  const event=body.event;
  need(exact(event,['cameraId','eventId','incarnation','sequence','detectedAt','receivedAt','timeSource','confidence','confirmed'])&&cameras.has(event.cameraId)&&uuid(event.eventId)&&Number.isInteger(event.incarnation)&&event.incarnation>0&&event.incarnation<=0xffffffff&&Number.isInteger(event.sequence)&&event.sequence>0&&event.sequence<=0xffffffff&&event.confirmed===true&&Number.isInteger(event.confidence)&&event.confidence>=500&&event.confidence<=1000&&timestamp(event.detectedAt,now)&&timestamp(event.receivedAt,now)&&['camera-utc','controller-rtc','unknown'].includes(event.timeSource)&&((event.detectedAt===null)===(event.timeSource==='unknown'))&&(event.detectedAt===null||event.receivedAt===null||event.detectedAt<=event.receivedAt+60),400,'Invalid confirmed camera event');
  need((await limiter.limit({key:'relay-controller:'+identity.deviceId})).success,429,'Rate limited');
  const result=await(dependencies.repository??cameraRepository(env,fetcher))('relay_accept',{
   p_controller:identity.deviceId,p_key:identity.keyId,p_verifier:await apiKeyVerifier(env,identity.deviceId,request.headers.get('X-HatchAI-Api-Key')),
   p_camera:event.cameraId,p_event:event.eventId,p_nonce:await sha(body.nonce),p_hash:await sha(canonical(event)),
   p_detected:event.detectedAt===null?null:new Date(event.detectedAt*1000).toISOString(),p_received:event.receivedAt===null?null:new Date(event.receivedAt*1000).toISOString(),p_source:event.timeSource,p_confidence:event.confidence
  });
  need(result?.accepted===true&&result.eventId===event.eventId,503,'Camera storage unavailable');
  return json({accepted:true,eventId:result.eventId,duplicate:result.duplicate===true});
 }catch(error){return json({error:error instanceof ApiError?error.message:'Camera relay unavailable'},error instanceof ApiError?error.status:503);}
}
