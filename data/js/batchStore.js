const HatchBatchStore = (() => {
  const STORAGE_KEY = "hatchai_batches";
  const CHICKEN_INCUBATION_DAYS = 21;
  const ACTIVE_SLOT_COUNT = 2;
  const BATCH_NAME_PREFIX = "Chicken Batch ";
  const BATCH_LABEL_PREFIX = "BATCH-";
  const BATCH_LABEL_MAX_LENGTH = 30;
  const BATCH_LABEL_PATTERN = /^[A-Za-z0-9 _-]+$/;

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return String(Date.now() + Math.random());
  }

  function todayIso() {
    return dateToIso(new Date());
  }

  function dateToIso(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return date.getFullYear() + "-" + month + "-" + day;
  }

  function normalizeLabel(label) {
    return String(label || "").trim();
  }

  function getLabelKey(label) {
    return normalizeLabel(label).toLowerCase();
  }

  function generateBatchLabel(usedLabels = []) {
    const usedKeys = new Set(usedLabels.map(getLabelKey).filter(Boolean));
    let number = 1;
    let label = "";

    do {
      label = BATCH_LABEL_PREFIX + String(number).padStart(3, "0");
      number += 1;
    } while (usedKeys.has(getLabelKey(label)));

    return label;
  }

  // Match only unchanged records created by the old sample-data initializer.
  function isLegacyDemoBatch(batch) {
    const demos = [
      {
        label: "BATCH-001",
        name: "Chicken Batch 001",
        type: "Chicken",
        count: 36,
        laidDate: "2026-04-18",
        startDate: "2026-04-20",
        targetTemp: "37.8\u00B0C",
        targetHumidity: "58%",
        status: "Active",
        notes: "Check candling status on Day 14. Maintain stable humidity and automatic egg turning.",
      },
      {
        label: "BATCH-002",
        name: "Chicken Batch 002",
        type: "Chicken",
        count: 30,
        laidDate: "2026-03-23",
        startDate: "2026-03-25",
        targetTemp: "37.8\u00B0C",
        targetHumidity: "58%",
        status: "Completed",
        notes: "Previous completed batch.",
      }
    ];
    return demos.some(demo => Object.entries(demo).every(([key, value]) => batch[key] === value));
  }

  function defaultTurningEnd(batch) {
    const parts=String(batch.startDate || '').split('-').map(Number),time=String(batch.startTime || '00:00:00').split(':').map(Number);
    if(parts.length!==3) return '';
    const ms=Date.UTC(parts[0],parts[1]-1,parts[2],time[0]||0,time[1]||0,time[2]||0)+17*86400000;
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0,19) : '';
  }
  function normalizeBatch(batch) {
    return {
      id: batch.id || createId(),
      label: normalizeLabel(batch.label),
      name: batch.name || "Chicken Batch",
      type: "Chicken",
      count: Number(batch.count) || 0,
      laidDate: batch.laidDate || batch.layDate || "",
      startDate: batch.startDate || "",
      startTime: /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(batch.startTime) ? batch.startTime : "00:00:00",
      durationDays: Number.isInteger(batch.durationDays) && batch.durationDays >= 19 && batch.durationDays <= 35 ? batch.durationDays : 21,
      roller: [1,2,3].includes(Number(batch.roller)) ? Number(batch.roller) : 0,
      turningEnd: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(batch.turningEnd || '') ? batch.turningEnd : '',
      recovered: Boolean(batch.recovered),
      deviceBound: Boolean(batch.deviceBound),
      targetTemp: batch.targetTemp || "37.5\u00B0C",
      targetHumidity: batch.targetHumidity || "55%",
      status: batch.status || "Active",
      notes: batch.notes || "",
      selected: Boolean(batch.selected)
    };
  }

  function isActiveBatch(batch) {
    return Boolean(batch) && batch.status === "Active";
  }

  function getActiveBatches(batches) {
    return Array.isArray(batches)
      ? batches.filter(isActiveBatch)
      : [];
  }

  function ensureBatchLabels(batches) {
    const usedLabels = [];

    batches.forEach(batch => {
      const label = normalizeLabel(batch.label);

      if (label) {
        batch.label = label;
        usedLabels.push(label);
        return;
      }

      batch.label = generateBatchLabel(usedLabels);
      usedLabels.push(batch.label);
    });
  }

  function normalizeBatches(records) {
    let selectedFound = false;
    const batches = Array.isArray(records)
      ? records.map(normalizeBatch).filter(batch => batch.count > 0 || batch.recovered)
      : [];

    ensureBatchLabels(batches);

    batches.forEach(batch => {
      if (batch.selected && isActiveBatch(batch) && !selectedFound) {
        selectedFound = true;
        return;
      }

      batch.selected = false;
    });

    if (!batches.some(batch => batch.selected)) {
      const firstActiveBatch = batches.find(isActiveBatch);

      if (firstActiveBatch) {
        firstActiveBatch.selected = true;
      }
    }

    return batches;
  }

  function getBatchNumber(name) {
    const match = String(name || "").match(/^Chicken Batch\s+(\d+)$/i);
    return match ? Number(match[1]) : 0;
  }

  function getNextBatchName(batches) {
    const maxBatchNumber = Array.isArray(batches)
      ? batches.reduce((max, batch) => Math.max(max, getBatchNumber(batch.name)), 0)
      : 0;

    return BATCH_NAME_PREFIX + String(maxBatchNumber + 1).padStart(3, "0");
  }

  function getNextBatchLabel(batches) {
    const labels = Array.isArray(batches)
      ? batches.map(batch => batch.label)
      : [];

    return generateBatchLabel(labels);
  }

  function getBatchLabelError(label, batches, currentId = "") {
    const normalizedLabel = normalizeLabel(label);

    if (!normalizedLabel) {
      return "Batch Label is required.";
    }

    if (normalizedLabel.length > BATCH_LABEL_MAX_LENGTH) {
      return "Batch Label must be 30 characters or fewer.";
    }

    if (!BATCH_LABEL_PATTERN.test(normalizedLabel)) {
      return "Batch Label can use only letters, numbers, spaces, hyphens, and underscores.";
    }

    const duplicate = Array.isArray(batches) && batches.some(batch =>
      batch.id !== currentId && getLabelKey(batch.label) === getLabelKey(normalizedLabel)
    );

    if (duplicate) {
      return `Batch Label "${normalizedLabel}" already exists. Use a unique label.`;
    }

    return "";
  }

  function loadBatches() {
    const saved = loadData(STORAGE_KEY);
    const normalized = normalizeBatches(saved);
    const batches = normalizeBatches(normalized.filter(batch => !isLegacyDemoBatch(batch)));
    saveBatches(batches);
    return batches;
  }

  function saveBatches(batches) {
    saveData(STORAGE_KEY, normalizeBatches(batches));
  }

  function importDeviceBatches(data = {}) {
    if (data.recovery?.version !== 1 || !data.recovery.ready || !Array.isArray(data.safety?.batches)) return;
    const records = loadBatches(); let changed = false;
    for (const physical of data.safety.batches) {
      const placement=data.safety.batches.filter(p=>p.batchId===physical.batchId).reduce((mask,p)=>mask|(1<<(p.motor-1)),0);
      const existing = records.find(b => b.id === physical.batchId);
      const turningEnd=physical.turningEndEpoch ? new Date(physical.turningEndEpoch*1000).toISOString().slice(0,19) : '';
      if(existing && !existing.turningEnd && turningEnd) {existing.turningEnd=turningEnd;changed=true;}
      if (existing && !existing.roller && [1,2].includes(physical.motor)) { existing.roller=placement; changed=true; }
      if (existing && !existing.deviceBound) { existing.deviceBound = true; changed = true; }
      if (existing && physical.batchStatus === "Completed" && existing.status === "Active" && physical.startEpoch) {
        const savedStart = new Date(physical.startEpoch * 1000).toISOString();
        if (`${existing.startDate}T${existing.startTime}` === savedStart.slice(0,19)) {
          existing.status = "Completed"; existing.selected = false; changed = true;
        }
      }
      // Import only missing active device records. Owned records and deleted/
      // inactive records stay untouched; no sample batch or invented egg count.
      if (!physical.batchId || !physical.active || records.some(b => b.id === physical.batchId) ||
          getActiveBatches(records).length >= ACTIVE_SLOT_COUNT || !Number.isInteger(physical.startEpoch) || physical.startEpoch < 1704067200) continue;
      const start = new Date(physical.startEpoch * 1000).toISOString();
      records.push(normalizeBatch({ id: physical.batchId, label: physical.label || getNextBatchLabel(records),
        name: physical.name || `Recovered batch ${physical.motor}`, count: physical.eggCount || 0,
        startDate: start.slice(0,10), startTime: start.slice(11,19), durationDays: physical.durationDays,
        status: "Active", roller: placement, turningEnd, recovered: true, deviceBound: true, laidDate: "", notes: "Restored from the incubator SD recovery state. Verify any missing egg details." }));
      changed = true;
    }
    records.forEach(record => {
      if (record.deviceBound && !data.safety.batches.some(p => p.batchId === record.id)) { record.deviceBound = false; changed = true; }
    });
    if (changed) saveBatches(records);
  }

  function getDeviceBatchDay(batch, data = {}) {
    const physical=data.safety?.batches?.find(p => p.batchId===batch.id);
    if (!batch.deviceBound && (!physical || data.recovery?.version!==1)) return null;
    if (!physical || !data.recovery?.ready || !data.safety?.rtcTrusted ||
        !Number.isInteger(physical.incubationDay) || physical.incubationDay<1)
      return {valid:false,day:0,rawDay:0,message:"Incubation day unavailable — verify RTC and recovered batch state"};
    return {valid:true,day:Math.min(physical.incubationDay,CHICKEN_INCUBATION_DAYS),rawDay:physical.incubationDay,message:""};
  }

  function formatDate(dateInput) {
    const date = new Date(dateInput + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
      return "Not set";
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric"
    });
  }

  function parseIsoDate(dateInput) {
    const date = new Date(String(dateInput || "") + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getCurrentDateContext(data = {}) {
    const rtcDate = String(data.rtcTime || "").match(/^(\d{4}-\d{2}-\d{2})/);

    if (rtcDate && data.clockStatus !== "Not detected") {
      return {
        dateIso: rtcDate[1],
        dateTime: String(data.rtcTime).replace(" ", "T"),
        source: "rtc",
        rtcAvailable: true
      };
    }

    return {
      dateIso: todayIso(),
      dateTime: `${dateToIso(new Date())}T${new Date().toTimeString().slice(0,8)}`,
      source: "fallback",
      rtcAvailable: false
    };
  }

  function getBatchIncubationDay(batch, currentDateIso = todayIso()) {
    const started = new Date(`${batch.startDate}T${batch.startTime || "00:00:00"}`);
    const current = new Date(currentDateIso.includes("T") ? currentDateIso : `${currentDateIso}T00:00:00`);

    if (Number.isNaN(started.getTime()) || Number.isNaN(current.getTime()) || current < started) {
      return {
        valid: false,
        day: 0,
        rawDay: 0,
        message: "Prediction unavailable - invalid or missing start date"
      };
    }

    const elapsedDays = Math.floor((current - started) / 86400000);
    const rawDay = elapsedDays + 1;

    return {
      valid: true,
      day: Math.min(rawDay, CHICKEN_INCUBATION_DAYS),
      rawDay,
      message: ""
    };
  }

  function hasValidSensorData(data = {}) {
    const temperature = Number(data.temperature);
    const humidity = Number(data.humidity);

    return Number.isFinite(temperature) &&
      Number.isFinite(humidity) &&
      temperature >= -40 &&
      temperature <= 80 &&
      humidity >= 0 &&
      humidity <= 100 &&
      data.sensorStatus !== "No reading";
  }

  function addDaysIso(dateIso, days) {
    const date = parseIsoDate(dateIso);

    if (!date || !Number.isFinite(Number(days))) {
      return "";
    }

    date.setDate(date.getDate() + Number(days));
    return dateToIso(date);
  }

  function getFallbackPredictedHatchDate(currentDateIso, daysRemaining) {
    return addDaysIso(currentDateIso, Number(daysRemaining));
  }

  function calculateBatch(batch, referenceDateTime) {
    const duration = batch.durationDays || CHICKEN_INCUBATION_DAYS;
    const started = new Date(`${batch.startDate}T${batch.startTime || "00:00:00"}`);
    const today = referenceDateTime ? new Date(referenceDateTime) : new Date();

    if (Number.isNaN(started.getTime())) {
      return {
        hatchDate: "Not set",
        progress: 0,
        dayText: "Incubation day unavailable",
        daysRemaining: "Start date missing"
      };
    }

    const hatch = new Date(started);
    hatch.setDate(started.getDate() + duration);

    const elapsedMs = today - started;
    const elapsedDays = Math.max(0, Math.floor(elapsedMs / 86400000));
    const currentDay = Math.min(elapsedDays + 1, duration);
    const progress = batch.status === "Completed"
      ? 100
      : Math.min(100, Math.round((elapsedDays / duration) * 100));
    const remaining = Math.max(0, duration - elapsedDays);

    return {
      hatchDate: formatDate(dateToIso(hatch)),
      progress,
      currentIncubationDay: currentDay,
      dayText: "Day " + currentDay + " of " + duration,
      daysRemaining: remaining === 0 ? "Hatch due" : remaining + " days left"
    };
  }

  function getStatusClass(status) {
    if (status === "Active" || status === "Completed") {
      return "status-ok";
    }

    if (status === "Paused") {
      return "status-warning";
    }

    return "status-alert";
  }

  function getSelectedBatch(batches) {
    const activeBatches = getActiveBatches(batches);

    return activeBatches.find(batch => batch.selected) ||
      activeBatches[0] ||
      null;
  }

  return {
    STORAGE_KEY,
    CHICKEN_INCUBATION_DAYS,
    ACTIVE_SLOT_COUNT,
    BATCH_LABEL_MAX_LENGTH,
    createId,
    todayIso,
    normalizeLabel,
    getNextBatchName,
    getNextBatchLabel,
    getBatchLabelError,
    loadBatches,
    saveBatches,
    defaultTurningEnd,
    importDeviceBatches,
    formatDate,
    getCurrentDateContext,
    getBatchIncubationDay,
    getDeviceBatchDay,
    hasValidSensorData,
    getFallbackPredictedHatchDate,
    calculateBatch,
    getStatusClass,
    isActiveBatch,
    getActiveBatches,
    getSelectedBatch
  };
})();

window.HatchBatchStore = HatchBatchStore;
