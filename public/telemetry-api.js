import {onlineApiUrl} from './online-api-settings.js';
export function validSample(sample){return sample&&typeof sample.sensorValid==='boolean'&&['heaterOn','lowerOn','upperOn','autoMode'].every(k=>typeof sample[k]==='boolean')&&sample.fanOn===null&&['upper','lower'].every(position=>(sample[position+'CameraOnline']===null||typeof sample[position+'CameraOnline']==='boolean')&&(sample[position+'CameraOnline']===true?typeof sample[position+'Chick']==='boolean':sample[position+'Chick']===null))&&(!sample.sensorValid?(sample.temperatureCenti===null&&sample.humidityCenti===null&&sample.sensorAgeMs===null):Number.isInteger(sample.temperatureCenti)&&sample.temperatureCenti>=-4000&&sample.temperatureCenti<=8000&&Number.isInteger(sample.humidityCenti)&&sample.humidityCenti>=0&&sample.humidityCenti<=10000&&Number.isInteger(sample.sensorAgeMs)&&sample.sensorAgeMs>=0&&sample.sensorAgeMs<20000);}
const timestamp=x=>typeof x==='string'&&x.length<=40&&Number.isFinite(Date.parse(x));
export function normalizeTelemetry(body,id){
 const aggregated=body?.historyKind==='utc-30-minute';
 const validPoint=p=>aggregated?timestamp(p.intervalStart)&&timestamp(p.intervalEnd)&&timestamp(p.finalizedAt)&&Date.parse(p.intervalEnd)-Date.parse(p.intervalStart)===1800000&&Number.isInteger(p.validCount)&&p.validCount>=1&&p.validCount<=360&&['partial','complete'].includes(p.completeness)&&Number.isFinite(p.averageTemperatureCenti)&&p.averageTemperatureCenti>=-4000&&p.averageTemperatureCenti<=8000&&Number.isFinite(p.averageHumidityCenti)&&p.averageHumidityCenti>=0&&p.averageHumidityCenti<=10000:timestamp(p.capturedAt)&&validSample(p.sample);
 if(!body||body.incubatorId!==id||typeof body.online!=='boolean'||!timestamp(body.serverTime)||!Array.isArray(body.history)||body.history.length>(aggregated?48:96)||!body.history.every(validPoint)||body.latest!==null&&(!timestamp(body.latest?.capturedAt)||!timestamp(body.latest?.receivedAt)||!validSample(body.latest?.sample)))throw new Error('Invalid telemetry response.');
 const age=body.latest?Math.max(Date.parse(body.serverTime)-Date.parse(body.latest.capturedAt),Date.parse(body.serverTime)-Date.parse(body.latest.receivedAt)):Infinity;
 const online=body.online&&body.latest!==null&&age>=-60000&&age<90000&&Date.parse(body.serverTime)-Date.parse(body.latest.capturedAt)>=-60000&&Date.parse(body.serverTime)-Date.parse(body.latest.receivedAt)>=-60000;
 return {online,connection:!body.latest?'unavailable':!online?'offline':age>=15000?'stale':'online',latest:body.latest,history:body.history,historyKind:aggregated?'utc-30-minute':'raw',alerts:Array.isArray(body.alerts)?body.alerts.filter(a=>a&&typeof a.kind==='string'&&a.kind.length<40&&['active','resolved'].includes(a.status)&&timestamp(a.createdAt)).slice(0,50):[],serverTime:body.serverTime};
}
// One reader per signed-in page: no token/subscription data persisted to disk.
// Render every 2 s, fetch at most every 5 s, and re-age cached data monotonically.
export function createTelemetryReader(localWorker=false,fetcher=fetch,clock=()=>performance.now()){
 let entry=null,pending=null,conditional={clock};
 return async(token,id)=>{
  const now=clock();
  if(entry&&entry.id===id&&entry.token===token&&now-entry.at<5000){const elapsed=Math.max(0,now-entry.at);return normalizeTelemetry({...entry.body,serverTime:new Date(Date.parse(entry.body.serverTime)+elapsed).toISOString()},id);}
  if(pending&&pending.id===id&&pending.token===token)return pending.promise;
  if(conditional.id!==id||conditional.token!==token){conditional={clock,id,token,etag:null,body:null};}
  const ticket={id,token};ticket.promise=readTelemetry(token,id,localWorker,fetcher,conditional).then(data=>{if(data)entry={id,token,at:clock(),body:{...data,incubatorId:id}};else entry=null;return data;}).finally(()=>{if(pending===ticket)pending=null;});pending=ticket;return ticket.promise;
 };
}
export async function readTelemetry(token,id,localWorker=false,fetcher=fetch,conditional=null){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid incubator.');
 try{const base=localWorker?'http://127.0.0.1:8787':onlineApiUrl;const response=await fetcher(base+'/online/incubators/'+id+'/telemetry',{headers:{Authorization:'Bearer '+token,...(conditional?.etag?{'If-None-Match':conditional.etag}:{})},cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(response.status===304&&conditional?.body){return normalizeTelemetry({...conditional.body,serverTime:new Date(Date.parse(conditional.body.serverTime)+Math.max(0,conditional.clock()-conditional.at)).toISOString()},id);}
 if(response.status===401||response.status===403)throw new Error('Sign in again to read telemetry.');if(!response.ok)return null;
 const reader=response.body?.getReader();if(!reader)return null;let length=0;const chunks=[];for(;;){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>65536){await reader.cancel();return null;}chunks.push(p.value);}const bytes=new Uint8Array(length);let offset=0;for(const p of chunks){bytes.set(p,offset);offset+=p.length;}const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(body.historyUnchanged){if(!conditional?.body||conditional.body.historyVersion!==body.historyVersion)return null;body.history=conditional.body.history;}
 const data=normalizeTelemetry(body,id);
 if(conditional){conditional.body=body;conditional.etag=response.headers.get('ETag');conditional.at=conditional.clock();}
 return data;
 }catch(error){if(error.message==='Sign in again to read telemetry.')throw error;return null;}
}

export async function readCameraEvents(token,id,localWorker=false,fetcher=fetch){try{if(!/^[0-9a-f-]{36}$/i.test(id))return [];const response=await fetcher((localWorker?'http://127.0.0.1:8787':onlineApiUrl)+'/online/incubators/'+id+'/camera-events',{headers:{Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)return [];const reader=response.body?.getReader();if(!reader)return [];let length=0;const chunks=[];for(;;){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>32768){await reader.cancel();return [];}chunks.push(p.value);}const bytes=new Uint8Array(length);let offset=0;for(const p of chunks){bytes.set(p,offset);offset+=p.length;}const body=JSON.parse(new TextDecoder().decode(bytes));return Array.isArray(body?.captures)&&body.captures.length<=50?body.captures:[];}catch{return [];}}
