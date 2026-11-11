import assert from 'node:assert/strict';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';import {productionBundle,productionCompatibility} from './runtime-config.mjs';
const id='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',origin='https://myhatchai.web.app';let calls=0;
const mf=new Miniflare(convertV4MiniflareOptions({...await productionBundle(),...productionCompatibility(),bindings:{TELEMETRY_ENABLED:'true',TELEMETRY_ROLLUPS_ENABLED:'true',TELEMETRY_ALERTS_ENABLED:'true',SUPABASE_URL:'https://dihufafcztqjuudjeqdm.supabase.co',SUPABASE_BACKEND_KEY:'sb_secret_mock_runtime_only',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock_runtime_only',ONLINE_ALLOWED_ORIGINS:origin},ratelimits:{TELEMETRY_RATE_LIMITER:{namespace_id:'834318',simple:{limit:20,period:60}}},outboundService:async request=>{
 calls++;const url=new URL(request.url);assert.equal(url.origin,'https://dihufafcztqjuudjeqdm.supabase.co');
 if(url.pathname==='/auth/v1/user')return Response.json({id:user,role:'authenticated'});
 assert.equal(request.headers.get('apikey'),'sb_secret_mock_runtime_only');assert.equal(request.headers.get('Authorization'),null);
 const args=await request.json();assert.equal(args.p_user,user);assert.equal(args.p_incubator,id);
 if(url.pathname.endsWith('hatchai_alert_read'))return Response.json({alerts:[]});
 assert.ok(url.pathname.endsWith('hatchai_sync_read_v2'));
 return Response.json({incubatorId:id,serverTime:new Date().toISOString(),online:false,connection:'unavailable',latest:null,historyKind:'utc-30-minute',historyVersion:'a'.repeat(32),historyUnchanged:false,history:[]});
}}));
try{
 const url='https://worker/online/incubators/'+id+'/telemetry',headers={Origin:origin,Authorization:'Bearer '+'a'.repeat(40)};
 assert.equal((await mf.dispatchFetch(url,{headers:{Origin:origin}})).status,401);
 const pre=await mf.dispatchFetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization, If-None-Match'}});assert.equal(pre.status,204);
 const r=await mf.dispatchFetch(url,{headers});assert.equal(r.status,200);assert.equal((await r.json()).historyKind,'utc-30-minute');assert.ok(r.headers.get('ETag'));
 const before=calls;const conditional=await mf.dispatchFetch(url,{headers:{...headers,'If-None-Match':r.headers.get('ETag')}});assert.equal(conditional.status,304);assert.ok(calls>before); // ownership checked even for 304
 assert.equal((await mf.dispatchFetch(url,{headers:{...headers,Origin:'https://foreign.invalid'}})).status,403);
 console.log('PASS: 5 isolated rollup/alert runtime requests; production compatibility date, backend-only RPCs, CORS, auth and ownership-before-304.');
}finally{await mf.dispose();}
