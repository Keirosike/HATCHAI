// Browser + actual shared renderer/adapters; every cloud/device destination is intercepted.
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),origin='https://sync-isolated.test';
const id='87ce3cf3-a455-4bc3-a7bb-049882d985fa';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[],forbidden=[];let mode='online',reads=0,accountReads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('hatchai_batches',JSON.stringify([{id:'private-local-batch',name:'Private local batch',status:'Active',startDate:'2026-11-01'}])));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin==='https://dihufafcztqjuudjeqdm.supabase.co'){
    if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:'isolated-owner-token-'.repeat(4),token_type:'bearer',expires_in:3600}});
    if(url.pathname==='/auth/v1/user')return route.fulfill({json:{id:'00000000-0000-4000-8000-000000000001',role:'authenticated'}});
    if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
   }
   if(url.origin==='https://hatchai.kurtzidrickguno-robles.workers.dev'){
    assert.equal(req.method(),'GET');
    assert.match(req.headers().authorization||'',/^Bearer isolated-owner-token-/);
    if(url.pathname==='/online/incubators'){accountReads++;return route.fulfill({json:{incubators:[{id,device_name:'Isolated owner incubator',device_id:'hatchai-inc01-controller'}]}});}
    if(url.pathname.endsWith('/telemetry')){
     reads++;
     if(mode==='denied')return route.fulfill({status:403,json:{error:'Incubator access denied'}});
     if(mode==='network')return route.abort();
     const now=Date.now(),stamp=new Date(now-(mode==='stale'?20000:0)).toISOString();
     const sample={sensorValid:true,temperatureCenti:3720,humidityCenti:5500,sensorAgeMs:100,heaterOn:true,fanOn:null,lowerOn:false,upperOn:false,autoMode:true,upperCameraOnline:null,lowerCameraOnline:null,upperChick:null,lowerChick:null};
     return route.fulfill({json:{incubatorId:id,serverTime:new Date(now).toISOString(),online:true,
      latest:{capturedAt:stamp,receivedAt:stamp,sample},history:[{capturedAt:new Date(now-5000).toISOString(),sample},{capturedAt:stamp,sample}]}});
    }
    if(url.pathname==='/online/push/status')return route.fulfill({json:{subscriptions:[]}});
   }
   if(url.origin===origin){
    const file=path.resolve(root,'.'+url.pathname);
    if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(file)]});
   }
   forbidden.push(url.origin+url.pathname);return route.abort();
  });
  console.log('Opening isolated online login');
  await page.goto(origin+'/online-login.html');
  await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
  console.log('Waiting for signed-in shared dashboard');
  await page.locator('#confirmModal.active').waitFor();await page.locator('#modalCancelBtn').click();
  await page.waitForFunction(()=>document.getElementById('tempValue').textContent.includes('37.2'));
  const painted=()=>page.locator('#environmentChart').evaluate(canvas=>{
   const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;
   for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&(pixels[i]<240||pixels[i+1]<240||pixels[i+2]<240))count++;
   return count;
  });
  console.log('Authorized history loaded');
  assert.ok(await painted()>0,'authorized history is drawn');
  assert.equal(await page.locator('#activeBatchValue').textContent(),'Unavailable');
  assert.equal(await page.locator('#hatchDayValue').textContent(),'Unavailable');
  assert.ok(await page.locator('#refreshIncubator').isVisible(),'manual refresh is reachable');
  mode='denied';
  await page.waitForFunction(()=>document.getElementById('safetyBanner').textContent.includes('Sign in again'),{},{timeout:15000});
  assert.equal(await page.locator('#tempValue').textContent(),'Unavailable');
  assert.equal(await painted(),0,'access denial must clear prior owner history from the canvas');
  mode='online';await page.waitForFunction(()=>document.getElementById('tempValue').textContent.includes('37.2'),{},{timeout:12000});
  assert.ok(await painted()>0,'authorized recovery restores real history');
  const before=accountReads;
  await page.locator('#refreshIncubator').click();await page.waitForFunction(()=>!document.getElementById('refreshIncubator').disabled);
  assert.ok(accountReads>before,'manual refresh rechecks ownership immediately');
  mode='stale';await page.waitForFunction(()=>document.getElementById('wifiStatus').textContent==='Stale',{},{timeout:12000});
  assert.equal(await page.locator('#tempValue').textContent(),'Unavailable');
  mode='network';await page.waitForFunction(()=>document.getElementById('wifiStatus').textContent==='Unavailable',{},{timeout:12000});
  assert.equal(await painted(),0,'network failure cannot leave an unlabeled prior chart');
  assert.ok((await page.locator('#safetyBanner').textContent()).includes('Retrying automatically'));
  mode='online';await page.waitForFunction(()=>document.getElementById('tempValue').textContent.includes('37.2'),{},{timeout:12000});
  for(const name of ['updateControl','turnEggsNow','stopEggs','syncBatch','predictBatch']){
   await page.evaluate(async name=>{
    const adapter=HatchDashboardAdapters.online({accessToken:()=>{throw Error('unexpected network');},readIncubators:()=>{throw Error('unexpected network');}});
    try{await adapter[name]();throw Error('write unexpectedly allowed');}catch(e){if(!e.message.includes('unavailable in online monitoring'))throw e;}
   },name);
  }
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  assert.ok(await page.evaluate(()=>localStorage.getItem('hatchai_batches').includes('Private local batch')));
  assert.ok(await page.evaluate(()=>!JSON.stringify({...localStorage,...sessionStorage}).includes('isolated-owner-token-')));
  assert.ok(reads<20,'polling remains bounded');assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  console.log('PASS: isolated online owner-loss/chart clearing, immediate ownership refresh, stale/offline recovery, bounded polling and read-only operations.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
