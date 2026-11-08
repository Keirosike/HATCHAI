// Host-only: no cloud credentials, hardware or external network calls.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function cloudChecks(){
  const records=new Map(), tokens=new Map();let deliveries=0, failSend=false;
  const state={key:'camera',async get(){return {data:()=>records.get('camera')};}};
  const collection={doc:key=>({async get(){return {exists:tokens.has(key)};},async set(data){tokens.set(key,data);},async delete(){tokens.delete(key);}}),
    count:()=>({get:async()=>({data:()=>({count:tokens.size})})}),
    where:()=>({limit:()=>({get:async()=>({empty:!tokens.size,docs:[...tokens.values()].map(data=>({data:()=>data,ref:{delete:async()=>{}}}))})})})};
  const db={doc:()=>state,collection:()=>collection,async runTransaction(fn){return fn({get:async()=>state.get(),set:(ref,data)=>records.set(ref.key,data),delete:ref=>records.delete(ref.key)});}};
  const mocks={
    'firebase-functions/v2/https':{onRequest:(_,fn)=>fn},
    'firebase-functions/params':{defineSecret:()=>({value:()=> 'a'.repeat(32)}),defineString:()=>({value:()=> 'owner'})},
    'firebase-admin/app':{initializeApp(){}},
    'firebase-admin/auth':{getAuth:()=>({verifyIdToken:async value=>({uid:value})})},
    'firebase-admin/firestore':{getFirestore:()=>db,FieldValue:{serverTimestamp:()=>0}},
    'firebase-admin/messaging':{getMessaging:()=>({sendEachForMulticast:async message=>{if(failSend)throw new Error('mock outage');deliveries+=message.tokens.length;return {responses:message.tokens.map(()=>({success:true})),successCount:message.tokens.length,failureCount:0};}})}
  };
  const context={exports:{},Buffer,console:{error(){},warn(){}},require:name=>mocks[name]||require(name)};
  vm.runInNewContext(fs.readFileSync(path.join(root,'functions/index.js'),'utf8'),context);
  async function call(fn,body={},headers={},method='POST'){
    const res={code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
    await context.exports[fn]({method,body,is:()=>true,get:key=>headers[key]},res);return res;
  }
  assert.equal((await call('chickDetected',{}, {},'GET')).code,405);
  assert.equal((await call('chickDetected',{eventId:'12345678-1'})).code,403);
  assert.equal((await call('registerPush',{token:'t'.repeat(30)},{Authorization:'Bearer stranger'})).code,403);
  assert.equal((await call('registerPush',{token:'t'.repeat(30)},{Authorization:'Bearer owner'})).code,200);
  const headers={'X-Camera-Key':'a'.repeat(32)};
  assert.equal((await call('chickDetected',{eventId:'bad'},headers)).code,400);
  assert.equal((await call('chickDetected',{eventId:'12345678-1'},headers)).body.delivered,1);
  await call('chickDetected',{eventId:'12345678-1'},headers);
  await call('chickDetected',{eventId:'12345678-2'},headers);
  assert.equal(deliveries,1,'duplicate and cooldown must not resend');
  records.clear();failSend=true;
  assert.equal((await call('chickDetected',{eventId:'12345678-3'},headers)).code,503);
  assert.equal(records.size,0,'failed delivery releases reservation for retry');
  failSend=false;assert.equal((await call('chickDetected',{eventId:'12345678-3'},headers)).body.delivered,1);
  await call('registerPush',{token:'t'.repeat(30),remove:true},{Authorization:'Bearer owner'});
  assert.equal(tokens.size,0);
  console.log('Cloud mocks passed: authentication, registration/removal, validation, duplicate/cooldown, failure/retry.');
}
async function browserChecks(){
  const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();let online=false,chick=false,detectorOk=true;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(()=>{sessionStorage.setItem('hatchaiClientId','test-token');localStorage.setItem('hatchaiActiveSession',JSON.stringify({token:'test-token',username:'test',expiresAt:Date.now()+3600000}));});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/camera')return route.fulfill({json:{online,chick,detectorOk,url:online?'http://192.168.1.42':''}});
      if(url.pathname.startsWith('/api/session/'))return route.fulfill({json:{ok:true,active:true}});
      if(url.host==='192.168.1.42')return route.fulfill({body:'Camera preview'});
      const file=path.join(root,'data',url.pathname);
      if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]});
      return route.fulfill({status:404});
    });
    await page.goto('http://hatchai.test/camera.html');
    await page.waitForFunction(()=>document.getElementById('cameraStatus').textContent.includes('offline'));
    assert.equal(await page.locator('#showCamera').isDisabled(),true);
    online=true;await page.clock.fastForward(5001);
    await page.waitForFunction(()=>!document.getElementById('showCamera').disabled);
    await page.locator('#showCamera').click();assert.equal(await page.locator('#cameraFrame').isVisible(),true);
    await page.locator('#showCamera').click();assert.equal(await page.locator('#cameraFrame').isVisible(),false);
    chick=true;await page.clock.fastForward(5001);
    await page.waitForFunction(()=>document.getElementById('cameraStatus').textContent.includes('Chick detected'));
    online=false;await page.clock.fastForward(5001);
    await page.waitForFunction(()=>document.getElementById('showCamera').disabled);
    assert.equal(await page.locator('#cameraFrame').getAttribute('src'),null);
    for(const width of [375,812,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    assert.deepEqual(errors,[]);
    const output=path.join(root,'release','camera-push-checks');fs.mkdirSync(output,{recursive:true});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:path.join(output,'camera-desktop.png'),fullPage:true});
    await page.setViewportSize({width:375,height:812});
    await page.screenshot({path:path.join(output,'camera-mobile.png'),fullPage:true});
    console.log('Camera browser mocks passed: offline/reconnect, preview show/hide, detection, disconnect, responsive widths and JS errors.');
    // The shared-account LCD pairing architecture supersedes the old Firebase Auth phone fixture.
    require('node:child_process').execFileSync(process.execPath,[path.join(root,'test/notification-pairing/browser-integration.cjs')],{stdio:'inherit',env:process.env});
  }finally{await browser.close();}
}
(async()=>{await cloudChecks();await browserChecks();})().catch(error=>{console.error(error);process.exitCode=1;});

