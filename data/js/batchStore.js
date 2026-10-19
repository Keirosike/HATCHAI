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
    return new Date().toISOString().slice(0, 10);
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

  function normalizeBatch(batch) {
    return {
      id: batch.id || createId(),
      label: normalizeLabel(batch.label),
      name: batch.name || "Chicken Batch",
      type: "Chicken",
      count: Number(batch.count) || 0,
      laidDate: batch.laidDate || batch.layDate || "",
      startDate: batch.startDate || todayIso(),
      targetTemp: batch.targetTemp || "37.8\u00B0C",
      targetHumidity: batch.targetHumidity || "58%",
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
      ? records.map(normalizeBatch).filter(batch => batch.count > 0)
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
        source: "rtc",
        rtcAvailable: true
      };
    }

    return {
      dateIso: todayIso(),
      source: "fallback",
      rtcAvailable: false
    };
  }

  function getBatchIncubationDay(batch, currentDateIso = todayIso()) {
    const started = parseIsoDate(batch.startDate);
    const current = parseIsoDate(currentDateIso);

    if (!started || !current || current < started) {
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

  function calculateBatch(batch) {
    const started = new Date(batch.startDate + "T00:00:00");
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    if (Number.isNaN(started.getTime())) {
      return {
        hatchDate: "Not set",
        progress: 0,
        dayText: "Day 0 of " + CHICKEN_INCUBATION_DAYS,
        daysRemaining: "Start date missing"
      };
    }

    const hatch = new Date(started);
    hatch.setDate(started.getDate() + CHICKEN_INCUBATION_DAYS);

    const elapsedMs = today - started;
    const elapsedDays = Math.max(0, Math.floor(elapsedMs / 86400000));
    const currentDay = Math.min(elapsedDays + 1, CHICKEN_INCUBATION_DAYS);
    const progress = batch.status === "Completed"
      ? 100
      : Math.min(100, Math.round((elapsedDays / CHICKEN_INCUBATION_DAYS) * 100));
    const remaining = Math.max(0, CHICKEN_INCUBATION_DAYS - elapsedDays);

    return {
      hatchDate: formatDate(dateToIso(hatch)),
      progress,
      currentIncubationDay: currentDay,
      dayText: "Day " + currentDay + " of " + CHICKEN_INCUBATION_DAYS,
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
    formatDate,
    getCurrentDateContext,
    getBatchIncubationDay,
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
