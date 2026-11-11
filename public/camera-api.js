import {onlineApiUrl} from './online-api-settings.js';
const uuid=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
async function request(token,incubator,suffix,localWorker,fetcher){
  if(!uuid(incubator))throw Error('Invalid incubator.');
  const response=await fetcher((localWorker?'http://127.0.0.1:8787':onlineApiUrl)+'/online/incubators/'+incubator+'/captures'+suffix,{headers:{Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(response.status===401||response.status===403)throw Error('Sign in again to view captures.');
  return response;
}
async function bytes(response,maximum){const reader=response.body?.getReader();if(!reader)throw Error('Capture unavailable.');const parts=[];let length=0;try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>maximum)throw Error('Capture exceeds limit.');parts.push(p.value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}const data=new Uint8Array(length);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return data;}
export async function readCaptures(token,incubator,localWorker=false,fetcher=fetch){
  try{const response=await request(token,incubator,'',localWorker,fetcher);if(!response.ok)return [];const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,16384)));
    if(!Array.isArray(body?.captures)||body.captures.length>50)throw Error('Invalid capture response.');
    return body.captures.map(value=>{if(!uuid(value.id)||!['upper','lower'].includes(value.position)||typeof value.capturedAt!=='string'||value.capturedAt.length>40||!Number.isFinite(Date.parse(value.capturedAt))||value.chick!==true)throw Error('Invalid capture response.');return {id:value.id,position:value.position,capturedAt:value.capturedAt,chick:true};});
  }catch(error){if(error.message==='Sign in again to view captures.')throw error;return [];}
}
export async function readCaptureImage(token,incubator,id,localWorker=false,fetcher=fetch){
  if(!uuid(id))throw Error('Invalid capture.');const response=await request(token,incubator,'/'+id,localWorker,fetcher);
  if(!response.ok||response.headers.get('Content-Type')!=='image/jpeg')throw Error('Capture unavailable.');
  const data=await bytes(response,131072);if(data.length<4||data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)throw Error('Invalid capture image.');
  return new Blob([data],{type:'image/jpeg'});
}
