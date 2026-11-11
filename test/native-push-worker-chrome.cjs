// Real isolated Chrome service worker. CDP injects a local push event; this is
// NOT an FCM/Android transport test and never contacts a live push provider.
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core');
const {readFileSync}=require('node:fs');const http=require('node:http');const assert=require('node:assert/strict');
const source=readFileSync(require('node:path').join(__dirname,'../public/native-push/service-worker.js'));
let served=Buffer.from("self.addEventListener('push',()=>{}); // Older worker has no native-test handler");
const server=http.createServer((req,res)=>{
  if(req.url==='/native-push/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');return res.end(served);}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated native worker test</title>');
});
async function until(read,label){const deadline=Date.now()+10000;while(Date.now()<deadline){const result=await read();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
  try{
    const context=await browser.newContext();await context.grantPermissions(['notifications'],{origin});
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    const page=await context.newPage(),cdp=await context.newCDPSession(page);let registrationId;const errors=[];
    cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{for(const r of registrations)if(r.scopeURL===origin+'/native-push/')registrationId=r.registrationId;});
    cdp.on('ServiceWorker.workerErrorReported',e=>errors.push(e.errorMessage.errorMessage));
    await cdp.send('ServiceWorker.enable');await page.goto(origin+'/outside-scope');
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/native-push/service-worker.js',{scope:'/native-push/',updateViaCache:'none'});});
    await until(()=>page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/native-push/');return reg?.active?.state==='activated';}),'initial worker activation');
    served=source;
    await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/native-push/');window.oldWorker=reg.active;await reg.update();});
    await until(()=>page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/native-push/');return reg?.active!==window.oldWorker&&reg?.active?.state==='activated'&&!reg.installing&&!reg.waiting;}),'updated worker activation');
    for(let i=0;i<100&&!registrationId;i++)await new Promise(r=>setTimeout(r,50));assert.ok(registrationId);
    const eventId='synthetic_real_chrome_00001';
    await cdp.send('ServiceWorker.deliverPushMessage',{origin,registrationId,data:JSON.stringify({type:'hatchai-native-test',eventId})});
    const result=await until(()=>page.evaluate(async()=>{const cache=await caches.open('hatchai-native-push-diagnostic-v1');const r=await cache.match(new URL('/native-push/__last-test-receipt',location.origin));if(!r)return null;const receipt=await r.json();if(receipt.display!=='shown')return null;const reg=await navigator.serviceWorker.getRegistration('/native-push/');return {receipt,titles:(await reg.getNotifications()).map(n=>n.title)};}),'matching receipt');
    assert.equal(result.receipt.testId,eventId);assert.ok(result.titles.includes('HATCHAI Test Notification'));assert.deepEqual(errors,[]);
    console.log('PASS: real Chrome upgrades an older native worker, receives a simulated local push, requests notification display and persists a matching receipt outside its scope. No cloud or Android delivery claimed.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);server.close();process.exitCode=1;});
