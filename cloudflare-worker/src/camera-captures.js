import {ApiError,need,verifyDevice,sha,b64} from './security.js';
import {boundedJson,uuid} from './native-push.js';
import {supabaseSessionVerifier} from './supabase-session.js';

export const MAX_CAPTURE_BYTES=131072;
export async function captureBytes(input,maximum=MAX_CAPTURE_BYTES,signal=AbortSignal.timeout(8000)) {
  const reader=input.body?.getReader();need(reader,400,'Image body required');
  let listener;const aborted=new Promise((_,reject)=>{listener=()=>reject(new ApiError(408,'Image deadline exceeded'));signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();});
  const parts=[];let length=0;
  try {for(;;){const p=await Promise.race([reader.read(),aborted]);if(p.done)break;length+=p.value.length;need(length<=maximum,413,'Image too large');parts.push(p.value);}}
  catch(error){void reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',listener);reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export const imageHash=async bytes=>b64(await crypto.subtle.digest('SHA-256',bytes));
export function jpeg(bytes) {
  need(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217,400,'JPEG required');
  let at=2;
  while(at+4<=bytes.length){need(bytes[at++]===255,400,'Invalid JPEG');while(bytes[at]===255)at++;const marker=bytes[at++];need(marker!==0&&marker!==216&&marker!==217&&marker!==218,400,'JPEG dimensions required');
    const length=bytes[at]*256+bytes[at+1];need(length>=2&&at+length<=bytes.length,400,'Invalid JPEG');
    if([192,193,194].includes(marker)){need(length>=8,400,'Invalid JPEG');const h=bytes[at+3]*256+bytes[at+4],w=bytes[at+5]*256+bytes[at+6];need(w>0&&h>0&&w<=1280&&h<=960,400,'Image dimensions too large');return;}
    at+=length;
  }
  throw new ApiError(400,'JPEG dimensions required');
}
function configuration(env){need(env.SUPABASE_URL==='https://dihufafcztqjuudjeqdm.supabase.co'&&/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY||'')&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.CAMERA_CAPTURE_BUCKET||''),503,'Capture storage unavailable');}
const objectKey=value=>{need(typeof value==='string'&&/^[0-9a-f-]{36}\/hatchai-inc01-cam0[12]\/[0-9a-f-]{36}\.jpg$/.test(value),503,'Invalid storage record');return value;};
export function captureServices(env,fetcher=fetch,signal=AbortSignal.timeout(15000)) {
  configuration(env);const base=env.SUPABASE_URL,headers={apikey:env.SUPABASE_BACKEND_KEY};
  const rpc=async(op,args={})=>{const response=await fetcher(base+'/rest/v1/rpc/hatchai_capture_'+op,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'manual',signal});need(response.ok,response.status===403?403:response.status===409?409:503,'Capture storage unavailable');return boundedJson(response,16384);};
  const bucket=env.CAMERA_CAPTURE_BUCKET;
  const privateBucket=async()=>{const r=await fetcher(base+'/storage/v1/bucket/'+bucket,{headers,redirect:'manual',signal});need(r.ok,503,'Private capture bucket unavailable');const info=await boundedJson(r,4096);need(info.id===bucket&&info.public===false,503,'Private capture bucket required');};
  const get=async key=>{const r=await fetcher(base+'/storage/v1/object/authenticated/'+bucket+'/'+objectKey(key),{headers,redirect:'manual',signal});need(r.ok,503,'Capture unavailable');return captureBytes(r,MAX_CAPTURE_BYTES,signal);};
  const put=async(key,bytes)=>{const r=await fetcher(base+'/storage/v1/object/'+bucket+'/'+objectKey(key),{method:'POST',headers:{...headers,'Content-Type':'image/jpeg','x-upsert':'false'},body:bytes,redirect:'manual',signal});
    // Supabase reports existing immutable objects as 400 or 409. Both still
    // require exact downloaded-byte/hash verification before registration succeeds.
    need(r.ok||r.status===400||r.status===409,503,'Capture upload unavailable');await r.body?.cancel();return get(key);};
  const remove=async key=>{const r=await fetcher(base+'/storage/v1/object/'+bucket,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[objectKey(key)]}),redirect:'manual',signal});need(r.ok||r.status===404,503,'Capture cleanup unavailable');await r.body?.cancel();const check=await fetcher(base+'/storage/v1/object/authenticated/'+bucket+'/'+objectKey(key),{headers,redirect:'manual',signal});await check.body?.cancel();need(check.status===404,503,'Capture deletion not confirmed');};
  return {rpc,privateBucket,get,put,remove};
}
export async function cameraCapturesFetch(request,env,dependencies={}) {
  const origin=request.headers.get('Origin'),allowed=(env.ONLINE_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
  const headers={'Cache-Control':'no-store',Vary:'Origin','X-Content-Type-Options':'nosniff'};if(origin&&allowed.includes(origin))headers['Access-Control-Allow-Origin']=origin;
  const json=(value,status=200)=>Response.json(value,{status,headers});
  try {
    need(!origin||allowed.includes(origin),403,'Origin not allowed');need(env.CAMERA_CAPTURES_ENABLED==='true'&&env.CAMERA_CAPTURE_STORAGE_REVIEWED==='true',503,'Camera captures are not enabled');
    const url=new URL(request.url),device=url.pathname==='/device/camera-captures',match=url.pathname.match(/^\/online\/incubators\/([0-9a-f-]{36})\/captures(?:\/([0-9a-f-]{36}))?$/i);
    need(!url.search&&(device||match),404,'Not found');
    if(request.method==='OPTIONS'){need(!device&&request.headers.get('Access-Control-Request-Method')==='GET',405,'GET required');need((request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').filter(s=>s.trim()).every(s=>s.trim()==='authorization'),400,'Headers not allowed');return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'Authorization'}});}
    need(env.CAMERA_CAPTURE_LIMITER?.limit,503,'Capture service unavailable');
    const rate=async key=>need((await env.CAMERA_CAPTURE_LIMITER.limit({key})).success,429,'Rate limited');
    const services=dependencies.services??captureServices(env,dependencies.fetcher??fetch);
    if(device){
      need(request.method==='POST'&&!origin,405,'Device POST required');await rate('ip:'+request.headers.get('CF-Connecting-IP'));
      const envelope=request.headers.get('X-Hatchai-Capture');need(envelope&&envelope.length<=2048,400,'Signed capture header required');let body;try{body=JSON.parse(envelope);}catch{throw new ApiError(400,'Invalid capture header');}
      const keys=['deviceId','keyId','issuedAt','nonce','eventId','contentHash','byteLength','signature'];need(body&&typeof body==='object'&&Object.keys(body).length===keys.length&&keys.every(k=>Object.hasOwn(body,k)),400,'Invalid capture header');
      const now=dependencies.now?.()??Math.floor(Date.now()/1000);need(Number.isSafeInteger(body.issuedAt)&&Math.abs(now-body.issuedAt)<=60&&typeof body.nonce==='string'&&/^[A-Za-z0-9_-]{24,64}$/.test(body.nonce),401,'Unauthorized capture');
      need(['hatchai-inc01-cam01','hatchai-inc01-cam02'].includes(body.deviceId),403,'Camera only');need(uuid(body.eventId)&&/^[A-Za-z0-9_-]{43}$/.test(body.contentHash)&&Number.isInteger(body.byteLength)&&body.byteLength>=4&&body.byteLength<=MAX_CAPTURE_BYTES,400,'Invalid capture');
      need(request.headers.get('Content-Type')==='image/jpeg'&&!request.headers.has('Content-Encoding'),415,'JPEG required');
      await verifyDevice({NOTIFICATION_DEVICE_KEYS:env.CAMERA_EVENT_KEYS},'/device/camera-captures',body);await rate('device:'+body.deviceId);
      const bytes=await captureBytes(request);need(bytes.length===body.byteLength&&await imageHash(bytes)===body.contentHash,400,'Image integrity failed');jpeg(bytes);
      await services.privateBucket();
      const reservation=await services.rpc('reserve',{p_device:body.deviceId,p_key:body.keyId,p_event:body.eventId,p_nonce:await sha(body.nonce),p_hash:body.contentHash,p_bytes:bytes.length});
      need(uuid(reservation?.id),503,'Invalid capture reservation');objectKey(reservation.objectKey);
      if(!reservation.ready){const stored=await services.put(reservation.objectKey,bytes);need(stored.length===bytes.length&&await imageHash(stored)===body.contentHash,503,'Stored image verification failed');
        need(await services.rpc('complete',{p_device:body.deviceId,p_key:body.keyId,p_id:reservation.id,p_hash:body.contentHash})===true,503,'Capture not confirmed');}
      return json({accepted:true,eventId:body.eventId,captureId:reservation.id});
    }
    need(request.method==='GET'&&uuid(match[1])&&(!match[2]||uuid(match[2])),405,'GET required');
    const user=await supabaseSessionVerifier(env,dependencies.fetcher??fetch)(request.headers.get('Authorization'));await rate('user:'+user.id);
    const result=await services.rpc('read',{p_user:user.id,p_incubator:match[1],p_id:match[2]??null});
    if(!match[2]){need(Array.isArray(result?.captures)&&result.captures.length<=50,503,'Invalid capture list');return json({captures:result.captures.map(({id,position,capturedAt,chick})=>({id,position,capturedAt,chick}))});}
    need(result,404,'Capture not found');await services.privateBucket();const bytes=await services.get(objectKey(result.objectKey));need(bytes.length===result.bytes&&await imageHash(bytes)===result.hash,503,'Image integrity failed');jpeg(bytes);
    return new Response(bytes,{headers:{...headers,'Content-Type':'image/jpeg','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
  } catch(error){return json({error:error instanceof ApiError?error.message:'Capture service unavailable'},error instanceof ApiError?error.status:503);}
}
export async function cleanupCaptures(env,dependencies={}) {
  if(env.CAMERA_CAPTURES_ENABLED!=='true'||env.CAMERA_CAPTURE_STORAGE_REVIEWED!=='true')return;
  const services=dependencies.services??captureServices(env,dependencies.fetcher??fetch);await services.privateBucket();const job=await services.rpc('cleanup_claim');if(!job)return;
  need(uuid(job.lease),503,'Invalid cleanup lease');await services.remove(objectKey(job.objectKey));need(await services.rpc('cleanup_finish',{p_lease:job.lease})===true,503,'Cleanup not confirmed');
}
