import test from 'node:test';import assert from 'node:assert/strict';import {normalizeTelemetry,readTelemetry,readCameraEvents,createTelemetryReader} from '../public/telemetry-api.js';
const id='00000000-0000-4000-8000-000000000001',now=new Date().toISOString();const sample={sensorValid:true,temperatureCenti:3750,humidityCenti:5500,sensorAgeMs:100,fanOn:null,heaterOn:true,lowerOn:false,upperOn:false,autoMode:true,upperCameraOnline:true,lowerCameraOnline:false,upperChick:true,lowerChick:null};const body=()=>({incubatorId:id,serverTime:now,online:true,latest:{capturedAt:now,receivedAt:now,sample:{...sample}},history:[{capturedAt:now,sample:{...sample}}]});
test('telemetry accepts current measured data and rejects fabricated fan/camera values',()=>{assert.equal(normalizeTelemetry(body(),id).online,true);for(const patch of [{fanOn:true},{upperCameraOnline:'yes'},{lowerChick:true}]){const b=body();Object.assign(b.latest.sample,patch);assert.throws(()=>normalizeTelemetry(b,id));}});
test('stale, future and wrong-owner telemetry never appears live',()=>{const b=body();b.latest.capturedAt=new Date(Date.now()-91000).toISOString();assert.equal(normalizeTelemetry(b,id).online,false);b.latest.capturedAt=new Date(Date.now()+120000).toISOString();assert.equal(normalizeTelemetry(b,id).online,false);assert.throws(()=>normalizeTelemetry(body(),'another'));});
test('REST adapter uses HTTPS and user token only, fails closed on denied or oversized data',async()=>{assert.equal((await readTelemetry('synthetic',id,false,async(url,options)=>{assert.ok(url.startsWith('https://hatchai.'));assert.equal(options.headers.Authorization,'Bearer synthetic');assert.equal(options.credentials,'omit');return Response.json(body());})).online,true);for(const status of [401,403])await assert.rejects(()=>readTelemetry('synthetic',id,false,async()=>new Response(null,{status})),/Sign in again/);assert.equal(await readTelemetry('synthetic',id,false,async()=>new Response('x'.repeat(65537))),null);});
test('camera history failure does not invent captures or expose a private stream',async()=>{assert.deepEqual(await readCameraEvents('synthetic',id,false,async()=>new Response(null,{status:503})),[]);});

test('UTC averages validate without pretending historical relay states exist',()=>{
 const b=body();b.historyKind='utc-30-minute';b.history=[{intervalStart:'2026-11-10T00:00:00Z',intervalEnd:'2026-11-10T00:30:00Z',finalizedAt:'2026-11-10T00:40:00Z',averageTemperatureCenti:3750.25,averageHumidityCenti:5500,validCount:300,completeness:'partial'}];
 assert.equal(normalizeTelemetry(b,id).historyKind,'utc-30-minute');b.history[0].validCount=361;assert.throws(()=>normalizeTelemetry(b,id));
});
test('two-second renders reuse a bounded five-second session cache and re-age stale samples',async()=>{
 let calls=0,clock=0;const b=body();b.latest.capturedAt=new Date(Date.parse(b.serverTime)-14000).toISOString();
 const reader=createTelemetryReader(false,async()=>{calls++;return Response.json(b);},()=>clock);
 assert.equal((await reader('synthetic',id)).connection,'online');clock=2000;
 assert.equal((await reader('synthetic',id)).connection,'stale');assert.equal(calls,1);clock=5000;
 await reader('synthetic',id);assert.equal(calls,2);await reader('other-session',id);assert.equal(calls,3);
});
