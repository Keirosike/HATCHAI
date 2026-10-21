const HatchComponents = {
  timer: null, loading: false, state: null,
  init() {
    this.dialog=document.getElementById('componentsDialog');
    if(!this.dialog) return;
    document.getElementById('componentsStatusBtn')?.addEventListener('click',()=>this.open());
    document.getElementById('closeComponentsBtn')?.addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('close',()=>clearTimeout(this.timer));
    this.dialog.addEventListener('click',event=>{ if(event.target===this.dialog) {
      const r=this.dialog.getBoundingClientRect();
      if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) this.dialog.close();
    }});
    document.addEventListener('visibilitychange',()=>{
      clearTimeout(this.timer); if(!document.hidden && this.dialog.open) this.refresh();
    });
    // Clock repair is automatic when Settings is opened; no clock button.
    HatchEspApi.getData().catch(()=>{});
  },
  open() {
    if(!this.dialog.open) this.dialog.showModal();
    document.getElementById('componentsTitle').focus(); this.refresh();
  },
  async refresh() {
    if(this.loading || document.hidden || !this.dialog.open) return;
    this.loading=true; clearTimeout(this.timer);
    try {
      const data=await HatchEspApi.getData(); this.state=data;
      const s=data.safety || {},r=data.recovery || {},c=data.control || {};
      const clockStatus=data.clockStatus || '';
      const rtcDetection=s.rtcTrusted || ['Ready','Waiting for automatic clock sync','Validating / read failed','Read failed'].includes(clockStatus) ? 'Detected' : clockStatus==='Not detected' ? 'Not detected' : 'Unknown';
      const lcdDetection=data.lcdStatus==='I2C responding' || data.lcdStatus==='Ready' ? 'Detected' : data.lcdStatus==='Not detected' ? 'Not detected' : 'Unknown';
      const rows=[
        ['DHT22',data.sensorValid ? 'Detected' : 'Not responding',data.sensorValid ? `Valid reading: ${data.temperature} C / ${data.humidity}% RH; age ${data.sensorAgeSeconds ?? '?'} s` : data.sensorError || 'No valid measurement'],
        ['SD card',r.sdAvailable===true ? 'Detected' : r.sdAvailable===false ? 'Not detected / unavailable' : 'Unknown',(!r.sdAvailable ? 'Retrying automatically' : r.checkpointFault ? `Save fault: ${r.message}` : r.ready ? `Recovery verified; checkpoint ${r.sequence ?? '?'}${r.checkpointPending ? '; saving changes' : ''}` : 'Card read/write detected; recovery pending') + (r.sdAvailable && !r.logging ? '; CSV logging failed; retrying automatically' : '')],
        ['RTC (DS3231)',rtcDetection,s.rtcTrusted ? data.rtcTime : data.clockSyncError || clockStatus || 'Waiting for clock validation'],
        ['LCD',lcdDetection,`${data.lcdStatus || 'Unknown'} (I2C communication; displayed text cannot be verified)`],
        ['Bulb relay',typeof c.bulbOn==='boolean' ? 'Output configured' : 'Unknown',`Commanded ${c.bulbOn ? 'ON' : 'OFF'}; no contact feedback`],
        ['Fan relay',typeof c.fanOn==='boolean' ? 'Output configured' : 'Unknown',`Commanded ${c.fanOn ? 'ON' : 'OFF'}; no airflow feedback`],
        ['Lower roller',typeof c.turnerOn==='boolean' ? 'Output configured' : 'Unknown',`${s.batches?.[0]?.label || 'No batch'}: ${s.batches?.[0]?.status || 'Unknown'}; relay ${c.turnerOn ? 'ON' : 'OFF'}`],
        ['Upper roller',typeof c.turner2On==='boolean' ? 'Output configured' : 'Unknown',`${s.batches?.[1]?.label || 'No batch'}: ${s.batches?.[1]?.status || 'Unknown'}; relay ${c.turner2On ? 'ON' : 'OFF'}`],
        ['Wi-Fi',data.wifiStatus || 'Unknown','']
      ];
      const list=document.getElementById('componentsList'); list.replaceChildren();
      rows.forEach(([label,status,detail])=>{
        const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
        const detection=document.createElement('strong');
        dt.textContent=label; detection.textContent=status; dd.append(detection);
        if(detail) { const note=document.createElement('div');note.textContent=detail;dd.append(note); }
        row.append(dt,dd); list.append(row);
      });
      document.getElementById('componentsSummary').textContent=s.message || 'Live controller status';
      const actions=document.getElementById('componentActions'); actions.replaceChildren();
      const add=(label,action,payload,message)=>{
        const button=document.createElement('button');button.type='button';button.className='btn btn-soft';button.textContent=label;
        button.addEventListener('click',()=>{
          this.dialog.close();
          HatchSettings.confirmAction({title:label,message,confirmText:'Confirm',cancelText:'Cancel',onConfirm:async()=>{
            try { await HatchEspApi.safetyAction(action,payload); }
            catch(error) { window.HatchToast?.warning(error.message); }
            this.open();
          }});
        });actions.append(button);
      };
      if(s.critical && s.canAcknowledge) add('Acknowledge cooled alarm','ack',{},'Confirm the cause of overheating has been checked and the incubator has cooled.');
      [1,2].forEach(motor=>{if(r.positionHoldMask & (1<<(motor-1)))
        add(`Verify ${motor===1 ? 'lower' : 'upper'} roller position`,'positionVerified',{motor},'Confirm you physically inspected this roller and its calibrated travel. There is no position sensor.');
      });
    } catch(error) {
      document.getElementById('componentsSummary').textContent='ESP32 unavailable. Previous component readings may be out of date.';
    } finally {
      this.loading=false;
      if(this.dialog.open && !document.hidden) this.timer=setTimeout(()=>this.refresh(),5000);
    }
  }
};
document.addEventListener('DOMContentLoaded',()=>HatchComponents.init());
