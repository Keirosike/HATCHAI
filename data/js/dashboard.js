(function () {
let activeInstance = null;
function init({ adapter, onOnlineStatus = () => {} }) {
  if (activeInstance) throw new Error('A dashboard is already initialized.');
  if (!adapter || !['local', 'online'].includes(adapter.mode)) throw new Error('Dashboard adapter required.');
  const HatchBatchStore = adapter.batchStore;
  let disposed = false;
  const listeners = [];
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  const instance = { destroy() {
    if (disposed) return;
    disposed = true; clearTimeout(dashboardPollTimer); dashboardPredictionRequestId++;
    listeners.forEach(remove => remove()); activeInstance = null;
  }, refresh: () => loadESP32Data() };
  activeInstance = instance;
  const DEGREE_C = "\u00B0C";

  const chartDataSets = Object.fromEntries(
    ["hour", "day", "week", "month"].map(range => [range, { labels: [], temperature: [], humidity: [] }])
  );

  let currentRange = "hour";
  let tempData = chartDataSets.hour.temperature;
  let humidityData = chartDataSets.hour.humidity;
  let chartLabels = chartDataSets.hour.labels;

  let lineHitboxes = [];
  let activeTooltip = null;
  let pinnedTooltip = false;
  let dashboardPredictionRequestId = 0;
  let latestDashboardData = null;
  let lastValidEnvironment = null;
  let dashboardPredictionContext = "";
  let dashboardBatchOptions = "";
  let lastChartRender = "";
  let dashboardLoading = false;
  let dashboardPollTimer = null;
  let dashboardApiTask = Promise.resolve();

  function setText(id, value) {
    const element = document.getElementById(id);
    if (!disposed && element && element.textContent !== value) element.textContent = value;
  }

  function dashboardRequest(action) {
    const task = dashboardApiTask.catch(() => {}).then(action);
    dashboardApiTask = task;
    return task;
  }

  const environmentCanvas = document.getElementById("environmentChart");
  const dashboardBatchSelect = document.getElementById("dashboardBatchSelect");

  function resizeCanvasForSharpDisplay(canvas, ctx) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    return {
      width: rect.width,
      height: rect.height
    };
  }

  function setChartRange(range) {
    if (!chartDataSets[range]) return;

    currentRange = range;

    tempData = chartDataSets[range].temperature;
    humidityData = chartDataSets[range].humidity;
    chartLabels = chartDataSets[range].labels;

    activeTooltip = null;
    pinnedTooltip = false;

    document.querySelectorAll(".filter-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.range === range);
    });

    renderCharts();
  }

  function drawCombinedChart() {
    if (!environmentCanvas) return;

    const ctx = environmentCanvas.getContext("2d");
    const canvas = environmentCanvas;

    const size = resizeCanvasForSharpDisplay(canvas, ctx);

    const w = size.width;
    const h = size.height;

    const isMobile = w < 480;

    const paddingLeft = isMobile ? 42 : 58;
    const paddingRight = isMobile ? 42 : 58;
    const paddingTop = isMobile ? 76 : 52;
    const paddingBottom = isMobile ? 56 : 46;

    const titleFont = isMobile
      ? "600 13px Inter, Arial, sans-serif"
      : "600 15px Inter, Arial, sans-serif";

    const normalFont = isMobile
      ? "10px Inter, Arial, sans-serif"
      : "12px Inter, Arial, sans-serif";

    const smallFont = isMobile
      ? "9px Inter, Arial, sans-serif"
      : "11px Inter, Arial, sans-serif";

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);

    if (tempData.length < 2 || humidityData.length < 2) return;

    const tempColor = "#D97706";
    const humidityColor = "#2563EB";
    const gridColor = "#E5E7EB";
    const textColor = "#4B5563";
    const darkText = "#111827";

    const temperatures=tempData.filter(Number.isFinite),humidities=humidityData.filter(Number.isFinite);
    if(!temperatures.length||!humidities.length)return;
    const tempMin = Math.floor(Math.min(...temperatures) - 0.5);
    const tempMax = Math.ceil(Math.max(...temperatures) + 0.5);

    const humidityMin = Math.floor(Math.min(...humidities) - 5);
    const humidityMax = Math.ceil(Math.max(...humidities) + 5);

    const chartWidth = w - paddingLeft - paddingRight;
    const chartHeight = h - paddingTop - paddingBottom;

    function getX(index, length) {
      if (length === 1) return paddingLeft;
      return paddingLeft + (index * chartWidth) / (length - 1);
    }

    function getTempY(value) {
      return paddingTop + ((tempMax - value) / (tempMax - tempMin)) * chartHeight;
    }

    function getHumidityY(value) {
      return paddingTop + ((humidityMax - value) / (humidityMax - humidityMin)) * chartHeight;
    }

    ctx.fillStyle = darkText;
    ctx.font = titleFont;
    ctx.textAlign = "left";
    ctx.fillText("Temperature & Humidity Trend", paddingLeft, 24);

    ctx.font = normalFont;
    ctx.textAlign = "left";

    lineHitboxes = [];

    if (isMobile) {
      const tempText = "Temperature " + DEGREE_C;
      const humidityText = "Humidity %";

      const boxSize = 10;
      const gap = 8;

      const tempWidth = boxSize + gap + ctx.measureText(tempText).width;
      const humidityWidth = boxSize + gap + ctx.measureText(humidityText).width;

      const tempStartX = (w - tempWidth) / 2;
      const humidityStartX = (w - humidityWidth) / 2;

      ctx.fillStyle = tempColor;
      ctx.fillRect(tempStartX, 36, boxSize, boxSize);
      ctx.fillStyle = textColor;
      ctx.fillText(tempText, tempStartX + boxSize + gap, 45);

      ctx.fillStyle = humidityColor;
      ctx.fillRect(humidityStartX, 54, boxSize, boxSize);
      ctx.fillStyle = textColor;
      ctx.fillText(humidityText, humidityStartX + boxSize + gap, 63);
    } else {
      const tempText = "Temperature " + DEGREE_C;
      const humidityText = "Humidity %";

      const boxSize = 12;
      const gap = 8;
      const itemGap = 28;
      const y = 34;

      const tempWidth = boxSize + gap + ctx.measureText(tempText).width;
      const humidityWidth = boxSize + gap + ctx.measureText(humidityText).width;
      const totalWidth = tempWidth + itemGap + humidityWidth;

      let startX = (w - totalWidth) / 2;

      ctx.fillStyle = tempColor;
      ctx.fillRect(startX, y, boxSize, boxSize);
      ctx.fillStyle = textColor;
      ctx.fillText(tempText, startX + boxSize + gap, y + 10);

      startX += tempWidth + itemGap;

      ctx.fillStyle = humidityColor;
      ctx.fillRect(startX, y, boxSize, boxSize);
      ctx.fillStyle = textColor;
      ctx.fillText(humidityText, startX + boxSize + gap, y + 10);
    }

    ctx.font = smallFont;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = paddingTop + (i * chartHeight) / 4;

      ctx.beginPath();
      ctx.strokeStyle = gridColor;
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(w - paddingRight, y);
      ctx.stroke();

      const tempValue = tempMax - ((tempMax - tempMin) * i) / 4;
      ctx.fillStyle = tempColor;
      ctx.textAlign = "right";
      ctx.fillText(tempValue.toFixed(1) + DEGREE_C.charAt(0), paddingLeft - 8, y + 4);

      const humidityValue = humidityMax - ((humidityMax - humidityMin) * i) / 4;
      ctx.fillStyle = humidityColor;
      ctx.textAlign = "left";
      ctx.fillText(Math.round(humidityValue) + "%", w - paddingRight + 8, y + 4);
    }

    ctx.strokeStyle = gridColor;
    ctx.strokeRect(paddingLeft, paddingTop, chartWidth, chartHeight);

    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.font = smallFont;

    chartLabels.forEach((label, i) => {
      const x = getX(i, chartLabels.length);
      ctx.fillText(label, x, h - 18);
    });

    function drawSmoothLine(type, data, color, getY, unit, displayName) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = isMobile ? 2.5 : 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const points = [];let previousValid=false;

      data.forEach((value, i) => {
        if(!Number.isFinite(value)){previousValid=false;return;}
        const x = getX(i, data.length);
        const y = getY(value);

        points.push({
          x,
          y,
          value,
          label: chartLabels[i],
          unit,
          color,
          type,
          displayName
        });

        if (!previousValid) {
          ctx.moveTo(x, y);
        } else {
          const prevX = getX(i - 1, data.length);
          const prevY = getY(data[i - 1]);
          const midX = (prevX + x) / 2;

          ctx.bezierCurveTo(midX, prevY, midX, y, x, y);
        }
        previousValid=true;
      });

      ctx.stroke();

      lineHitboxes.push({
        type,
        color,
        unit,
        displayName,
        points
      });
    }

    drawSmoothLine("temperature", tempData, tempColor, getTempY, DEGREE_C, "Temperature");
    drawSmoothLine("humidity", humidityData, humidityColor, getHumidityY, "%", "Humidity");

    if (activeTooltip) {
      drawTooltip(ctx, activeTooltip, w, h);
    }

    ctx.font = isMobile
      ? "600 10px Inter, Arial, sans-serif"
      : "600 12px Inter, Arial, sans-serif";

    ctx.fillStyle = tempColor;
    ctx.textAlign = "left";
    ctx.fillText("Temp " + DEGREE_C, 8, paddingTop - 10);

    ctx.fillStyle = humidityColor;
    ctx.textAlign = "right";
    ctx.fillText("Humidity %", w - 8, paddingTop - 10);
  }

  function drawTooltip(ctx, tooltip, canvasWidth, canvasHeight) {
    const text = `${tooltip.displayName}: ${tooltip.value}${tooltip.unit}`;
    const labelText = tooltip.label ? `Time: ${tooltip.label}` : "";

    ctx.save();

    ctx.font = "600 11px Inter, Arial, sans-serif";
    const textWidth = Math.max(
      ctx.measureText(text).width,
      ctx.measureText(labelText).width
    );

    const boxWidth = textWidth + 20;
    const boxHeight = labelText ? 46 : 30;

    let boxX = tooltip.x + 12;
    let boxY = tooltip.y - boxHeight - 12;

    if (boxX + boxWidth > canvasWidth - 8) {
      boxX = tooltip.x - boxWidth - 12;
    }

    if (boxY < 8) {
      boxY = tooltip.y + 16;
    }

    if (boxY + boxHeight > canvasHeight - 8) {
      boxY = canvasHeight - boxHeight - 8;
    }

    ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
    ctx.beginPath();

    if (ctx.roundRect) {
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
    } else {
      ctx.rect(boxX, boxY, boxWidth, boxHeight);
    }

    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.font = "600 11px Inter, Arial, sans-serif";
    ctx.fillText(text, boxX + 10, boxY + 18);

    if (labelText) {
      ctx.font = "10px Inter, Arial, sans-serif";
      ctx.fillText(labelText, boxX + 10, boxY + 34);
    }

    ctx.restore();
  }

  function renderCharts() {
    if (!environmentCanvas) return;
    const rect = environmentCanvas.getBoundingClientRect();
    const state = JSON.stringify([currentRange, tempData, humidityData, chartLabels,
      rect.width, rect.height, window.devicePixelRatio || 1, activeTooltip]);
    if (state === lastChartRender) return;
    drawCombinedChart();
    lastChartRender = state;
  }

  function getCanvasPointerPosition(event) {
    const rect = environmentCanvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function getTouchPointerPosition(event) {
    const rect = environmentCanvas.getBoundingClientRect();
    const touch = event.touches[0] || event.changedTouches[0];

    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  }

  function getNearestLinePoint(x, y) {
    const tolerance = 14;
    let nearest = null;
    let nearestDistance = Infinity;

    function distanceToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;

      if (dx === 0 && dy === 0) {
        return {
          distance: Math.hypot(px - ax, py - ay),
          t: 0,
          x: ax,
          y: ay
        };
      }

      let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));

      const closestX = ax + t * dx;
      const closestY = ay + t * dy;

      return {
        distance: Math.hypot(px - closestX, py - closestY),
        t,
        x: closestX,
        y: closestY
      };
    }

    for (const line of lineHitboxes) {
      for (let i = 0; i < line.points.length - 1; i++) {
        const p1 = line.points[i];
        const p2 = line.points[i + 1];

        const result = distanceToSegment(
          x,
          y,
          p1.x,
          p1.y,
          p2.x,
          p2.y
        );

        if (result.distance < nearestDistance && result.distance <= tolerance) {
          const interpolatedValue =
            p1.value + (p2.value - p1.value) * result.t;

          nearestDistance = result.distance;

          nearest = {
            x: result.x,
            y: result.y,
            value:
              line.type === "temperature"
                ? interpolatedValue.toFixed(1)
                : Math.round(interpolatedValue),
            label: `${p1.label} - ${p2.label}`,
            unit: line.unit,
            color: line.color,
            type: line.type,
            displayName: line.displayName
          };
        }
      }
    }

    return nearest;
  }

  if (environmentCanvas) {
    listen(environmentCanvas, "mousemove", function (event) {
      const pos = getCanvasPointerPosition(event);
      const point = getNearestLinePoint(pos.x, pos.y);

      if (point) {
        environmentCanvas.style.cursor = "pointer";

        if (!pinnedTooltip) {
          activeTooltip = point;
          renderCharts();
        }
      } else {
        environmentCanvas.style.cursor = "default";

        if (!pinnedTooltip && activeTooltip) {
          activeTooltip = null;
          renderCharts();
        }
      }
    });

    listen(environmentCanvas, "click", function (event) {
      const pos = getCanvasPointerPosition(event);
      const point = getNearestLinePoint(pos.x, pos.y);

      if (point) {
        activeTooltip = point;
        pinnedTooltip = true;
        renderCharts();
      } else {
        activeTooltip = null;
        pinnedTooltip = false;
        renderCharts();
      }
    });

    listen(environmentCanvas, "mouseleave", function () {
      environmentCanvas.style.cursor = "default";

      if (!pinnedTooltip) {
        activeTooltip = null;
        renderCharts();
      }
    });

    listen(environmentCanvas,
      "touchstart",
      function (event) {
        const pos = getTouchPointerPosition(event);
        const point = getNearestLinePoint(pos.x, pos.y);

        if (!point) return;

        event.preventDefault();

        activeTooltip = point;
        pinnedTooltip = true;
        renderCharts();
      },
      { passive: false }
    );
  }

  function renderDashboardBatchSelect(batches, selectedBatch) {
    if (!dashboardBatchSelect) return;

    const options = JSON.stringify(batches.map(batch => [batch.id, batch.name]));
    dashboardBatchSelect.disabled = batches.length === 0;
    if (options === dashboardBatchOptions) {
      const selected = selectedBatch ? selectedBatch.id : batches[0]?.id || "";
      if (dashboardBatchSelect.value !== selected) dashboardBatchSelect.value = selected;
      return;
    }
    dashboardBatchOptions = options;
    dashboardBatchSelect.replaceChildren();

    if (batches.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No active batches";
      dashboardBatchSelect.appendChild(option);
      return;
    }

    batches.forEach(batch => {
      const option = document.createElement("option");
      option.value = batch.id;
      option.textContent = batch.name;
      dashboardBatchSelect.appendChild(option);
    });

    dashboardBatchSelect.value = selectedBatch ? selectedBatch.id : batches[0].id;
  }

  function setDashboardActiveBatch(id) {
    if (!HatchBatchStore || !id) return;

    const currentBatches = HatchBatchStore.loadBatches();
    const selectedTarget = currentBatches.find(batch => batch.id === id);

    if (!HatchBatchStore.isActiveBatch(selectedTarget)) {
      return;
    }

    const nextBatches = currentBatches.map(batch => ({
      ...batch,
      selected: batch.id === id
    }));

    HatchBatchStore.saveBatches(nextBatches);
    dashboardPredictionRequestId++;
    updateDashboardBatchData(latestDashboardData || {});
  }

  async function updateTextData(data) {
    latestDashboardData = data;
    setText("safetyBanner", data.safety?.message || "Safety status unavailable: check firmware version.");
    const safetyBanner = document.getElementById("safetyBanner");
    const safetyLevel = data.safety?.level || (data.safety?.critical ? "critical" : "ok");
    if (safetyBanner && safetyBanner.dataset.level !== safetyLevel) safetyBanner.dataset.level = safetyLevel;

    const formatTemperature = value => {
      const number = Number(value);
      return value !== null && Number.isFinite(number) ? number.toFixed(1) + DEGREE_C : "--";
    };

    const formatHumidity = value => {
      const number = Number(value);
      return value !== null && Number.isFinite(number) ? Math.round(number) + "%" : "--";
    };

    const sensorFresh = data.sensorValid !== false && data.temperature != null && data.humidity != null &&
      Number.isFinite(Number(data.temperature)) && Number.isFinite(Number(data.humidity));
    if (sensorFresh) lastValidEnvironment = { temperature: data.temperature, humidity: data.humidity };
    const shown = sensorFresh ? data : lastValidEnvironment;
    setText("tempValue", formatTemperature(shown?.temperature ?? null));
    setText("humidityValue", formatHumidity(shown?.humidity ?? null));
    const note = sensorFresh ? (data.sensorError ? 'Last valid reading — sensor retrying' : '') :
      lastValidEnvironment ? 'Last valid reading — sensor unavailable' : 'Waiting for a valid sensor reading';
    const targetNote=data.control?.targetTemperature!=null ? `Target ${Number(data.control.targetTemperature).toFixed(1)}${DEGREE_C}` : '';
    setText("temperatureReadingNote", [note,targetNote].filter(Boolean).join(' · ') || 'Shared incubator temperature');
    setText("humidityReadingNote", note || 'Shared incubator humidity');
    setText("relayValue", data.relayStatus || "Heating OFF");
    setText("relayBadge", data.control?.heaterControl==='pid_tpo' && Number.isFinite(data.control.heaterDutyPercent) ?
      `PID ${data.control.heaterDutyPercent.toFixed(1)}% · ${data.relayOn ? 'ON' : 'OFF'}` : data.relayBadge || "Bulb Idle");
    setText("motorValue", data.motorStatus || "Idle");
    setText("motorSubtext", data.motorNote || "Waiting for ESP32 data");
    if (!HatchBatchStore) {
      setText("hatchDayValue", data.predictedDay || "Waiting for data");
      setText("hatchDateValue", data.hatchDate || "Waiting for ESP32 sensor data");
    }
    setText("lastUpdated", "Last updated: " + (data.lastUpdated || "--"));
    setText("summaryTemp", data.summaryTemp || "No Data");
    setText("summaryHumidity", data.summaryHumidity || "No Data");
    setText("summaryRelay", data.summaryRelay || "Manual");
    setText("summaryTurning", data.summaryTurning || "Manual");
    setText("lastTurnValue", data.lastTurn || "None");
    setText("turnsTodayValue", String(data.turnsToday ?? 0));
    setText("totalTurnsValue", String(data.totalTurns ?? 0));
    setText(
      "actualTurnIntervalValue",
      data.actualTurnIntervalMinutes
        ? data.actualTurnIntervalMinutes + " min"
        : "Not measured"
    );
    setText("lastAnomalyValue", data.lastAnomaly || "None");
    setText("sensorStatusValue", data.sensorStatus || "No reading");
    setText("rtcValue", data.clockStatus || "Not detected");
    setText("sdValue", data.sdStatus || "Not detected");
    setText("wifiValue", data.wifiStatus || "Offline");
    setText("wifiStatus", data.wifiStatus || "Offline");

    const relayBadge = document.getElementById("relayBadge");
    if (relayBadge) {
      const className = "status-pill " + (data.relayOn ? "status-on" : "status-off");
      if (relayBadge.className !== className) relayBadge.className = className;
    }

    await updateDashboardBatchData(data);
  }

  async function updateDashboardBatchData(data = {}) {
    if (!HatchBatchStore) return;

    const requestId = ++dashboardPredictionRequestId;
    const batches = HatchBatchStore.loadBatches();
    const activeBatches = HatchBatchStore.getActiveBatches(batches);
    const selectedBatch = HatchBatchStore.getSelectedBatch(activeBatches);
    renderDashboardBatchSelect(activeBatches, selectedBatch);

    if (!selectedBatch) {
      dashboardPredictionContext = "";
      setText("hatchDayValue", "No active batch selected");
      setText("hatchDateValue", "No active batch selected");
      setText("activeBatchValue", "No active batch selected");
      setText("dashboardLaidDate", "Not set");
      setText("dashboardStartDate", "Not set");
      setText("dashboardExpectedHatch", "Not set");
      setText("dashboardBatchProgress", "0% complete");
      return;
    }

    const dateContext = HatchBatchStore.getCurrentDateContext(data);
    const batchInfo = HatchBatchStore.calculateBatch(selectedBatch, dateContext.dateTime);
    const dayInfo = HatchBatchStore.getDeviceBatchDay(selectedBatch,data) || HatchBatchStore.getBatchIncubationDay(
      selectedBatch,
      dateContext.dateTime || dateContext.dateIso
    );
    const context = JSON.stringify([selectedBatch.id, selectedBatch.startDate, dateContext.dateIso, dayInfo.rawDay]);
    const changedContext = context !== dashboardPredictionContext;
    dashboardPredictionContext = context;

    setText(
      "activeBatchValue",
      selectedBatch.name + " (" + (selectedBatch.count || "Unknown") + " eggs)"
    );
    setText("dashboardLaidDate", HatchBatchStore.formatDate(selectedBatch.laidDate));
    setText("dashboardStartDate", HatchBatchStore.formatDate(selectedBatch.startDate));

    if (!dayInfo.valid) {
      setText("hatchDayValue", "Prediction unavailable");
      setText("hatchDateValue", dayInfo.message);
      setText("dashboardExpectedHatch", "Not available");
      setText("dashboardBatchProgress", "Incubation day unavailable");
      return;
    }

    if (changedContext) {
      setText("dashboardExpectedHatch", "Calculating");
      setText("hatchDayValue", "Calculating batch prediction");
      setText("hatchDateValue", "Current Day: Day " + dayInfo.rawDay + " for " + selectedBatch.name);
    }
    setText(
      "dashboardBatchProgress",
      "Current Day: Day " + dayInfo.rawDay + ", " + batchInfo.progress + "% complete"
    );

    if (!HatchBatchStore.hasValidSensorData(data)) {
      setText("hatchDayValue", "Prediction unavailable");
      setText("hatchDateValue", "Prediction unavailable - no valid sensor reading");
      setText("dashboardExpectedHatch", "Not available");
      return;
    }

    try {
      const prediction = await dashboardRequest(() => requestId === dashboardPredictionRequestId ?
        adapter.predictBatch({ batchId: selectedBatch.id, incubationDay: dayInfo.day }) : null);

      if (requestId !== dashboardPredictionRequestId || !prediction) {
        return;
      }

      if (!prediction.success) {
        setText("hatchDayValue", "Prediction unavailable");
        setText(
          "hatchDateValue",
          prediction.message || "Prediction unavailable"
        );
        setText("dashboardExpectedHatch", "Not available");
        return;
      }

      const daysRemaining = Number(prediction.daysRemaining);
      let predictedDate = prediction.predictedHatchDate || "";
      let dateSuffix = "";

      if (!predictedDate && Number.isFinite(daysRemaining)) {
        predictedDate = HatchBatchStore.getFallbackPredictedHatchDate(
          dateContext.dateIso,
          daysRemaining
        );
        dateSuffix = " (fallback date)";
      }

      const predictedDateText = predictedDate
        ? HatchBatchStore.formatDate(predictedDate) + dateSuffix
        : "Not available";

      setText(
        "hatchDayValue",
        prediction.predictedHatchDay
          ? "Predicted Hatch Day: Day " + prediction.predictedHatchDay
          : "Prediction unavailable"
      );
      setText("hatchDateValue", "Predicted Hatch Date: " + predictedDateText);
      setText("dashboardExpectedHatch", predictedDateText);
    } catch (error) {
      if (requestId !== dashboardPredictionRequestId) {
        return;
      }

      setText("hatchDayValue", "Prediction unavailable");
      setText("hatchDateValue", "Prediction unavailable - ESP32 prediction API unavailable");
      setText("dashboardExpectedHatch", "Not available");
    }
  }



  async function loadESP32Data() {
    if (disposed || dashboardLoading || document.hidden) return;
    dashboardLoading = true;
    try {
      const data = await dashboardRequest(() => adapter.getData());
      if (disposed) return;
      if (adapter.mode === 'online') {
        renderOnline(data);
        return;
      }
      const previousChart = JSON.stringify([tempData, humidityData, chartLabels]);

      await updateTextData(data);
      setText("chartStatus", "Live");

      if (
        data.history &&
        data.history.hour &&
        data.history.day &&
        data.history.week &&
        data.history.month
      ) {
        chartDataSets.hour = data.history.hour;
        chartDataSets.day = data.history.day;
        chartDataSets.week = data.history.week;
        chartDataSets.month = data.history.month;

        tempData = chartDataSets[currentRange].temperature;
        humidityData = chartDataSets[currentRange].humidity;
        chartLabels = chartDataSets[currentRange].labels;
      } else if (
        Array.isArray(data.temperatureHistory) &&
        Array.isArray(data.humidityHistory)
      ) {
        chartDataSets.hour.temperature = data.temperatureHistory;
        chartDataSets.hour.humidity = data.humidityHistory;

        if (currentRange === "hour") {
          tempData = data.temperatureHistory;
          humidityData = data.humidityHistory;
          chartLabels = chartDataSets.hour.labels;
        }
      }

      if (previousChart !== JSON.stringify([tempData, humidityData, chartLabels])) {
        activeTooltip = null;
        pinnedTooltip = false;
      }

      renderCharts();
    } catch (error) {
      if (disposed) return;
      if (adapter.mode === 'online') {
        clearOnline();
        setText('safetyBanner', error.message);
        setText('onlineIncubatorInfo', 'Account access could not be verified. Refresh or sign in again.');
        onOnlineStatus(false);
        return;
      }
      setText("temperatureReadingNote", "Last reading — connection lost");
      setText("humidityReadingNote", "Last reading — connection lost");
      setText("wifiStatus", "Unavailable");
      setText("safetyBanner", "Connection lost. Current temperature safety status is unavailable.");
      const safetyBanner = document.getElementById("safetyBanner");
      if (safetyBanner && safetyBanner.dataset.level !== "warning") safetyBanner.dataset.level = "warning";
      setText("wifiValue", "Unavailable");
      setText("chartStatus", latestDashboardData ? "Offline - last data" : "No data");
      setText("lastUpdated", latestDashboardData ?
        "Connection lost - last reading: " + (latestDashboardData.lastUpdated || "unknown") :
        "ESP32 unavailable - waiting for data");
    } finally {
      dashboardLoading = false;
      scheduleDashboardPoll();
    }
  }

  function scheduleDashboardPoll() {
    clearTimeout(dashboardPollTimer);
    if (!disposed && !document.hidden) dashboardPollTimer = setTimeout(loadESP32Data, adapter.pollMs);
  }

  document.querySelectorAll(".filter-btn").forEach(button => {
    listen(button, "click", () => {
      setChartRange(button.dataset.range);
    });
  });

  if (dashboardBatchSelect) {
    listen(dashboardBatchSelect, "change", () => {
      setDashboardActiveBatch(dashboardBatchSelect.value);
    });
  }

  if (adapter.mode === 'online') clearOnline();
  instance.ready = loadESP32Data();
  listen(document, "visibilitychange", () => {
    if (document.hidden) clearTimeout(dashboardPollTimer);
    else scheduleDashboardPoll();
  });

  listen(window, "resize", renderCharts);
  return instance;

  function clearOnline() {
    const unknown = ['tempValue', 'humidityValue', 'relayValue', 'motorValue', 'hatchDayValue', 'hatchDateValue',
      'activeBatchValue', 'dashboardLaidDate', 'dashboardStartDate', 'dashboardExpectedHatch', 'dashboardBatchProgress',
      'summaryTemp', 'summaryHumidity', 'summaryRelay', 'summaryTurning', 'lastTurnValue', 'turnsTodayValue',
      'totalTurnsValue', 'actualTurnIntervalValue', 'lastAnomalyValue', 'sensorStatusValue', 'rtcValue', 'sdValue', 'wifiValue'];
    unknown.forEach(id => setText(id, 'Unavailable'));
    // Unknown words use the existing status-value typography, not numeric sizing.
    ['tempValue','humidityValue'].forEach(id=>document.getElementById(id)?.classList.add('value-small'));
    ['temperatureReadingNote', 'humidityReadingNote', 'relayBadge', 'motorSubtext', 'chartStatus'].forEach(id => setText(id, 'Monitoring not connected yet'));
    setText('wifiStatus', 'Online account');
    setText('lastUpdated', 'Last synchronization: unavailable');
    setText('safetyBanner', 'Monitoring not connected yet. Safety and incubation controls remain local.');
    setText('onlineVerification', 'Account access is being checked.');
    if (dashboardBatchSelect) dashboardBatchSelect.disabled = true;
    renderCharts();
  }
  function renderOnline(data) {
    clearOnline();
    setText('onlineIncubatorInfo', data.incubators.length ? data.incubators.map(row => row.device_name + ' (' + row.device_id + ')').join(' · ') :
      'No incubator is available to this account. Check ownership and access policies.');
    setText('onlineVerification', data.incubators.length ? 'Authenticated incubator access verified.' : 'No authorized incubator returned.');
    onOnlineStatus(data.incubators.length > 0);
    // This API does not provide a telemetry timestamp. Do not substitute fetch time.
    setText('lastUpdated', data.lastSyncedAt ? 'Last synchronization: ' + data.lastSyncedAt : 'Last synchronization: unavailable');
    const cloud=data.synchronized;
    if(!cloud)return;
    setText('wifiStatus',cloud.connection==='stale'?'Stale':cloud.online?'Online':'Offline');
    setText('safetyBanner',cloud.connection==='stale'?'Telemetry is stale; current readings are hidden. Hardware controls remain local.':cloud.online?'Cloud monitoring; hardware controls remain local.':'Incubator offline: readings are no longer current. Hardware controls remain local.');
    if(cloud.alerts?.length){const alert=cloud.alerts[0];setText('lastAnomalyValue',alert.kind.replaceAll('_',' ')+' · '+alert.status+' · '+new Date(alert.createdAt).toLocaleString());}
    const sample=cloud.online&&cloud.connection!=='stale'?cloud.latest?.sample:null;
    if(sample){
      if(sample.sensorValid){setText('tempValue',(sample.temperatureCenti/100).toFixed(1)+DEGREE_C);setText('humidityValue',(sample.humidityCenti/100).toFixed(1)+'%');setText('temperatureReadingNote','Synchronized sensor reading');setText('humidityReadingNote','Synchronized sensor reading');}
      setText('sensorStatusValue',sample.sensorValid?'Valid':'No valid reading');
      setText('relayValue',sample.heaterOn?'Heating ON':'Heating OFF');setText('relayBadge','Reported output command');
      setText('motorValue',sample.lowerOn||sample.upperOn?'Turning':'Idle');setText('motorSubtext','Lower: '+(sample.lowerOn?'ON':'OFF')+' / Upper: '+(sample.upperOn?'ON':'OFF'));
      setText('summaryRelay',sample.autoMode?'Automatic':'Manual');setText('summaryTurning',sample.lowerOn||sample.upperOn?'Turning':'Idle');
    }
    for(const range of ['hour','day','week','month']){
      if(cloud.historyKind==='utc-30-minute'){
        const end=Math.floor(Date.parse(cloud.serverTime)/1800000)*1800000;
        const start=end-(range==='hour'?3600000:86400000);
        const byTime=new Map(cloud.history.map(p=>[Date.parse(p.intervalStart),p]));const points=[];
        for(let at=start;at<end;at+=1800000){const p=byTime.get(at);points.push({at,t:p?p.averageTemperatureCenti/100:null,h:p?p.averageHumidityCenti/100:null});}
        chartDataSets[range]={labels:points.map(p=>new Date(p.at).toLocaleString()),temperature:points.map(p=>p.t),humidity:points.map(p=>p.h)};
      }else{
        const points=cloud.history.filter(p=>p.sample.sensorValid&&(range!=='hour'||Date.parse(p.capturedAt)>=Date.parse(cloud.serverTime)-3600000));
        chartDataSets[range]={labels:points.map(p=>new Date(p.capturedAt).toLocaleTimeString()),temperature:points.map(p=>p.sample.temperatureCenti/100),humidity:points.map(p=>p.sample.humidityCenti/100)};
      }
    }
    document.querySelectorAll('[data-range="week"],[data-range="month"]').forEach(button=>button.disabled=true);
    tempData=chartDataSets[currentRange].temperature;humidityData=chartDataSets[currentRange].humidity;chartLabels=chartDataSets[currentRange].labels;
    setText('chartStatus',cloud.history.length?(cloud.historyKind==='utc-30-minute'?'30-minute UTC averages; gaps indicate unavailable history':'Synchronized samples (up to 24 hours)'):'No synchronized history');renderCharts();

  }
}
window.HatchDashboard = Object.freeze({ init });
})();
