const EXPECTED_RELAY_PINS = { bulb: 27, fan: 14, turner: 25, turner2: 26 };
const HatchControl = {
  elements: {}, devices: {}, safety: {}, recovery: {}, profiles: [], batches: [],
  firmwareReady: false, isSyncing: false, isLoading: false, pollTimer: null,
  init() {
    const ids = ['autoModeSwitch', 'turnEggBtn', 'turnEgg2Btn', 'stopEggBtn', 'stopEgg2Btn',
      'turnDuration1', 'turnDuration2', 'targetTemp', 'targetHumidity', 'turnInterval', 'turnInterval2'];
    ids.forEach(id => { this.elements[id] = HatchApp.get(id); });
    this.elements.saveSettingsBtn = HatchApp.get('saveControlSettingsBtn');
    ['bulb', 'fan', 'turner', 'turner2'].forEach(key => {
      this.devices[key] = { switch: HatchApp.get(`${key}Switch`), text: HatchApp.get(`${key}Text`),
        actualOn: false };
    });
    this.bindEvents(); this.updateControlState();
    this.loadControllerState({ updateFields: true });
    document.addEventListener('visibilitychange', () => {
      clearTimeout(this.pollTimer);
      if (!document.hidden) this.loadControllerState();
    });
  },
  setText(id, text) {
    const node = HatchApp.get(id);
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  },
  confirmAction(options) {
    if (window.HatchModal?.open && HatchModal.open(options)) return;
    const review = (options.details || []).map(([label, value]) => `${label}: ${value}`).join('\n');
    if (confirm([options.message, review, options.notice].filter(Boolean).join('\n\n'))) options.onConfirm();
  },
  bindEvents() {
    this.elements.autoModeSwitch?.addEventListener('change', () => this.syncControlSettings({ autoMode: this.elements.autoModeSwitch.checked }));
    this.devices.bulb.switch?.addEventListener('change', () => this.syncControlSettings({ bulbOn: this.devices.bulb.switch.checked }));
    this.devices.fan.switch?.addEventListener('change',()=>this.syncControlSettings({fanOn:this.devices.fan.switch.checked}));
    [1, 2].forEach(motor => {
      const device = motor === 1 ? this.devices.turner : this.devices.turner2;
      device.switch?.addEventListener('change', () => device.switch.checked ?
        this.turnEggsNow(motor) : this.stopEggs(motor));
      this.elements[motor === 1 ? 'turnEggBtn' : 'turnEgg2Btn']?.addEventListener('click', () => {
        const seconds = this.manualDuration(motor);
        if (seconds === null) return;
        this.confirmAction({ title: `Run ${this.motorLabel(motor)}?`,
          message: `Run for ${seconds} seconds using the calibrated motor travel?`,
          confirmText: 'Start turner', cancelText: 'Cancel',
          onConfirm: () => this.turnEggsNow(motor, seconds) });
      });
      this.elements[motor === 1 ? 'stopEggBtn' : 'stopEgg2Btn']?.addEventListener('click', () => this.stopEggs(motor));
      this.elements[`turnDuration${motor}`]?.addEventListener('blur', () => this.manualDuration(motor));
    });
    this.elements.saveSettingsBtn?.addEventListener('click', () => this.reviewSettings());

  },
  manualDuration(motor, report = true) {
    const input = this.elements[`turnDuration${motor}`];
    const text = String(input?.value ?? '').trim(), seconds = Number(text);
    const valid = /^\d+$/.test(text) && seconds >= 1 && seconds <= 600 && Number.isInteger(seconds);
    this.setText(`turnDuration${motor}Error`, !valid && report ? 'Enter a whole number from 1 to 600 seconds.' : '');
    input?.setAttribute('aria-invalid', String(!valid));
    return valid ? seconds : null;
  },
  parseNumber(value, fallback) {
    const text = String(value ?? '').replace(/[°C%\s]/g, '');
    const n = Number(text);
    return text && Number.isFinite(n) ? n : fallback;
  },
  collectPayload() {
    const duration = this.manualDuration(1), duration2 = this.manualDuration(2);
    const temperature = this.parseNumber(this.elements.targetTemp?.value, NaN);
    const humidity = this.parseNumber(this.elements.targetHumidity?.value, NaN);
    if (duration === null || duration2 === null || !(temperature >= 30 && temperature <= 37.8) ||
        !(humidity >= 0 && humidity <= 100)) throw new Error('Use a 30–37.8°C target, 0–100% humidity and valid motor durations.');
    return { autoMode: this.elements.autoModeSwitch?.checked ?? true,
      bulbOn: this.devices.bulb.switch?.checked ?? false, fanOn: this.devices.fan?.switch?.checked ?? true,
      turnerOn: false, turner2On: false, targetTemperature: temperature, targetHumidity: humidity,
      turnIntervalMinutes: Number(this.elements.turnInterval?.value) || 120,
      turnInterval2Minutes: Number(this.elements.turnInterval2?.value) || 120,
      turnDurationSeconds: duration, turnDuration2Seconds: duration2 };
  },
  updateControlState() {
    const auto = this.elements.autoModeSwitch?.checked ?? true;
    const blocked = this.isSyncing || !this.firmwareReady;
    const formBlocked=blocked;
    ['targetTemp', 'targetHumidity', 'turnInterval', 'turnInterval2'].forEach(id => {
      if (this.elements[id]) this.elements[id].disabled = formBlocked;
    });
    if (this.elements.autoModeSwitch) this.elements.autoModeSwitch.disabled = blocked;
    if (this.elements.saveSettingsBtn) this.elements.saveSettingsBtn.disabled = formBlocked;
    if (this.devices.fan.switch) this.devices.fan.switch.disabled=blocked || auto;
    if (this.devices.bulb.switch) this.devices.bulb.switch.disabled=blocked || auto;
    [1, 2].forEach(motor => {
      const d = motor === 1 ? this.devices.turner : this.devices.turner2;
      const p = this.profiles[motor-1] || {};
      if (d.switch) d.switch.disabled=blocked || auto;
      const run=this.elements[motor===1 ? 'turnEggBtn' : 'turnEgg2Btn'];
      if(run) run.disabled=blocked || auto || d.pulseActive || d.queued;
      const stop = this.elements[motor === 1 ? 'stopEggBtn' : 'stopEgg2Btn'];
      if (stop) stop.disabled = blocked || auto || !(d.actualOn || d.queued);
      if (this.elements[`turnDuration${motor}`]) this.elements[`turnDuration${motor}`].disabled = formBlocked || d.pulseActive;
    });
    this.setText('controlStatusBadge', auto ? 'Auto Mode: ON' : 'Auto Mode: OFF');
    this.setText('lockBadge', !this.firmwareReady ? 'Waiting for updated firmware' : auto ? 'Automatic heating' : 'Manual controls active');
    this.setText('autoDescription', auto ? 'Automatic mode controls all outputs. Switch to Manual mode to use relay switches and roller Run/Stop.' :
      'Manual heating and timed motor runs remain protected by temperature, sensor and lockdown limits. Fan OFF requests are overridden during heating or faults.');
  },
  rollerName(motor) { return motor === 1 ? 'Lower roller' : 'Upper roller'; },
  batchLabel(motor) {
    const p=this.profiles[motor-1] || {};
    const batch=this.batches.find(b=>b.id===p.batchId);
    return p.label || batch?.label || (p.batchId ? p.batchId : 'No batch');
  },
  motorLabel(motor) { return `${this.rollerName(motor)} · ${this.batchLabel(motor)}`; },
  renderBatchLabels() {
    this.batches=window.HatchBatchStore?.loadBatches() || [];
    [1,2].forEach(motor=>{
      const label=this.motorLabel(motor);
      this.setText(motor===1 ? 'turnerTitle' : 'turner2Title',label);
      this.setText(motor===1 ? 'turnEggBtn' : 'turnEgg2Btn',`Run ${this.batchLabel(motor) === 'No batch' ? this.rollerName(motor).toLowerCase() : this.batchLabel(motor)}`);
      const d=motor===1 ? this.devices.turner : this.devices.turner2;
      d.switch?.setAttribute('aria-label',`${label} timed run`);
    });
  },
  applyRemoteState(data, options = {}) {
    const c = data.control || {};
    this.safety = data.safety || {}; this.profiles = this.safety.batches || [];
    this.recovery = data.recovery || {};
    this.firmwareReady = this.safety.version === 2 && Object.entries(EXPECTED_RELAY_PINS).every(
      ([key, pin]) => data.relayPins?.[key] === pin);
    if (typeof c.autoMode === 'boolean') this.elements.autoModeSwitch.checked = c.autoMode;
    Object.entries(this.devices).forEach(([key, d]) => {
      d.actualOn = c[`${key}On`] === true;
      if (d.switch) d.switch.checked = !c.autoMode && key==='bulb' ? c.manualBulbOn ?? c.bulbOn : !c.autoMode && key==='fan' ? c.manualFanOn ?? c.fanOn : d.actualOn;
    });
    [1, 2].forEach(motor => {
      const d = motor === 1 ? this.devices.turner : this.devices.turner2;
      d.pulseActive = c[motor === 1 ? 'turnPulseActive' : 'turnPulse2Active'] === true;
      d.queued = c[motor === 1 ? 'turnQueued' : 'turn2Queued'] === true;
      d.remainingSeconds = c[motor === 1 ? 'turnPulseRemainingSeconds' : 'turnPulse2RemainingSeconds'] || 0;
      const profile=this.profiles[motor-1] || {};
      if (d.text) d.text.textContent = d.pulseActive ? `Timed run: ${d.remainingSeconds} seconds remaining` :
        d.queued ? 'Start queued' : profile.canManualRun && !profile.canRun ?
        `Manual ready; automatic: ${profile.status || 'not scheduled'}` : profile.status || 'Turning disabled';
    });
    const low=c.heaterOnBelow, high=c.heaterOffAbove;
    this.setText('bulbText', c.autoMode ?
      c.heaterControl==='thermostat_hysteresis' && Number.isFinite(low) && Number.isFinite(high) ?
        `ON below ${low.toFixed(1)}°C; OFF above ${high.toFixed(1)}°C` : 'Thermostat limits unavailable' :
      'Manual · up to 5 seconds before relay ON');
    this.setText('fanText', c.autoMode ? 'Automatic circulation' : c.manualFanOn===false && c.fanOn ? 'Requested OFF; running for heating or sensor/temperature protection' : `Manual request; relay ${c.fanOn ? 'ON' : 'OFF'}`);
    this.setText('heaterStatus', c.heaterStatus || 'Heating detail unavailable; update firmware');
    this.setText('bulbActualState', c.bulbOn === true ? 'ON' : 'OFF');
    this.setText('heaterDemandValue', c.autoMode === false ? 'Manual' :
      c.heaterControl === 'thermostat_hysteresis' ? 'Thermostat' : 'Unavailable');
    this.setText('controlNotice', `${this.safety.message || 'Controller connected.'} ${this.recovery.checkpointFault ? 'SD save is retrying; details are in Settings > Component status.' : this.recovery.checkpointPending ? 'Saving automatically to SD...' : this.recovery.ready ? 'SD recovery synced.' : 'Recovery is checking saved state.'}`);
    this.setText('wifiStatus', data.wifiStatus || 'Offline');
    if (options.updateFields) {
      this.elements.targetTemp.value = `${Number(c.targetTemperature ?? 37.5).toFixed(1)}°C`;
      this.elements.targetHumidity.value = `${c.targetHumidity ?? 55}%`;
      this.elements.turnInterval.value = String(c.turnIntervalMinutes || 120);
      this.elements.turnInterval2.value = String(c.turnInterval2Minutes || 120);
      this.elements.turnDuration1.value = String(c.turnDurationSeconds || 120);
      this.elements.turnDuration2.value = String(c.turnDuration2Seconds || 120);
    }
    this.renderBatchLabels(); this.updateControlState();
  },
  async loadControllerState(options = {}) {
    if (this.isSyncing || this.isLoading || document.hidden) return;
    this.isLoading = true;
    try {
      const request = HatchEspApi.getData();
      this.loadTask = request.catch(() => {});
      const data = await request;
      this.applyRemoteState(data, { updateFields: options.updateFields || !this.firmwareReady });
      this.setText('settingsStatus', this.firmwareReady ? 'Synced' : 'Update firmware and web files');
    } catch (error) {
      this.firmwareReady = false; this.setText('settingsStatus', 'ESP32 unavailable');
      this.setText('controlNotice','ESP32 unavailable. Displayed states may be out of date.');
    } finally {
      this.isLoading = false; this.updateControlState(); clearTimeout(this.pollTimer);
      if (!document.hidden) this.pollTimer = setTimeout(() => this.loadControllerState(), 5000);
    }
  },
  async perform(operation, success = 'Saved') {
    if (!this.firmwareReady || this.isSyncing) return false;
    this.isSyncing = true; this.updateControlState(); this.setText('settingsStatus', 'Applying…');
    try {
      if (this.isLoading) await this.loadTask;
      const data = await operation(); this.applyRemoteState(data);
      this.setText('settingsStatus', success); window.HatchToast?.success(success); return true;
    } catch (error) {
      this.setText('settingsStatus', error.message); window.HatchToast?.warning(error.message);
      try { this.applyRemoteState(await HatchEspApi.getData()); } catch (_) { this.firmwareReady=false; }
      return false;
    } finally {
      this.isSyncing = false; this.updateControlState(); clearTimeout(this.pollTimer);
      if (!document.hidden) this.pollTimer = setTimeout(() => this.loadControllerState(), 5000);
    }
  },
  syncControlSettings(payload) {
    if(this.elements.autoModeSwitch?.checked && ['bulbOn','fanOn','turnerOn','turner2On'].some(key=>key in payload)) {
      this.setText('settingsStatus','Switch to Manual mode before controlling relays.');
      this.loadControllerState(); return;
    }
    // Immediate switches must not save unrelated edits that have not been reviewed.
    return this.perform(() => HatchEspApi.updateControl(payload), 'Control updated');
  },
  collectSettingsReview() {
    const payload = this.collectPayload();
    return { payload, bindings: this.profiles.map(p=>p.batchId || '') };
  },
  reviewSettings() {
    if (!this.firmwareReady || this.isSyncing) return;
    try {
      const snapshot = this.collectSettingsReview(), p = snapshot.payload;
      const details = [['Saved operating mode',p.autoMode ? 'Automatic' : 'Manual'],
        ['Target temperature', `${p.targetTemperature}°C`], ['Target humidity', `${p.targetHumidity}%`]];
      [1,2].forEach(motor => details.push([this.motorLabel(motor),
        `${motor===1 ? p.turnDurationSeconds : p.turnDuration2Seconds} sec every ${motor===1 ? p.turnIntervalMinutes : p.turnInterval2Minutes} min`]));
      details.push(['After power returns',p.autoMode ? 'Restore Automatic mode; heating waits for stable sensor readings.' :
        'Restore Manual mode; the bulb starts OFF.']);
      this.confirmAction({ title: 'Save Control Settings?', message: 'Review the mode, targets and roller timing before saving.',
        details, notice: 'Mode changes are saved immediately. Confirm saves these targets and timings to device memory and queues an SD checkpoint. Automatic turning needs valid RTC/SD recovery; unfinished turns are skipped automatically after recovery.',
        confirmText: 'Confirm & save', cancelText: 'Keep editing', confirmClass: 'modal-btn-primary',
        onConfirm: () => this.saveSettings(snapshot) });
    } catch (error) {
      this.setText('settingsStatus', error.message); window.HatchToast?.warning(error.message);
    }
  },
  saveSettings(snapshot) {
    return this.perform(async () => {
      if (snapshot.bindings.some((id,i)=>id!==(this.profiles[i]?.batchId || '')))
        throw new Error('A roller batch changed while reviewing. Review the settings again.');
      if(snapshot.payload.autoMode!==this.elements.autoModeSwitch.checked)
        throw new Error('The operating mode changed while reviewing. Review the settings again.');
      const { autoMode, bulbOn, fanOn, turnerOn, turner2On, ...settings } = snapshot.payload;
      const result=await HatchEspApi.updateControl(settings);
      this.applyRemoteState(result, { updateFields: true }); return result;
    }, 'Settings saved to device memory; SD save queued');
  },
  turnEggsNow(motor, seconds = this.manualDuration(motor)) {
    if (seconds === null || this.elements.autoModeSwitch?.checked) return;
    return this.perform(() => HatchEspApi.turnEggsNow(motor, seconds), `${this.motorLabel(motor)} timed run requested`);
  },
  stopEggs(motor) { if(this.elements.autoModeSwitch?.checked) return; return this.perform(() => HatchEspApi.stopEggs(motor), 'Turner stop confirmed'); },
  safetyAction(action, payload) { return this.perform(() => HatchEspApi.safetyAction(action, payload), 'Device safety settings updated'); }
};
document.addEventListener('DOMContentLoaded', () => HatchControl.init());
