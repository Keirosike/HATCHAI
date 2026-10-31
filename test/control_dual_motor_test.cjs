// Node-only checks of deployed payload validation and API serialization.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function main(){
  const nodes=new Map(),get=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',setAttribute(){}});
    return nodes.get(id);
  };
  const context=vm.createContext({document:{addEventListener(){}},HatchApp:{get},URLSearchParams,
    AbortController,setTimeout,clearTimeout,console,Promise});context.window=context;
  vm.runInContext(fs.readFileSync(path.join(root,'data/js/control.js'),'utf8'),context);
  const control=vm.runInContext('HatchControl',context);
  for(const id of ['autoModeSwitch','targetTemp','targetHumidity','turnInterval','turnInterval2','turnDuration1','turnDuration2'])control.elements[id]=get(id);
  control.devices.bulb={switch:get('bulbSwitch')};
  get('targetTemp').value='37.5°C';get('targetHumidity').value='55%';
  get('turnDuration1').value='15';get('turnDuration2').value='17';
  get('turnInterval').value='60';get('turnInterval2').value='180';
  const p=control.collectPayload();
  assert.equal(p.targetTemperature,37.5);assert.equal(p.targetHumidity,55);
  assert.equal(p.fanOn,true);assert.equal(p.turnerOn,false);assert.equal(p.turner2On,false);
  assert.equal(p.turnDurationSeconds,15);assert.equal(p.turnDuration2Seconds,17);
  assert.equal(p.turnIntervalMinutes,60);assert.equal(p.turnInterval2Minutes,180);
  for(const invalid of ['0','601','1.5','NaN','']){get('turnDuration1').value=invalid;assert.equal(control.manualDuration(1),null);}
  get('turnDuration1').value='7';get('targetTemp').value='37.5junk';
  assert.throws(()=>control.collectPayload());
  get('targetTemp').value='38.0';assert.throws(()=>control.collectPayload());
  get('targetTemp').value='37.5';get('turnDuration2').value='17';
  assert.equal(control.collectPayload().turnDurationSeconds,7);
  let active=0,maxActive=0;const sent=[];
  context.HatchStorage={get(){return{token:'test-session'};}};
  context.fetch=async(url,options)=>{
    active++;maxActive=Math.max(maxActive,active);sent.push({url,...options});
    await new Promise(r=>setTimeout(r,5));active--;
    return{ok:true,json:async()=>({ok:true})};
  };
  vm.runInContext(fs.readFileSync(path.join(root,'data/js/espApi.js'),'utf8'),context);
  await Promise.all([context.HatchEspApi.getData(),context.HatchEspApi.safetyAction('arm'),context.HatchEspApi.turnEggsNow(2,17)]);
  assert.equal(maxActive,1,'All device requests share one queue');
  const arm=new URLSearchParams(sent[1].body),turn=new URLSearchParams(sent[2].body);
  assert.equal(arm.get('action'),'arm');assert.equal(arm.get('token'),'test-session');
  assert.equal(turn.get('motor'),'2');assert.equal(turn.get('durationSeconds'),'17');
  assert.equal(turn.get('manual'),'true','Run is explicitly manual even with automatic climate control');
  assert.equal(sent[1].headers['Content-Type'],'application/x-www-form-urlencoded');
  context.fetch=async()=>({ok:false,status:409,json:async()=>({message:'Sensor safety hold'})});
  await assert.rejects(context.HatchEspApi.safetyAction('arm'),/Sensor safety hold/);
  context.fetch=async(url,options)=>{sent.push({url,...options});return{ok:true,status:200,json:async()=>({ok:true})};};
  await context.HatchEspApi.syncBatch({id:'shared',roller:3,status:'Active',startDate:'2026-10-10',startTime:'12:00:00',turningEnd:'2026-10-26T12:00:00'});
  const shared=new URLSearchParams(sent.at(-1).body);
  assert.equal(shared.get('roller'),'3');assert.equal(shared.get('turningEnd'),'2026-10-26T12:00:00');
  vm.runInContext(fs.readFileSync(path.join(root,'data/js/authSession.js'),'utf8'),context);
  await context.HatchAuthSession.saveAccount('test-user','test-only-password');
  assert.equal(new URLSearchParams(sent.at(-1).body).get('token'),'test-session','Account changes send an authenticated token');
  console.log('PASS: calibrated durations, independent intervals, protected payloads, session token, serialized requests and API error messages');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
