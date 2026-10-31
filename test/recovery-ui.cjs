// Isolated browser checks; all device endpoints are mocked. No hardware is contacted.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HATCH_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..','data'),checks=[];
const check=(ok,message)=>{assert.ok(ok,message);checks.push(message);};
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return response.writeHead(404).end();
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.woff2':'font/woff2'};
  response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});fs.createReadStream(file).pipe(response);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({timezoneId:'Asia/Manila',viewport:{width:1280,height:900}});
    const page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install({time:new Date('2026-10-21T04:00:00Z')});
    await page.addInitScript(()=>{
      sessionStorage.setItem('hatchaiClientId','recovery-test');
      localStorage.setItem('hatchaiActiveSession',JSON.stringify({token:'recovery-test',username:'test',expiresAt:Date.now()+3600000}));
    });
    const start=Date.UTC(2026,9,10,14,30)/1000,end=start+17*86400;
    const state={temperature:37.5,humidity:55,sensorValid:true,sensorAgeSeconds:1,sensorStatus:'Connected',wifiStatus:'Connected',
      rtcTime:'RTC unavailable',clockStatus:'Waiting for automatic clock sync',clockSyncNeeded:true,lcdStatus:'I2C responding',
      relayPins:{bulb:27,fan:14,turner:25,turner2:26},
      control:{autoMode:true,manualBulbOn:false,manualFanOn:true,bulbOn:false,fanOn:true,turnerOn:false,turner2On:false,
        temperatureOffset:0,targetTemperature:37.5,targetHumidity:55,turnDurationSeconds:15,turnDuration2Seconds:15,
        turnIntervalMinutes:120,turnInterval2Minutes:120,heaterControl:'thermostat_hysteresis',heaterDutyPercent:null,heaterOnBelow:37.2,heaterOffAbove:37.8},
      safety:{version:2,sensorReady:true,storageReady:true,watchdogReady:true,critical:false,canAcknowledge:false,
        resetAckRequired:false,rtcTrusted:false,turningArmed:true,message:'Waiting for automatic clock sync',
        batches:[1,2].map(motor=>({motor,batchId:'saved-both',label:'BOTH-FLOCK',name:'Shared chicken flock',eggCount:24,
          startEpoch:start,turningEndEpoch:end,durationDays:21,batchStatus:'Active',active:true,canRun:false,
          positionHold:false,incubationDay:11,status:'Waiting for recovery'}))},
      recovery:{version:1,ready:false,sdAvailable:true,logging:true,commitActive:false,checkpointPending:false,
        checkpointFault:false,sequence:0,positionHoldMask:0,message:'Preparing automatic save'}};
    let active=0,maxActive=0,offline=false,clockReject=false;
    await page.route('**/scan-wifi*',route=>route.fulfill({json:{networks:[],scanning:false}}));
    await page.route('**/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.startsWith('/api/session/'))return route.fulfill({json:{ok:true,active:true}});
      if(endpoint==='/api/wifi/status')return route.fulfill({json:{connected:true,ssid:'Test network',connectionState:'connected'}});
      active++;maxActive=Math.max(active,maxActive);
      try {
        if(offline)return await route.fulfill({status:503,json:{message:'ESP32 unavailable'}});
        const body=Object.fromEntries(new URLSearchParams(route.request().postData()||''));
        if(endpoint==='/api/safety') {
          writes.push(body);check(body.token==='recovery-test','Automatic/exception action carries the active session token');
          if(body.action==='clockAuto') {
            if(clockReject)return await route.fulfill({status:409,json:{message:'Clock older than durable recovery time'}});
            state.clockSyncNeeded=false;state.rtcTime=body.dateTime.replace('T',' ');state.clockStatus='Ready';
            state.safety.rtcTrusted=true;state.safety.message='Temperature safety checks passed';
          } else if(body.action==='recoveryInitialize') {
            check(state.recovery.canRebuild,'Repair is offered only for firmware-approved invalid snapshots');
            state.recovery.canRebuild=false;state.recovery.ready=false;state.recovery.checkpointPending=true;
            state.recovery.message='Saving reviewed device settings and original batch dates';
          } else if(body.action==='positionVerified') {
            const i=Number(body.motor)-1;state.recovery.positionHoldMask&=~(1<<i);state.safety.batches[i].positionHold=false;
          } else throw new Error('Unexpected recovery action '+body.action);
        } else if(endpoint!=='/api/data')throw new Error('Unexpected hardware request '+endpoint);
        await route.fulfill({json:state});
      } finally {active--;}
    });
    const refresh=async()=>{await page.waitForFunction(()=>!HatchComponents.loading);await page.evaluate(()=>HatchComponents.refresh());};
    await page.goto(origin+'/settings.html');
    await page.waitForFunction(()=>HatchComponents.state!==undefined);
    await page.evaluate(()=>HatchEspApi.getData());
    check(writes.filter(w=>w.action==='clockAuto').length===1,'Lost RTC time syncs automatically once without a clock button');
    check(writes[0].dateTime.startsWith('2026-10-21T12:00:'),'Automatic clock sync uses browser local wall time without an eight-hour shift');
    check(await page.locator('#setClockBtn').count()===0,'Settings needs no manual time-setting button');
    await page.locator('#componentsStatusBtn').click();
    await page.locator('#componentsList div').nth(8).waitFor();
    check(await page.locator('#componentsDialog').evaluate(el=>el.open),'Component status opens as a modal');
    const text=await page.locator('#componentsList').innerText();
    check(text.includes('SHT40')&&text.includes('37.5 C / 55%')&&text.includes('DS3231')&&text.includes('I2C responding'),'Modal reports sensor, RTC and LCD communication');
    check(text.includes('no contact feedback')&&text.includes('no airflow feedback'),'Relay commands are distinguished from actual load feedback');
    const detection=label=>page.locator('#componentsList > div').filter({has:page.locator('dt',{hasText:label})}).locator('dd > strong').innerText();
    check((await Promise.all(['SHT40','SD card','RTC (DS3231)','LCD'].map(detection))).every(value=>value==='Detected'),
      'Responding sensor, SD, RTC and LCD show simple Detected messages');
    check(text.includes('recovery pending')&&!text.includes('Recovery verified'),'Detected card is distinguished from a verified checkpoint');
    state.sensorRetrying=true;state.sensorConsecutiveFailures=2;state.sensorAgeSeconds=9;await refresh();
    check((await page.locator('#componentsList').innerText()).includes('Retrying after 2 failed read(s); last valid reading:'),'Transient SHT40 errors explicitly distinguish retained readings from a new sample');
    state.sensorRetrying=false;state.sensorConsecutiveFailures=0;
    check(text.includes('Preparing automatic save'),'Pending recovery exposes the real firmware reason below Detected');
    state.recovery.message='No valid recovery snapshot; existing files preserved for service. Check clock and card.';
    state.sdStatus='Ready (queued logging)';await refresh();
    check((await page.locator('#componentsList').innerText()).includes('No valid recovery snapshot')&&
      (await page.locator('#componentsList').innerText()).includes('SD driver: Ready (queued logging)'),
      'Readable card and invalid recovery snapshot are reported separately');
    state.safety.rtcTrusted=false;state.recovery.message='Waiting for automatic clock sync';await refresh();
    check((await page.locator('#componentsList').innerText()).includes('RTC time is not ready'),'Clock recovery wait is visible rather than hidden behind Detected');
    state.safety.rtcTrusted=true;state.recovery.message='Preparing automatic save';
    check(await page.locator('#componentActions button').count()===0,'Healthy recovery and time need no setup or arming button');
    state.recovery.canRebuild=true;state.recovery.snapshotA='Invalid';state.recovery.snapshotB='Invalid';
    state.recovery.message='Recovery files failed validation; originals preserved';await refresh();
    check((await page.locator('#componentsList').innerText()).includes('A Invalid, B Invalid'),'Component details show which recovery files failed validation');
    await page.getByRole('button',{name:'Rebuild recovery from saved settings'}).click();
    check((await page.locator('#modalMessage').innerText()).includes('original batch dates')&&
      (await page.locator('#modalMessage').innerText()).includes('Archive the invalid recovery files'),'Repair confirmation explains preserved originals and original dates');
    const beforeRepair=writes.length;await page.locator('#modalCancelBtn').click();
    check(writes.length===beforeRepair,'Cancelling snapshot repair sends no device mutation');
    await page.locator('#componentsStatusBtn').click();await page.waitForFunction(()=>!HatchComponents.loading);
    await page.getByRole('button',{name:'Rebuild recovery from saved settings'}).click();await page.locator('#modalConfirmBtn').click();
    await page.waitForFunction(()=>document.getElementById('componentsDialog').open&&!HatchComponents.loading);
    check(writes.at(-1).action==='recoveryInitialize'&&!state.recovery.ready,'Confirmed repair queues initialization without claiming a verified checkpoint');
    check(await page.getByRole('button',{name:'Rebuild recovery from saved settings'}).count()===0,'Repair action disappears while its checkpoint is pending');
    state.recovery.snapshotA='Valid';state.recovery.snapshotB='Missing';
    state.recovery.message='Valid snapshot found but recovery time conflicts with the RTC';await refresh();
    check(await page.getByRole('button',{name:'Rebuild recovery from saved settings'}).count()===0,'Clock conflict with a valid snapshot has no destructive repair action');

    state.recovery.ready=true;state.recovery.sequence=257;state.recovery.checkpointPending=true;
    await refresh();
    check((await page.locator('#componentsList').innerText()).includes('checkpoint 257; saving changes'),'Pending changes do not masquerade as a new verified commit');
    state.recovery.checkpointPending=false;state.recovery.checkpointFault=true;state.recovery.logging=false;
    state.sdStatus='CSV append/readback failed; record not durable';
    state.recovery.message='SD write/readback mismatch';await refresh();
    check((await page.locator('#componentsList').innerText()).includes('Save fault: SD write/readback mismatch'),'Checkpoint failure reports its readback error');
    check((await page.locator('#componentsList').innerText()).includes('CSV logging failed'),'CSV logging failure remains visible separately');
    check((await page.locator('#componentsList').innerText()).includes('SD driver: CSV append/readback failed; record not durable'),'SD driver error remains visible alongside a checkpoint failure');
    check(await detection('SD card')==='Detected','A checkpoint write failure does not incorrectly label a detected card missing');
    state.recovery.sdAvailable=false;state.safety.rtcTrusted=false;state.clockStatus='Not detected';state.lcdStatus='Not detected';
    state.sensorValid=false;state.sensorError='SHT40 read failed';await refresh();
    check(await detection('SD card')==='Not detected / unavailable'&&await detection('RTC (DS3231)')==='Not detected'&&await detection('LCD')==='Not detected',
      'Unavailable hardware shows Not detected instead of a successful startup message');
    check(await detection('SHT40')==='Not responding','Failed SHT40 measurements show Not responding');
    state.recovery.sdAvailable=true;state.safety.rtcTrusted=true;state.clockStatus='Ready';state.lcdStatus='I2C responding';state.sensorValid=true;
    state.recovery.checkpointFault=false;state.recovery.logging=true;state.recovery.positionHoldMask=3;
    state.safety.batches.forEach(b=>{b.positionHold=true;b.status='Verify motor position before resuming';});await refresh();
    check(await page.getByRole('button',{name:/Confirm .* roller position/}).count()===0,'No manual position confirmation is offered; firmware skips interrupted turns automatically');
    for(const width of [375,812,1280]) {
      await page.setViewportSize({width,height:900});
      check(await page.locator('#componentsDialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight;}),'Component modal fits at '+width+'px');
    }
    if(process.env.HATCH_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.HATCH_UI_SCREENSHOT_DIR,'components-status.png')});
    offline=true;await refresh();
    check((await page.locator('#componentsSummary').innerText()).includes('out of date'),'Connection loss labels retained component readings as stale');
    offline=false;await page.keyboard.press('Escape');
    check(!await page.locator('#componentsDialog').evaluate(el=>el.open),'Escape closes the component modal');
    state.clockSyncNeeded=true;state.safety.rtcTrusted=false;clockReject=true;
    await page.evaluate(()=>{HatchEspApi.clockAttempt=0;});await page.locator('#componentsStatusBtn').click();
    await page.waitForFunction(()=>!HatchComponents.loading);
    check((await page.locator('#componentsList').innerText()).includes('Clock older than durable recovery time'),'Rejected automatic clock correction is shown without claiming RTC recovery');
    const attempts=writes.filter(w=>w.action==='clockAuto').length;await refresh();
    check(writes.filter(w=>w.action==='clockAuto').length===attempts,'Failed clock sync is throttled instead of retried on every read');
    state.clockSyncNeeded=false;state.safety.rtcTrusted=true;state.safety.batches.forEach(b=>b.positionHold=false);
    await page.goto(origin+'/control.html');await page.waitForFunction(()=>!HatchControl.isLoading);
    check(await page.locator('#verifyRoller1Btn, #verifyRoller2Btn').count()===0,'Control roller cards have no Verify buttons or reserved space');
    const restored=await page.evaluate(()=>HatchBatchStore.loadBatches());
    check(restored.length===1&&restored[0].roller===3,'The same saved batch on both rollers imports once with Both selected');
    check(restored[0].startDate==='2026-10-10'&&restored[0].startTime==='14:30:00'&&restored[0].turningEnd==='2026-10-27T14:30:00','Recovery preserves exact start and turning-end timestamps');
    check(restored[0].count===24&&restored[0].name==='Shared chicken flock','Recovered batch retains its actual egg count and name');
    check(await page.evaluate(data=>HatchBatchStore.getDeviceBatchDay(HatchBatchStore.loadBatches()[0],data).rawDay,state)===11,'Recovered incubation day uses RTC elapsed time');
    check(await page.evaluate(data=>{data.recovery.ready=false;return HatchBatchStore.getDeviceBatchDay(HatchBatchStore.loadBatches()[0],data).rawDay===11;},state),'Trusted device day remains available during an SD recovery fault');
    check(await page.evaluate(data=>{data.safety.storageReady=false;return !HatchBatchStore.getDeviceBatchDay(HatchBatchStore.loadBatches()[0],data).valid;},state),'Invalid internal settings still block the bound batch day');
    check(await page.evaluate(data=>{data.safety.rtcTrusted=false;return !HatchBatchStore.getDeviceBatchDay(HatchBatchStore.loadBatches()[0],data).valid;},state),'Unknown RTC never invents a bound-batch Day 1');
    check(await page.locator('#safetyPanel').count()===0&&await page.locator('#recoveryPanel').count()===0,'Control has no safety or scheduled-turning setup panel');
    check(writes.every(w=>['clockAuto','positionVerified','recoveryInitialize'].includes(w.action)),'Status/recovery checks issue no heater or motor Run commands');
    check(maxActive===1,'Recovery and clock requests remain serialized');check(errors.length===0,'Recovery/component UI has no browser JavaScript errors');
    console.log(JSON.stringify({passed:checks.length,checks},null,2));await context.close();
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
