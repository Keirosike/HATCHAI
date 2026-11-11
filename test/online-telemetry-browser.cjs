// Synthetic cloud data only. No real account, device, or notification access.
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE || 'playwright-core');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../public'),id='87ce3cf3-a455-4bc3-a7bb-049882d985fa';let reads=0,stale=false;
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://dihufafcztqjuudjeqdm.supabase.co/**',r=>r.fulfill({json:r.request().url().includes('/token')?{access_token:'synthetic-access-'.repeat(5),token_type:'bearer',expires_in:3600}:{id:'00000000-0000-4000-8000-000000000001',role:'authenticated'}}));
await page.route('https://hatchai.kurtzidrickguno-robles.workers.dev/**',async r=>{
const url=new URL(r.request().url());if(url.pathname.endsWith('/telemetry')){
reads++;const now=Date.now(),captured=new Date(now-(stale?20000:0)).toISOString(),end=Math.floor(now/1800000)*1800000-1800000;
return r.fulfill({json:{incubatorId:id,serverTime:new Date(now).toISOString(),online:true,connection:stale?'stale':'online',latest:{capturedAt:captured,receivedAt:captured,sample:{sensorValid:true,temperatureCenti:3720,humidityCenti:5500,sensorAgeMs:100,fanOn:null,heaterOn:true,lowerOn:false,upperOn:false,autoMode:true,upperCameraOnline:null,lowerCameraOnline:null,upperChick:null,lowerChick:null}},historyKind:'utc-30-minute',historyVersion:'a'.repeat(32),historyUnchanged:false,history:[{intervalStart:new Date(end-1800000).toISOString(),intervalEnd:new Date(end).toISOString(),finalizedAt:new Date(now).toISOString(),averageTemperatureCenti:3710,averageHumidityCenti:5450,validCount:300,completeness:'partial'}]}});
}
if(url.pathname==='/online/incubators')return r.fulfill({json:{incubators:[{id,device_name:'Synthetic incubator',device_id:'hatchai-inc01-controller',status:null}]}});
return r.fulfill({json:{subscriptions:[]}});
});
await page.goto('http://127.0.0.1:'+server.address().port+'/online-login.html');await page.locator('#email').fill('synthetic@example.test');await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
await page.locator('#confirmModal.active').waitFor();await page.locator('#modalCancelBtn').click();
await page.waitForFunction(()=>document.getElementById('tempValue')?.textContent.includes('37.2'));
assert.ok((await page.locator('#humidityValue').textContent()).includes('55.0'));assert.ok((await page.locator('#chartStatus').textContent()).includes('30-minute UTC averages'));assert.ok((await page.locator('#relayValue').textContent()).includes('ON'));
stale=true;await page.waitForFunction(()=>document.getElementById('wifiStatus')?.textContent==='Stale',{},{timeout:12000});
assert.ok((await page.locator('#tempValue').textContent()).includes('Unavailable'));assert.ok(reads<=4);assert.deepEqual(errors,[]);
console.log('PASS: 7 synthetic online browser checks: readings, humidity, output status, UTC averages/gaps, stale hiding, bounded polling and no page errors.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
