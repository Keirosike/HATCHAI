import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
const source=(await readFile(new URL('../public/native-push/client.js',import.meta.url),'utf8')).replace("import { onlineApiUrl } from '../online-api-settings.js';","const onlineApiUrl='https://worker.test';");
const {nativePushClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const serverKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
let installation=0;
function fixture(permission='default'){
  const calls=[];let sub=null,stored=false,prompts=0,denied=false,unregistered=0,offline=false,confirmed=true,conflict=false,revoked=false;
  const endpoint='https://fcm.googleapis.com/fcm/send/synthetic-browser-'+(++installation);
  const makeSub=()=>({endpoint,toJSON:()=>({endpoint,keys:{p256dh:'synthetic',auth:'synthetic'}}),unsubscribe:async()=>{sub=null;return true;}});
  const reg={update:async()=>{},scope:'https://myhatchai.web.app/native-push/',active:{scriptURL:'https://myhatchai.web.app/native-push/service-worker.js'},pushManager:{getSubscription:async()=>sub,subscribe:async()=>{sub=makeSub();return sub;}}};
  const firebase={scope:'https://myhatchai.web.app/',active:{scriptURL:'https://myhatchai.web.app/firebase-messaging-sw.js'},unregister:()=>unregistered++};
  const browser={isSecureContext:true,location:{origin:'https://myhatchai.web.app'},crypto:webcrypto,PushManager:{},Notification:{permission,requestPermission:async()=>{prompts++;return browser.Notification.permission=denied?'denied':'granted';}},navigator:{serviceWorker:{getRegistrations:async()=>conflict?[firebase,{...reg,active:{scriptURL:'https://myhatchai.web.app/native-push/other.js'}}]:[firebase,reg],register:async()=>reg}}};
  const fetcher=async(url,options)=>{calls.push({url,options});if(offline)throw Error('sensitive-network-detail');assert.equal(options.headers.Authorization,'Bearer synthetic-session');
    if(url.endsWith('public-key'))return Response.json({publicKey:serverKey});
    if(url.endsWith('/test'))return Response.json({accepted:confirmed,displayConfirmed:false,testId:'synthetic_test_000001'});
    if(url.endsWith('subscribe')&&!url.endsWith('unsubscribe')){stored=confirmed;return Response.json({registered:confirmed});}
    if(url.endsWith('unsubscribe')){stored=false;return Response.json({registered:false});}
    return Response.json({subscriptions:stored||revoked?[{endpointHash:createHash('sha256').update(endpoint).digest('hex'),enabled:stored&&!revoked}]:[]});};
  const client=nativePushClient({token:()=> 'synthetic-session',incubatorId:'test-incubator',browser,fetcher});
  return {client,browser,calls,get prompts(){return prompts;},get stored(){return stored;},get unregistered(){return unregistered;},seed(){sub=makeSub();},revoke(){revoked=true;stored=false;},deny(){denied=true;},offline(){offline=true;},unconfirmed(){confirmed=false;},conflict(){conflict=true;}};
}
test('permission is requested only by explicit enable; registration requires backend confirmation',async()=>{
  const f=fixture();assert.equal(await f.client.reconcile(),'Permission Required');assert.equal(f.prompts,0);
  assert.equal(await f.client.enable(),'Notifications Enabled');assert.equal(f.prompts,1);assert.equal(f.stored,true);assert.equal(f.unregistered,0);
  const bad=fixture();bad.unconfirmed();await assert.rejects(()=>bad.client.enable(),/not confirmed/);
});
test('denied and unsupported browsers never prompt or register',async()=>{
  const f=fixture('denied');assert.equal(await f.client.enable(),'Permission Denied');assert.equal(f.prompts,0);assert.equal(f.calls.length,0);
  delete f.browser.PushManager;assert.equal(await f.client.status(),'Browser Unsupported');
});
test('existing installation restores registration without another prompt; two devices register independently',async()=>{
  const a=fixture('granted'),b=fixture('granted');a.seed();b.seed();
  assert.equal(await a.client.reconcile(),'Notifications Enabled');assert.equal(await b.client.reconcile(),'Notifications Enabled');
  assert.equal(a.prompts+b.prompts,0);assert.equal(a.stored&&b.stored,true);
  assert.equal(await a.client.disable(),'Notifications Disabled');assert.equal(a.stored,false);assert.equal(b.stored,true);
});
test('native scope conflict never replaces Firebase; backend/network failures never become enabled',async()=>{
  const f=fixture('granted');f.conflict();await assert.rejects(()=>f.client.enable(),/Another service worker/);assert.equal(f.unregistered,0);
  const offline=fixture('granted');offline.offline();await assert.rejects(()=>offline.client.enable());assert.equal(offline.stored,false);
});
test('disposal and overlapping operations fail closed',async()=>{
  const f=fixture('granted');const first=f.client.enable();await assert.rejects(()=>f.client.enable(),/unavailable/);await first;
  f.client.dispose();await assert.rejects(()=>f.client.enable(),/unavailable/);
});
test('backend-disabled subscriptions are never reactivated by automatic reconciliation',async()=>{
  const f=fixture('granted');f.seed();f.revoke();assert.equal(await f.client.reconcile(),'Notifications Disabled');
  assert.equal(f.calls.filter(x=>x.url.endsWith('/subscribe')).length,0);assert.equal(f.prompts,0);
});

test('controlled test requires backend-confirmed registration and does not repeat permission prompts',async()=>{
 const f=fixture();await assert.rejects(()=>f.client.test(),/Enable notifications first/);
 await f.client.enable();const prompts=f.prompts;
 assert.match(await f.client.test(),/accepted by push service/);assert.equal(f.prompts,prompts);
 assert.ok(f.calls.length>0);
 f.unconfirmed();await assert.rejects(()=>f.client.test(),/not confirmed/);
});

test('device display check stays local and returns only bounded cloud-receipt metadata',async()=>{
 const f=fixture('granted');f.seed();
 const reg=(await f.browser.navigator.serviceWorker.getRegistrations()).find(r=>r.scope.endsWith('/native-push/'));
 const shown=[];reg.showNotification=async(...args)=>shown.push(args);
 reg.active.postMessage=(_message,ports)=>ports[0].postMessage({at:Date.now(),display:'shown',code:''});
 const result=await f.client.checkDisplay();assert.match(result,/Last cloud test: browser shown/);
 assert.equal(shown[0][0],'HATCHAI Device Display Check');assert.equal(f.calls.length,0);assert.equal(f.prompts,0);
 reg.showNotification=async()=>{throw new Error('private-runtime-detail');};
 assert.equal(await f.client.checkDisplay(),'Device display check failed. Browser or Android notification display is blocked.');
});

test('cloud test reports matched receipt and display failure without claiming provider acceptance proves display',async()=>{
 const f=fixture();await f.client.enable();
 const reg=(await f.browser.navigator.serviceWorker.getRegistrations()).find(r=>r.scope.endsWith('/native-push/'));
 reg.active.postMessage=(_message,ports)=>ports[0].postMessage({at:Date.now(),testId:'synthetic_test_000001',display:'shown'});
 assert.equal(await f.client.test(),'Cloud test RECEIVED on this device. Notification display was requested.');
 reg.active.postMessage=(_message,ports)=>ports[0].postMessage({at:Date.now(),testId:'synthetic_test_000001',display:'failed'});
 assert.equal(await f.client.test(),'Cloud test RECEIVED, but notification display FAILED on this device.');
});

test('direct bounded cache receipt works when service worker messaging is unavailable',async()=>{
 const f=fixture();await f.client.enable();let display='shown';
 f.browser.caches={open:async name=>{assert.equal(name,'hatchai-native-push-diagnostic-v1');return {
   match:async url=>{assert.equal(url,'https://myhatchai.web.app/native-push/__last-test-receipt');return Response.json({at:Date.now(),testId:'synthetic_test_000001',display});}
 };}};
 assert.equal(await f.client.test(),'Cloud test RECEIVED on this device. Notification display was requested.');
 display='failed';assert.equal(await f.client.test(),'Cloud test RECEIVED, but notification display FAILED on this device.');
});

test('existing native worker is explicitly updated before test without touching Firebase',async()=>{
 const f=fixture();await f.client.enable();let updates=0;
 const reg=(await f.browser.navigator.serviceWorker.getRegistrations()).find(r=>r.scope.endsWith('/native-push/'));
 reg.update=async()=>{updates++;};
 await f.client.test();assert.equal(updates,1);assert.equal(f.unregistered,0);
});
