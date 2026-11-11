import {ApiError,need} from './security.js';
import {boundedJson} from './native-push.js';
import {sendNativeAlert} from './native-push-delivery.js';
export const alertKinds=Object.freeze(['temperature_high','temperature_critical','temperature_low','humidity_high','humidity_low','sensor_failure','sensor_stale','controller_offline']);
export function alertRepository(env,fetcher=fetch){return async(operation,args={})=>{
 need(env.SUPABASE_URL==='https://dihufafcztqjuudjeqdm.supabase.co'&&/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY||''),503,'Alert service unavailable');
 const r=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/hatchai_alert_'+operation,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{apikey:env.SUPABASE_BACKEND_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
 need(r.ok,r.status===403?403:503,'Alert service unavailable');return boundedJson(r,32768);
};}
export async function dispatchAlert(env,dependencies={}){
 if(env.TELEMETRY_ENABLED!=='true'||env.TELEMETRY_ROLLUPS_ENABLED!=='true'||env.TELEMETRY_ALERTS_ENABLED!=='true'||env.NATIVE_PUSH_DELIVERY_ENABLED!=='true')return {processed:false};
 const repository=dependencies.repository??alertRepository(env),send=dependencies.send??((sub,event)=>sendNativeAlert(env,sub,event));
 const job=await repository('claim');if(!job)return {processed:false};
 need(typeof job.leaseId==='string'&&Number.isInteger(job.attempt)&&job.attempt>=1&&job.attempt<=3,503,'Invalid alert claim');
 let result;try{result=await send(job.subscription,job.event);}catch{result={outcome:'unknown'};}
 const outcomes=['accepted','expired','failed','unknown','retryable','disabled','unconfigured'];const outcome=outcomes.includes(result?.outcome)?result.outcome:'unknown';
 const retry=outcome==='retryable'?new Date(Date.now()+Math.max(1000,typeof result.retryAfterMs==='number'?result.retryAfterMs:30000)).toISOString():null;
 const keys=job.subscription?.keys??{};
 need(await repository('finish',{p_lease:job.leaseId,p_outcome:outcome,p_retry:retry,p_endpoint:job.subscription?.endpoint??null,p_p256dh:keys.p256dh??null,p_auth:keys.auth??null})===true,503,'Alert result unconfirmed');
 return {processed:true,outcome};
}
