// Headless Chrome, isolated storage and intercepted requests only. No cloud/hardware traffic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..');let checks=0;
const check=(ok,name)=>{assert.ok(ok,name);checks++;};
(async()=>{
  const {verifyBrowser}=await import('../../cloudflare-worker/src/security.js');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const local=await browser.newContext();const page=await local.newPage();let authenticated=false,starts=0,cancels=0;
    await page.addInitScript(()=>localStorage.setItem('hatchaiActiveSession',JSON.stringify({token:'isolated-session-token'})));
    await local.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname.startsWith('/api/notifications/')){
        if(!authenticated)return route.fulfill({status:401,json:{message:'Session required'}});
        check(route.request().headers()['x-hatchai-session']==='isolated-session-token','local session header required');
        check(!url.search,'no local credentials in URLs');if(url.pathname.endsWith('start'))starts++;if(url.pathname.endsWith('cancel'))cancels++;
        return route.fulfill({json:{state:'Idle',credentialsReady:true,utcReady:true,networkReady:true}});
      }
      if(url.host==='hatchai-8d34c.web.app')return route.fulfill({body:'HTTPS enrollment',contentType:'text/html'});
      if(url.pathname==='/notificationPairing.js')return route.fulfill({path:path.join(root,'data/js/notificationPairing.js'),contentType:'text/javascript'});
      return route.fulfill({body:'<main></main><script src="notificationPairing.js"></script>',contentType:'text/html'});
    });
    await page.goto('http://hatchai.test/');await page.waitForTimeout(100);check(await page.locator('dialog').count()===0,'no modal before server session verification');
    authenticated=true;await page.reload();await page.locator('dialog').waitFor({state:'visible'});
    check(await page.locator('#notificationLater').isVisible(),'Not Now available');
    const popup=page.waitForEvent('popup');await page.locator('#notificationEnable').click();const enrollment=await popup;
    await enrollment.waitForURL('https://hatchai-8d34c.web.app/');check(starts===1,'enable starts device pairing and opens HTTPS handoff');
    await page.locator('#notificationCancel').click();await page.waitForFunction(()=>document.getElementById('notificationState').textContent.includes('Idle'));
    check(cancels===1,'cancel uses authenticated route');await page.locator('#notificationLater').click();check(await page.locator('dialog').isVisible()===false,'modal dismissal works');
    await local.close();

    const context=await browser.newContext();const phone=await context.newPage();let pub,registers=0,unregisters=0,testSends=0,testFailure=false;const consoleText=[];
    phone.on('console',message=>consoleText.push(message.text()));
    const id='a'.repeat(43),grant='b'.repeat(43),nonce='c'.repeat(43),token='test-fcm-token-never-log-abcdefghijklmnopqrstuvwxyz';
    await phone.addInitScript(()=>{
      window.__permission='denied';window.__permissionCalls=0;window.__displays=[];
      Object.defineProperty(window,'Notification',{value:{get permission(){return window.__permission;},requestPermission:async()=>{window.__permissionCalls++;return window.__permission;}}});
      const registration={active:{},showNotification:async(title,options)=>window.__displays.push({title,...options})};
      Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,ready:Promise.resolve(registration)}});
      if(!window.PushManager)window.PushManager=function(){};
    });
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.host.endsWith('workers.dev')){
        check(!url.search,'no cloud credentials in URLs');const body=route.request().postDataJSON();
        if(url.pathname==='/pairing/redeem'){pub=body.publicKey;await verifyBrowser(pub,url.pathname,body);return route.fulfill({json:{pairingId:id,grant,expiresIn:300}});}
        await verifyBrowser(pub,url.pathname,body);
        if(url.pathname==='/register'){registers++;await new Promise(resolve=>setTimeout(resolve,100));return route.fulfill({json:{registered:true,registrationId:id,authorizedUntil:Math.floor(Date.now()/1000)+7776000}});}
        if(url.pathname==='/registration/challenge')return route.fulfill({json:{registrationId:id,nonce,version:0,expiresAt:Math.floor(Date.now()/1000)+60,authorizedUntil:Math.floor(Date.now()/1000)+7776000}});
        if(url.pathname==='/registration/refresh')return route.fulfill({json:{success:true}});
        if(url.pathname==='/registration/test-notification'){
          testSends++;check(!body.token&&!body.title&&!body.body,'test destination and content cannot be supplied by browser');
          return route.fulfill({status:testFailure?502:200,json:testFailure?{message:'provider details are not exposed'}:{accepted:true,displayConfirmed:false}});
        }
        if(url.pathname==='/unregister'){unregisters++;return route.fulfill({json:{success:true}});}
      }
      if(url.pathname==='/firebase-config.js')return route.fulfill({body:'export async function getHatchaiMessaging(){return {}}',contentType:'text/javascript'});
      if(url.host==='www.gstatic.com')return route.fulfill({body:`export async function getToken(){return ${JSON.stringify(token)}};export async function deleteToken(){return true};export function onMessage(m,callback){window.__onMessage=callback}`,contentType:'text/javascript'});
      const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
      if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:file.endsWith('.js')?'text/javascript':'text/html'});
      return route.fulfill({status:404});
    });
    await phone.goto('https://hatchai-8d34c.web.app/');await phone.waitForFunction(()=>!document.getElementById('redeem').disabled);
    check(await phone.locator('#enable').isDisabled(),'permission gated by pairing');check(await phone.evaluate(()=>window.__permissionCalls)===0,'permission not requested at startup');
    check(await phone.locator('#sendTest').isDisabled(),'test button disabled before verified registration');
    await phone.locator('#pairingCode').fill('ABCDEFGHIJKLMNOP');await phone.locator('#redeem').click();await phone.waitForFunction(()=>!document.getElementById('enable').disabled);
    check(await phone.locator('#pairingCode').inputValue()==='','LCD code cleared after redemption');
    check(await phone.locator('#sendTest').isDisabled(),'LCD redemption alone cannot enable a test');
    await phone.locator('#enable').click();await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('not allowed'));check(registers===0,'denial cannot register a token');
    await phone.evaluate(()=>window.__permission='granted');await phone.locator('#enable').click();
    check(!(await phone.locator('#status').textContent()).includes('securely registered'),'no premature storage success');
    await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('securely registered'));check(registers===1,'registration confirmed after server response');
    check(await phone.locator('#sendTest').isEnabled(),'test enabled after confirmed registration');
    await phone.locator('#sendTest').click();await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('FCM accepted'));
    check(testSends===1,'one explicit click sends one signed test');
    check((await phone.locator('#status').textContent()).includes('does not confirm Android displayed'),'acceptance does not claim display');
    await phone.evaluate(()=>window.__onMessage({data:{type:'hatchai-manual-test'},notification:{title:'HATCHAI Test Notification',body:'Your HATCHAI notification system is working.'}}));
    check((await phone.evaluate(()=>window.__displays))[0]?.body==='Your HATCHAI notification system is working.','foreground test displays exact body through service worker');
    await phone.evaluate(()=>window.__onMessage({data:{type:'chick-detected'},notification:{title:'Ignored'}}));
    check(await phone.evaluate(()=>window.__displays.length)===1,'foreground handler does not activate chick alerts');
    testFailure=true;await phone.locator('#sendTest').click();await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('unavailable'));
    check(testSends===2,'provider failure is not automatically retried');
    check(!(await phone.locator('#status').textContent()).includes('FCM accepted'),'provider failure cannot claim acceptance');
    for(const width of [375,812,1280]) {
      await phone.setViewportSize({width,height:900});
      check(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`notification test page fits ${width}px`);
    }
    check(await phone.locator('#sendTest').evaluate(el=>el.getBoundingClientRect().height>=44),'manual test has a touch-sized accessible button');
    check(await phone.evaluate(()=>localStorage.getItem('hatchaiPushToken'))===null,'FCM token not retained in localStorage');
    const nonExtractable=await phone.evaluate(async()=>{
      const {IndexedPairingStore}=await import('/pairing-client.js');const owner=await new IndexedPairingStore().get();
      try{await crypto.subtle.exportKey('jwk',owner.privateKey);return false;}catch{return owner.privateKey.extractable===false;}
    });check(nonExtractable,'actual IndexedDB private key cannot be exported');
    await phone.reload();await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('ownership verified'));
    check(await phone.locator('#enable').isEnabled(),'key ownership survives reload');
    await phone.locator('#disable').click();await phone.waitForFunction(()=>document.getElementById('status').textContent.includes('Cloud registration disabled'));
    check(unregisters===1,'signed per-browser unregistration');
    check(await phone.locator('#sendTest').isDisabled(),'unregistration disables manual test');
    check(!consoleText.some(text=>text.includes(token)||text.includes(grant)||text.includes('ABCDEFGHIJKLMNOP')),'no secrets in console');
    await context.close();console.log(`Notification browser integration: ${checks} checks passed.`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
