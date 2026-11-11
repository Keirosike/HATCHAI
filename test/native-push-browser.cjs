// Real headless Chrome UI; PushManager, permissions and cloud APIs are mocked.
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),checks=[];const check=(x,m)=>{assert.ok(x,m);checks.push(m);};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/fixture')return res.end('<!doctype html><link rel="stylesheet" href="/shared/css/base.css"><link rel="stylesheet" href="/shared/css/modal.css"><main id="host"></main>');
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.prompts=0;window.registered=false;window.replacements=0;window.permission='default';
      Object.defineProperty(window,'Notification',{value:{get permission(){return window.permission;},requestPermission:async()=>{window.prompts++;return window.permission='granted';}}});
      Object.defineProperty(window,'PushManager',{value:function(){}});
      const endpoint='https://fcm.googleapis.com/fcm/send/browser-fixture';let sub=null;
      const registration={update:async()=>{},scope:location.origin+'/native-push/',active:{scriptURL:location.origin+'/native-push/service-worker.js'},pushManager:{getSubscription:async()=>sub,subscribe:async()=>sub={endpoint,toJSON:()=>({endpoint,keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{sub=null;return true;}}}};
      Object.defineProperty(navigator,'serviceWorker',{value:{getRegistrations:async()=>[{scope:location.origin+'/',active:{scriptURL:location.origin+'/firebase-messaging-sw.js'},unregister:()=>window.replacements++},registration],register:async()=>registration}});
    });
    let subscribe=0,unsub=0;
    await context.route('https://hatchai.kurtzidrickguno-robles.workers.dev/**',async route=>{
      const req=route.request(),url=new URL(req.url());const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST'};
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
      check(req.headers().authorization==='Bearer browser-fixture-token','API request uses authenticated in-memory session');
      let json={subscriptions:[]};if(url.pathname.endsWith('public-key'))json={publicKey:btoa(String.fromCharCode(4)+String.fromCharCode(1).repeat(64)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')};
      else if(url.pathname.endsWith('/subscribe')){subscribe++;json={registered:true};}else if(url.pathname.endsWith('/unsubscribe')){unsub++;json={registered:false};}
      return route.fulfill({json,headers});
    });
    await page.goto(origin+'/fixture');await page.evaluate(async()=>{const {mountNotifications}=await import('/native-push/modal.js');window.cleanup=await mountNotifications({auth:{accessToken:()=> 'browser-fixture-token',userId:()=> 'fixture-user'},incubatorId:'87ce3cf3-a455-4bc3-a7bb-049882d985fa',localWorker:false,host:document.getElementById('host')});});
    check(await page.evaluate(()=>window.prompts)===0,'mount and reconciliation never request permission');
    check(await page.locator('#confirmModal').getAttribute('aria-hidden')==='false','first authenticated mount opens onboarding without permission');
    check(await page.locator('.modal-actions button').count()===2,'only Enable and Disable are in the bottom action area');
    check(await page.getByRole('button',{name:'Send Test Notification',exact:true}).count()===0,'Settings has no test action');
    await page.getByRole('button',{name:'Enable Notifications',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('host').textContent.includes('Notifications Enabled'));
    check(subscribe===1,'one explicit enable automatically registers this browser');check(await page.evaluate(()=>window.prompts)===1,'permission asked only on click');
    check(await page.locator('#pushModalStatus').textContent()==='Notifications Enabled','modal shows confirmed enabled state');
    for(const width of [375,812,1280]){await page.setViewportSize({width,height:812});const box=await page.locator('.modal-card').boundingBox();check(box.x>=0&&box.x+box.width<=width,'modal fits '+width+'px');const close=await page.locator('#modalCancelBtn').boundingBox();check(close.x>box.x+box.width/2&&close.y<box.y+40,'close icon is upper-right '+width+'px');}
    await page.getByRole('button',{name:'Disable Notifications',exact:true}).click();await page.waitForFunction(()=>document.getElementById('host').textContent.includes('Notifications Disabled'));check(unsub===1,'disable removes only this browser registration');
    await page.keyboard.press('Escape');check(await page.locator('#confirmModal').getAttribute('aria-hidden')==='true','Escape closes shared modal');
    check(await page.evaluate(()=>window.replacements)===0,'Firebase registration is never overwritten or unregistered');
    await page.evaluate(()=>{window.permission='denied';window.cleanup();});
    await page.evaluate(async()=>{const {mountNotifications}=await import('/native-push/modal.js');window.cleanup=await mountNotifications({auth:{accessToken:()=> 'browser-fixture-token',userId:()=> 'fixture-user'},incubatorId:'87ce3cf3-a455-4bc3-a7bb-049882d985fa',host:document.getElementById('host')});});
    check(await page.locator('#confirmModal').getAttribute('aria-hidden')==='true','completed per-account onboarding does not reopen');
    await page.getByRole('button',{name:'Notifications',exact:true}).click();check(await page.getByRole('button',{name:'Enable Notifications',exact:true}).isDisabled(),'denied permission disables repeated prompting');
    check(await page.locator('#pushModalStatus').textContent().then(x=>x.includes('site settings')),'denied permission explains browser settings');
    check(errors.length===0,'no browser JavaScript errors');console.log(JSON.stringify({passed:checks.length,scope:'Chrome UI with mocked Push APIs and backend',checks},null,2));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);server.close();process.exitCode=1;});
