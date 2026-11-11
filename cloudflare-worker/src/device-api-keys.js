import {ApiError,need,random,protectedHash,readBody,unb64} from './security.js';
import {supabaseSessionVerifier} from './supabase-session.js';

const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const apiKeyVerifier=(env,deviceId,key)=>protectedHash(env,'device-api-key',deviceId+'\n'+key);
async function rpcBody(response){try{return await response.json();}catch{throw new ApiError(503,'Enrollment unavailable');}}
export function deviceRepository(env,fetcher=fetch){return async(operation,args)=>{
  need(env.SUPABASE_URL==='https://dihufafcztqjuudjeqdm.supabase.co'&&/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY||''),503,'Enrollment unavailable');
  const response=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/hatchai_'+operation,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{apikey:env.SUPABASE_BACKEND_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
  need(response.ok,503,'Enrollment unavailable');return rpcBody(response);
};}

export async function authenticateApiKey(request,env,repository){
  const deviceId=request.headers.get('X-HatchAI-Device'),keyId=request.headers.get('X-HatchAI-Key-Id');
  const value=request.headers.get('X-HatchAI-Api-Key');
  need(id(deviceId)&&id(keyId)&&token(value)&&unb64(value).length===32,401,'Unauthorized device');
  const verifier=await apiKeyVerifier(env,deviceId,value);
  need(await repository('device_api_key_auth',{p_device:deviceId,p_key:keyId,p_verifier:verifier})===true,401,'Unauthorized device');
  return {deviceId,keyId};
}

export async function deviceApiKeyFetch(request,env,dependencies={}){
  const fetcher=dependencies.fetcher??fetch,repository=dependencies.repository??deviceRepository(env,fetcher);
  const origin=request.headers.get('Origin'),origins=new Set((env.ONLINE_ALLOWED_ORIGINS||'').split(',').filter(Boolean));
  const headers={'Cache-Control':'no-store',Vary:'Origin'};if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  const json=(body,status=200)=>Response.json(body,{status,headers});
  try{
    const url=new URL(request.url);need(!url.search,404,'Not found');
    if(url.pathname==='/online/device-enrollment'){
      need(origin&&origins.has(origin),403,'Origin not allowed');
      if(request.method==='OPTIONS'){need(request.headers.get('Access-Control-Request-Method')==='POST',405,'Method not allowed');return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}});}
      need(env.DEVICE_API_KEY_ENROLLMENT_ENABLED==='true',503,'Device enrollment is disabled');
      need(request.method==='POST',405,'POST required');
      const limiter=env.TELEMETRY_RATE_LIMITER;need(limiter&&typeof limiter.limit==='function',503,'Enrollment unavailable');
      need((await limiter.limit({key:'enroll-owner-ip:'+request.headers.get('CF-Connecting-IP')})).success,429,'Rate limited');
      const user=await supabaseSessionVerifier(env,fetcher)(request.headers.get('Authorization'));
      need((await limiter.limit({key:'enroll-owner:'+user.id})).success,429,'Rate limited');
      const body=await readBody(request);need(exact(body,['deviceId'])&&id(body.deviceId),400,'Invalid enrollment');
      const setupToken=random(32),keyId='controller-sync-v1';
      const result=await repository('device_enrollment_start',{p_user:user.id,p_device:body.deviceId,p_key:keyId,p_token_hash:await protectedHash(env,'device-enrollment',setupToken)});
      need(result?.id&&result?.keyId===keyId&&result?.expiresAt,503,'Enrollment unavailable');
      return json({deviceId:body.deviceId,keyId:result.keyId,setupToken,expiresAt:result.expiresAt});
    }
    need(url.pathname==='/device/enroll'&&request.method==='POST',404,'Not found');
    need(env.DEVICE_API_KEY_ENROLLMENT_ENABLED==='true',503,'Device enrollment is disabled');
    const body=await readBody(request);
    need(exact(body,['deviceId','keyId','setupToken','apiKey'])&&id(body.deviceId)&&id(body.keyId)&&token(body.setupToken)&&token(body.apiKey)&&unb64(body.apiKey).length===32,400,'Invalid enrollment');
    const limiter=env.TELEMETRY_RATE_LIMITER;need(limiter&&typeof limiter.limit==='function',503,'Enrollment unavailable');
    need((await limiter.limit({key:'enroll:'+request.headers.get('CF-Connecting-IP')})).success,429,'Rate limited');
    const accepted=await repository('device_api_key_enroll',{p_token_hash:await protectedHash(env,'device-enrollment',body.setupToken),p_device:body.deviceId,p_key:body.keyId,p_verifier:await apiKeyVerifier(env,body.deviceId,body.apiKey)});
    need(accepted===true,503,'Enrollment unavailable');
    return json({accepted:true,deviceId:body.deviceId,keyId:body.keyId});
  }catch(error){return json({error:error instanceof ApiError?error.message:'Enrollment unavailable'},error instanceof ApiError?error.status:503);}
}
