document.addEventListener("DOMContentLoaded", function () {
  const DEGREE_C = "\u00B0C";

  const chartDataSets = {
    hour: {
      labels: ["5m", "10m", "15m", "20m", "25m", "30m", "35m", "40m"],
      temperature: [37.4, 37.5, 37.6, 37.8, 37.7, 37.9, 38.0, 37.8],
      humidity: [55, 56, 57, 58, 57, 59, 60, 58]
    },
    day: {
      labels: ["12AM", "3AM", "6AM", "9AM", "12PM", "3PM", "6PM", "9PM"],
      temperature: [37.3, 37.4, 37.5, 37.8, 37.9, 37.7, 37.6, 37.8],
      humidity: [54, 55, 56, 58, 60, 59, 57, 58]
    },
    week: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      temperature: [37.5, 37.6, 37.7, 37.8, 37.6, 37.9, 37.8],
      humidity: [55, 56, 58, 57, 59, 60, 58]
    },
    month: {
      labels: ["W1", "W2", "W3", "W4"],
      temperature: [37.5, 37.7, 37.8, 37.6],
      humidity: [55, 58, 60, 57]
    }
  };

  let currentRange = "hour";
  let tempData = chartDataSets.hour.temperature;
  let humidityData = chartDataSets.hour.humidity;
  let chartLabels = chartDataSets.hour.labels;

  let lineHitboxes = [];
  let activeTooltip = null;
  let pinnedTooltip = false;
  let dashboardPredictionRequestId = 0;
  let latestDashboardData = null;

  const environmentCanvas = document.getElementById("environmentChart");
  const dashboardBatchSelect = document.getElementById("dashboardBatchSelect");

  function resizeCanvasForSharpDisplay(canvas, ctx) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

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

    const tempMin = Math.floor(Math.min(...tempData) - 0.5);
    const tempMax = Math.ceil(Math.max(...tempData) + 0.5);

    const humidityMin = Math.floor(Math.min(...humidityData) - 5);
    const humidityMax = Math.ceil(Math.max(...humidityData) + 5);

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

      const points = [];

      data.forEach((value, i) => {
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

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevX = getX(i - 1, data.length);
          const prevY = getY(data[i - 1]);
          const midX = (prevX + x) / 2;

          ctx.bezierCurveTo(midX, prevY, midX, y, x, y);
        }
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
    drawCombinedChart();
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
    environmentCanvas.addEventListener("mousemove", function (event) {
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

    environmentCanvas.addEventListener("click", function (event) {
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

    environmentCanvas.addEventListener("mouseleave", function () {
      environmentCanvas.style.cursor = "default";

      if (!pinnedTooltip) {
        activeTooltip = null;
        renderCharts();
      }
    });

    environmentCanvas.addEventListener(
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

    dashboardBatchSelect.innerHTML = "";
    dashboardBatchSelect.disabled = batches.length === 0;

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
    if (!window.HatchBatchStore || !id) return;

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

  function updateTextData(data) {
    latestDashboardData = data;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const formatTemperature = value => {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(1) + DEGREE_C : "--";
    };

    const formatHumidity = value => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number) + "%" : "--";
    };

    setText("tempValue", formatTemperature(data.temperature));
    setText("humidityValue", formatHumidity(data.humidity));
    setText("relayValue", data.relayStatus || "Heating OFF");
    setText("relayBadge", data.relayBadge || "Bulbs Idle");
    setText("motorValue", data.motorStatus || "Idle");
    setText("motorSubtext", data.motorNote || "Waiting for ESP32 data");
    setText("hatchDayValue", data.predictedDay || "Waiting for data");
    setText(
      "hatchDateValue",
      data.hatchDate || "Waiting for ESP32 sensor data"
    );
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
      relayBadge.className =
        "status-pill " + (data.relayOn ? "status-on" : "status-off");
    }

    updateDashboardBatchData(data);
  }

  async function updateDashboardBatchData(data = {}) {
    if (!window.HatchBatchStore) return;

    const requestId = ++dashboardPredictionRequestId;
    const batches = HatchBatchStore.loadBatches();
    const activeBatches = HatchBatchStore.getActiveBatches(batches);
    const selectedBatch = HatchBatchStore.getSelectedBatch(activeBatches);
    renderDashboardBatchSelect(activeBatches, selectedBatch);

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    if (!selectedBatch) {
      setText("hatchDayValue", "No active batch selected");
      setText("hatchDateValue", "No active batch selected");
      setText("activeBatchValue", "No active batch selected");
      setText("dashboardLaidDate", "Not set");
      setText("dashboardStartDate", "Not set");
      setText("dashboardExpectedHatch", "Not set");
      setText("dashboardBatchProgress", "0% complete");
      return;
    }

    const batchInfo = HatchBatchStore.calculateBatch(selectedBatch);
    const dateContext = HatchBatchStore.getCurrentDateContext(data);
    const dayInfo = HatchBatchStore.getBatchIncubationDay(
      selectedBatch,
      dateContext.dateIso
    );

    setText(
      "activeBatchValue",
      selectedBatch.name + " (" + selectedBatch.count + " eggs)"
    );
    setText("dashboardLaidDate", HatchBatchStore.formatDate(selectedBatch.laidDate));
    setText("dashboardStartDate", HatchBatchStore.formatDate(selectedBatch.startDate));
    setText("dashboardExpectedHatch", "Calculating");
    setText("dashboardBatchProgress", batchInfo.progress + "% complete, " + batchInfo.daysRemaining);

    if (!dayInfo.valid) {
      setText("hatchDayValue", "Prediction unavailable");
      setText("hatchDateValue", dayInfo.message);
      setText("dashboardExpectedHatch", "Not available");
      return;
    }

    setText("hatchDayValue", "Calculating batch prediction");
    setText(
      "hatchDateValue",
      "Current Day: Day " + dayInfo.rawDay + " for " + selectedBatch.name
    );
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
      const prediction = await window.HatchEspApi.predictBatch({
        batchId: selectedBatch.id,
        incubationDay: dayInfo.day
      });

      if (requestId !== dashboardPredictionRequestId) {
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

  function loadSampleData() {
    const sample = {
      temperature: 37.8,
      humidity: 58,
      relayStatus: "Heating ON",
      relayBadge: "Bulbs Active",
      relayOn: true,
      motorStatus: "Idle",
      motorNote: "Next egg turning in 1 hr 20 min",
      predictedDay: "Random Forest",
      hatchDate: "Waiting for ESP32 sensor data",
      lastUpdated: "10:42 AM",
      summaryTemp: "Stable",
      summaryHumidity: "Normal",
      summaryRelay: "Automatic",
      summaryTurning: "Enabled",
      lastTurn: "09:20 AM",
      turnsToday: 0,
      totalTurns: 0,
      actualTurnIntervalMinutes: 0,
      lastAnomaly: "None",
      sensorStatus: "Connected",
      clockStatus: "Ready",
      sdStatus: "Ready",
      wifiStatus: "Online"
    };

    updateTextData(sample);
    renderCharts();
  }

  async function loadESP32Data() {
    try {
      const data = await window.HatchEspApi.getData();

      updateTextData(data);

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

      activeTooltip = null;
      pinnedTooltip = false;

      renderCharts();
    } catch (error) {
      loadSampleData();
    }
  }

  document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => {
      setChartRange(button.dataset.range);
    });
  });

  if (dashboardBatchSelect) {
    dashboardBatchSelect.addEventListener("change", () => {
      setDashboardActiveBatch(dashboardBatchSelect.value);
    });
  }

  loadESP32Data();
  setInterval(loadESP32Data, 5000);

  window.addEventListener("resize", renderCharts);
});
