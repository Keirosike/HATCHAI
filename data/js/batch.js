document.addEventListener("DOMContentLoaded", () => {
  const BatchStore = window.HatchBatchStore;
  let batches = BatchStore.loadBatches();
  let batchPredictions = {};
  let predictionRequestId = 0;

  const batchModal = document.getElementById("batchModal");
  const openBatchModal = document.getElementById("openBatchModal");
  const closeBatchModal = document.getElementById("closeBatchModal");
  const batchForm = document.getElementById("batchForm");
  const batchTableBody = document.getElementById("batchTableBody");
  const batchSlots = document.getElementById("batchSlots");
  const slotCountBadge = document.getElementById("slotCountBadge");

  const batchId = document.getElementById("batchId");
  const batchLabel = document.getElementById("batchLabel");
  const batchName = document.getElementById("batchName");
  const eggType = document.getElementById("eggType");
  const eggCount = document.getElementById("eggCount");
  const laidDate = document.getElementById("laidDate");
  const startDate = document.getElementById("startDate");
  const targetTemp = document.getElementById("targetTemp");
  const targetHumidity = document.getElementById("targetHumidity");
  const batchStatus = document.getElementById("batchStatus");
  const batchPredictionDay = document.getElementById("batchPredictionDay");
  const batchPredictionHatchDay = document.getElementById("batchPredictionHatchDay");
  const batchPredictionDate = document.getElementById("batchPredictionDate");
  const batchPredictionStatus = document.getElementById("batchPredictionStatus");
  const batchNotes = document.getElementById("batchNotes");
  const formStatus = document.getElementById("formStatus");
  const batchModalTitle = document.getElementById("batchModalTitle");
  const batchModalDescription = document.getElementById("batchModalDescription");
  const resetFormBtn = document.getElementById("resetFormBtn");
  const saveBatchBtn = document.getElementById("saveBatchBtn");

  function saveBatches() {
    BatchStore.saveBatches(batches);
  }

  function formatDate(dateInput) {
    return BatchStore.formatDate(dateInput);
  }

  function calculateBatch(batch) {
    return BatchStore.calculateBatch(batch);
  }

  function getStatusClass(status) {
    return BatchStore.getStatusClass(status);
  }

  function getSelectedBatch() {
    return BatchStore.getSelectedBatch(batches);
  }

  function getActiveBatches() {
    return BatchStore.getActiveBatches(batches);
  }

  function getGeneratedBatchName() {
    return BatchStore.getNextBatchName(batches);
  }

  function getGeneratedBatchLabel() {
    return BatchStore.getNextBatchLabel(batches);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function getPrediction(batch) {
    return batchPredictions[batch.id] || {
      currentDayText: "Not calculated",
      predictedHatchDayText: "Not calculated",
      predictedHatchDateText: "Not calculated",
      predictionStatusText: "Waiting for ESP32 prediction",
      statusClass: "status-warning",
      message: "Waiting for ESP32 prediction"
    };
  }

  function makePredictionUnavailable(batch, dayInfo, message, statusClass = "status-alert") {
    return {
      batchId: batch.id,
      currentDay: dayInfo && dayInfo.valid ? dayInfo.rawDay : 0,
      currentDayText: dayInfo && dayInfo.valid ? "Day " + dayInfo.rawDay : "Not set",
      predictedHatchDayText: "Not available",
      predictedHatchDateText: "Not available",
      predictionStatusText: message,
      statusClass,
      message
    };
  }

  function buildPrediction(batch, dayInfo, response, dateContext) {
    if (!response || !response.success) {
      return makePredictionUnavailable(
        batch,
        dayInfo,
        response && response.message
          ? response.message
          : "Prediction unavailable - no valid sensor reading"
      );
    }

    const daysRemaining = Number(response.daysRemaining);
    let predictedDate = response.predictedHatchDate || "";
    let dateSource = response.dateSource || "rtc";

    if (!predictedDate && Number.isFinite(daysRemaining)) {
      predictedDate = BatchStore.getFallbackPredictedHatchDate(
        dateContext.dateIso,
        daysRemaining
      );
      dateSource = "fallback";
    }

    const limitedText = dayInfo.rawDay !== response.incubationDay
      ? " (limited to Day " + response.incubationDay + ")"
      : "";
    const dateSuffix = dateSource === "fallback" ? " (fallback date)" : "";

    return {
      batchId: batch.id,
      currentDay: dayInfo.rawDay,
      currentDayText: "Day " + dayInfo.rawDay + limitedText,
      predictedHatchDay: response.predictedHatchDay,
      predictedHatchDayText: response.predictedHatchDay
        ? "Day " + response.predictedHatchDay
        : "Not available",
      predictedHatchDate: predictedDate,
      predictedHatchDateText: predictedDate
        ? formatDate(predictedDate) + dateSuffix
        : "Not available",
      predictionStatusText: dateSource === "fallback"
        ? "Ready - fallback date"
        : "Ready",
      statusClass: dateSource === "fallback" ? "status-warning" : "status-ok",
      message: response.message || "Prediction ready"
    };
  }

  function setFormPrediction(batchIdValue) {
    const prediction = batchPredictions[batchIdValue] || {
      currentDayText: "Not calculated",
      predictedHatchDayText: "Not calculated",
      predictedHatchDateText: "Not calculated",
      predictionStatusText: "Waiting for ESP32 prediction"
    };

    batchPredictionDay.value = prediction.currentDayText;
    batchPredictionHatchDay.value = prediction.predictedHatchDayText;
    batchPredictionDate.value = prediction.predictedHatchDateText;
    batchPredictionStatus.value = prediction.predictionStatusText;
  }

  function getSlotBatches() {
    const selectedBatch = getSelectedBatch();
    const slotBatches = getActiveBatches().slice(0, 3);

    if (selectedBatch && !slotBatches.some(batch => batch.id === selectedBatch.id)) {
      if (slotBatches.length < 3) {
        slotBatches.push(selectedBatch);
      } else {
        slotBatches[2] = selectedBatch;
      }
    }

    return slotBatches;
  }

  function renderSlots() {
    if (!batchSlots) return;

    const slotBatches = getSlotBatches();
    const runningCount = getActiveBatches().length;

    slotCountBadge.textContent = Math.min(runningCount, 3) + " / 3 Running";
    batchSlots.innerHTML = "";

    for (let index = 0; index < 3; index++) {
      const batch = slotBatches[index];
      const slot = document.createElement("div");

      if (!batch) {
        slot.className = "batch-slot empty";
        slot.innerHTML = `
          <div>
            <div class="slot-number">Slot ${index + 1}</div>
            <div class="slot-name">Empty Slot</div>
            <div class="slot-meta">Ready for another batch</div>
          </div>
          <div class="slot-actions">
            <button class="btn btn-primary btn-small" type="button" data-action="slot-add">Add Batch</button>
          </div>
        `;
        batchSlots.appendChild(slot);
        continue;
      }

      const batchInfo = calculateBatch(batch);
      const prediction = getPrediction(batch);

      slot.className = "batch-slot clickable" + (batch.selected ? " selected" : "");
      slot.dataset.id = batch.id;
      slot.tabIndex = 0;
      slot.setAttribute("role", "button");
      slot.setAttribute("aria-label", "Show " + batch.name + " on the dashboard");
      slot.innerHTML = `
        <div class="slot-top">
          <div>
            <div class="slot-number">Slot ${index + 1}</div>
            <div class="slot-name">${escapeHtml(batch.name)}</div>
          </div>
          <span class="status-pill ${getStatusClass(batch.status)}">${escapeHtml(batch.status)}</span>
        </div>
        <div class="slot-meta">
          <span><strong>${batch.count}</strong> eggs</span>
          <span><strong>${escapeHtml(prediction.currentDayText)}</strong></span>
          <span>Expected: <strong>${escapeHtml(batchInfo.hatchDate)}</strong></span>
          <span>Predicted: <strong>${escapeHtml(prediction.predictedHatchDateText)}</strong></span>
        </div>
        <div class="slot-actions">
          <button class="btn btn-soft btn-small" type="button" data-action="slot-view" data-id="${batch.id}">View</button>
        </div>
      `;
      batchSlots.appendChild(slot);
    }
  }

  function renderTable() {
    batchTableBody.innerHTML = "";

    if (batches.length === 0) {
      batchTableBody.innerHTML = `
        <tr>
          <td colspan="13" class="empty-row">
            No batch records yet. Click Add Batch to create one.
          </td>
        </tr>
      `;
      return;
    }

    batches.forEach(batch => {
      const batchInfo = calculateBatch(batch);
      const prediction = getPrediction(batch);
      const row = document.createElement("tr");

      row.dataset.id = batch.id;

      if (batch.selected) {
        row.classList.add("selected-row");
      }

      row.innerHTML = `
        <td>
          <div class="batch-title">
            <span class="batch-label-badge">${escapeHtml(batch.label)}</span>
            <strong>${escapeHtml(batch.name)}</strong>
          </div>
        </td>
        <td><span class="egg-type"><span class="egg-dot"></span>${batch.type}</span></td>
        <td>${batch.count}</td>
        <td>${formatDate(batch.laidDate)}</td>
        <td>${formatDate(batch.startDate)}</td>
        <td>${batchInfo.hatchDate}</td>
        <td>${escapeHtml(prediction.currentDayText)}</td>
        <td>${escapeHtml(prediction.predictedHatchDayText)}</td>
        <td>${escapeHtml(prediction.predictedHatchDateText)}</td>
        <td><span class="status-pill ${prediction.statusClass}">${escapeHtml(prediction.predictionStatusText)}</span></td>
        <td>${batchInfo.progress}%</td>
        <td><span class="status-pill ${getStatusClass(batch.status)}">${batch.status}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-primary btn-small" type="button" data-action="edit" data-id="${batch.id}">
              Edit
            </button>
            <button class="btn btn-danger btn-small" type="button" data-action="delete" data-id="${batch.id}">
              Delete
            </button>
          </div>
        </td>
      `;

      batchTableBody.appendChild(row);
    });
  }

  function renderSummary() {
    const selectedBatch = getSelectedBatch();
    const activeCount = batches.filter(batch => batch.status === "Active").length;
    const currentBatchLabel = document.getElementById("currentBatchLabel");

    document.getElementById("activeCountBadge").textContent = activeCount + " Active";

    if (!selectedBatch) {
      document.getElementById("currentBatchName").textContent = "No active batch";
      currentBatchLabel.hidden = true;
      currentBatchLabel.textContent = "";
      document.getElementById("currentBatchMeta").textContent = "Add a batch to start tracking incubation progress.";
      document.getElementById("currentBatchPrediction").textContent = "No active batch selected";
      document.getElementById("progressBar").style.width = "0%";
      document.getElementById("progressPercent").textContent = "0% complete";
      document.getElementById("daysRemaining").textContent = "No batch selected";
      document.getElementById("summaryLabel").textContent = "None";
      document.getElementById("summaryBatch").textContent = "None";
      document.getElementById("summaryType").textContent = "None";
      document.getElementById("summaryCount").textContent = "0 eggs";
      document.getElementById("summaryLaid").textContent = "Not set";
      document.getElementById("summaryStarted").textContent = "Not set";
      document.getElementById("summaryCurrentDay").textContent = "Not set";
      document.getElementById("summaryHatch").textContent = "Not set";
      document.getElementById("summaryPredictedDay").textContent = "Not set";
      document.getElementById("summaryPredictedDate").textContent = "Not set";
      document.getElementById("summaryPredictionStatus").textContent = "Not set";
      document.getElementById("summaryStatus").innerHTML = `<span class="status-pill status-warning">No Data</span>`;
      return;
    }

    const batchInfo = calculateBatch(selectedBatch);
    const prediction = getPrediction(selectedBatch);

    document.getElementById("currentBatchName").textContent = selectedBatch.name;
    currentBatchLabel.hidden = false;
    currentBatchLabel.textContent = "Batch Label: " + selectedBatch.label;
    document.getElementById("currentBatchMeta").textContent =
      `${selectedBatch.type} eggs - ${batchInfo.dayText} - Laid ${formatDate(selectedBatch.laidDate)} - Started ${formatDate(selectedBatch.startDate)}`;
    document.getElementById("currentBatchPrediction").textContent =
      `Predicted Hatch Day: ${prediction.predictedHatchDayText} - Predicted Hatch Date: ${prediction.predictedHatchDateText}`;
    document.getElementById("progressBar").style.width = batchInfo.progress + "%";
    document.getElementById("progressPercent").textContent = batchInfo.progress + "% complete";
    document.getElementById("daysRemaining").textContent = batchInfo.daysRemaining;

    document.getElementById("summaryLabel").textContent = selectedBatch.label;
    document.getElementById("summaryBatch").textContent = selectedBatch.name;
    document.getElementById("summaryType").textContent = selectedBatch.type;
    document.getElementById("summaryCount").textContent = selectedBatch.count + " eggs";
    document.getElementById("summaryLaid").textContent = formatDate(selectedBatch.laidDate);
    document.getElementById("summaryStarted").textContent = formatDate(selectedBatch.startDate);
    document.getElementById("summaryCurrentDay").textContent = prediction.currentDayText;
    document.getElementById("summaryHatch").textContent = batchInfo.hatchDate;
    document.getElementById("summaryPredictedDay").textContent = prediction.predictedHatchDayText;
    document.getElementById("summaryPredictedDate").textContent = prediction.predictedHatchDateText;
    document.getElementById("summaryPredictionStatus").innerHTML =
      `<span class="status-pill ${prediction.statusClass}">${escapeHtml(prediction.predictionStatusText)}</span>`;
    document.getElementById("summaryStatus").innerHTML =
      `<span class="status-pill ${getStatusClass(selectedBatch.status)}">${selectedBatch.status}</span>`;
  }

  function renderApp() {
    renderSlots();
    renderTable();
    renderSummary();
  }

  function openModal(mode = "add") {
    batchModal.classList.add("active");
    batchModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    if (mode === "add") {
      batchModalTitle.textContent = "Add Batch";
      batchModalDescription.textContent = "Enter the details for the new incubator batch.";
      formStatus.textContent = "Ready";
      formStatus.className = "status-pill status-ok";
    }
  }

  function closeModal() {
    batchModal.classList.remove("active");
    batchModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function setFormDisabled(disabled) {
    [
      batchLabel,
      eggType,
      eggCount,
      laidDate,
      startDate,
      targetTemp,
      targetHumidity,
      batchStatus,
      batchPredictionDay,
      batchPredictionHatchDay,
      batchPredictionDate,
      batchPredictionStatus,
      batchNotes
    ].forEach(input => {
      input.disabled = disabled;
    });

    batchName.disabled = disabled;
    batchName.readOnly = true;
    saveBatchBtn.style.display = disabled ? "none" : "inline-flex";
    resetFormBtn.style.display = disabled ? "none" : "inline-flex";
  }

  function fillForm(batch) {
    batchId.value = batch.id;
    batchLabel.value = batch.label;
    batchName.value = batch.name;
    batchName.readOnly = true;
    eggType.value = "Chicken";
    eggCount.value = batch.count;
    laidDate.value = batch.laidDate || "";
    startDate.value = batch.startDate;
    targetTemp.value = batch.targetTemp;
    targetHumidity.value = batch.targetHumidity;
    batchStatus.value = batch.status;
    setFormPrediction(batch.id);
    batchNotes.value = batch.notes || "";
  }

  function clearForm() {
    setFormDisabled(false);
    batchForm.reset();

    batchId.value = "";
    batchLabel.value = getGeneratedBatchLabel();
    batchName.value = getGeneratedBatchName();
    batchName.readOnly = true;
    eggType.value = "Chicken";
    eggCount.value = "";
    laidDate.value = new Date().toISOString().slice(0, 10);
    startDate.value = new Date().toISOString().slice(0, 10);
    targetTemp.value = "37.8\u00B0C";
    targetHumidity.value = "58%";
    batchStatus.value = "Active";
    batchPredictionDay.value = "Save batch to calculate prediction";
    batchPredictionHatchDay.value = "Save batch to calculate prediction";
    batchPredictionDate.value = "Save batch to calculate prediction";
    batchPredictionStatus.value = "Not calculated";
    batchNotes.value = "";
    formStatus.textContent = "Ready";
    formStatus.className = "status-pill status-ok";
  }

  function getFormData() {
    const currentId = batchId.value;
    const existingBatch = batches.find(item => item.id === currentId);
    const status = batchStatus.value;

    return {
      id: currentId || BatchStore.createId(),
      label: BatchStore.normalizeLabel(batchLabel.value),
      name: batchName.value.trim() || getGeneratedBatchName(),
      type: "Chicken",
      count: Number(eggCount.value),
      laidDate: laidDate.value,
      startDate: startDate.value,
      targetTemp: targetTemp.value.trim(),
      targetHumidity: targetHumidity.value.trim(),
      status,
      selected: Boolean(existingBatch && existingBatch.selected && status === "Active"),
      notes: batchNotes.value.trim()
    };
  }

  function validateBatch(batch) {
    const labelError = BatchStore.getBatchLabelError(batch.label, batches, batch.id);

    if (labelError) {
      return labelError;
    }

    if (!batch.count || batch.count < 1) {
      return "Egg count must be at least 1.";
    }

    if (!batch.laidDate) {
      return "Egg laid date is required.";
    }

    if (!batch.startDate) {
      return "Start date is required.";
    }

    if (batch.laidDate > batch.startDate) {
      return "Egg laid date cannot be after the incubation start date.";
    }

    return "";
  }

  async function refreshBatchPredictions() {
    if (!window.HatchEspApi || typeof window.HatchEspApi.getData !== "function") {
      return;
    }

    const requestId = ++predictionRequestId;
    const nextPredictions = {};
    let espData = null;

    try {
      espData = await window.HatchEspApi.getData();
    } catch (error) {
      espData = null;
    }

    if (requestId !== predictionRequestId) {
      return;
    }

    const dateContext = BatchStore.getCurrentDateContext(espData || {});
    const hasSensorData = BatchStore.hasValidSensorData(espData || {});

    await Promise.all(batches.map(async batch => {
      const dayInfo = BatchStore.getBatchIncubationDay(batch, dateContext.dateIso);

      if (!dayInfo.valid) {
        nextPredictions[batch.id] = makePredictionUnavailable(
          batch,
          dayInfo,
          dayInfo.message
        );
        return;
      }

      if (!hasSensorData) {
        nextPredictions[batch.id] = makePredictionUnavailable(
          batch,
          dayInfo,
          "Prediction unavailable - no valid sensor reading"
        );
        return;
      }

      try {
        const response = await window.HatchEspApi.predictBatch({
          batchId: batch.id,
          incubationDay: dayInfo.day
        });

        nextPredictions[batch.id] = buildPrediction(
          batch,
          dayInfo,
          response,
          dateContext
        );
      } catch (error) {
        nextPredictions[batch.id] = makePredictionUnavailable(
          batch,
          dayInfo,
          "Prediction unavailable - ESP32 prediction API unavailable",
          "status-warning"
        );
      }
    }));

    if (requestId !== predictionRequestId) {
      return;
    }

    batchPredictions = nextPredictions;
    renderApp();

    if (batchId.value) {
      setFormPrediction(batchId.value);
    }
  }

  function saveBatch(batch) {
    const isUpdate = batches.some(item => item.id === batch.id);

    if (batch.selected) {
      batches = batches.map(item => ({ ...item, selected: false }));
    }

    const existingIndex = batches.findIndex(item => item.id === batch.id);

    if (existingIndex >= 0) {
      batches[existingIndex] = batch;
    } else {
      batches.unshift(batch);
    }

    saveBatches();
    batches = BatchStore.loadBatches();
    renderApp();

    return isUpdate;
  }

  function selectBatch(id) {
    const selectedTarget = batches.find(batch => batch.id === id);

    if (!BatchStore.isActiveBatch(selectedTarget)) {
      return false;
    }

    batches = batches.map(batch => ({
      ...batch,
      selected: batch.id === id
    }));

    saveBatches();
    batches = BatchStore.loadBatches();
    renderApp();
    return true;
  }

  function viewBatch(id) {
    const batch = batches.find(item => item.id === id);

    if (!batch) {
      return;
    }

    fillForm(batch);
    setFormDisabled(true);

    batchModalTitle.textContent = "View Batch";
    batchModalDescription.textContent = "Viewing this batch record. Click Edit in the table to update it.";
    formStatus.textContent = "Viewing";
    formStatus.className = "status-pill status-ok";

    openModal("view");
  }

  function editBatch(id) {
    const batch = batches.find(item => item.id === id);

    if (!batch) {
      return;
    }

    batchModalTitle.textContent = "Edit Batch";
    batchModalDescription.textContent = "Update the selected batch details. The generated batch name stays fixed.";
    formStatus.textContent = "Editing";
    formStatus.className = "status-pill status-warning";

    fillForm(batch);
    setFormDisabled(false);

    openModal("edit");
  }

  function deleteBatch(id) {
    const batch = batches.find(item => item.id === id);

    if (!batch) {
      return;
    }

    window.HatchModal.open({
      title: "Delete batch?",
      message: `Delete "${batch.name}" from your incubator batch records? This action cannot be undone.`,
      confirmText: "Delete Batch",
      cancelText: "Cancel",
      confirmClass: "modal-btn-danger",
      onConfirm: () => {
        batches = batches.filter(item => item.id !== id);

        saveBatches();
        batches = BatchStore.loadBatches();
        renderApp();
        refreshBatchPredictions();
        window.HatchToast.success("Batch deleted.");
      }
    });
  }

  batchTableBody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (button) {
      const action = button.dataset.action;
      const id = button.dataset.id;

      if (action === "edit") {
        editBatch(id);
      }

      if (action === "delete") {
        deleteBatch(id);
      }

      return;
    }

    const row = event.target.closest("tr[data-id]");

    if (!row) {
      return;
    }

    viewBatch(row.dataset.id);
  });

  batchSlots.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (button) {
      const action = button.dataset.action;
      const id = button.dataset.id;

      if (action === "slot-add") {
        clearForm();
        openModal("add");
        return;
      }

      if (action === "slot-view" && id) {
        viewBatch(id);
        return;
      }
    }

    const slot = event.target.closest(".batch-slot[data-id]");

    if (!slot) {
      return;
    }

    if (selectBatch(slot.dataset.id)) {
      refreshBatchPredictions();
      window.HatchToast.success("Dashboard batch updated.");
    }
  });

  batchSlots.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const slot = event.target.closest(".batch-slot[data-id]");

    if (!slot) {
      return;
    }

    event.preventDefault();

    if (selectBatch(slot.dataset.id)) {
      refreshBatchPredictions();
      window.HatchToast.success("Dashboard batch updated.");
    }
  });

  openBatchModal.addEventListener("click", () => {
    clearForm();
    openModal("add");
  });

  closeBatchModal.addEventListener("click", closeModal);

  batchModal.addEventListener("click", event => {
    if (event.target === batchModal) {
      closeModal();
    }
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && batchModal.classList.contains("active")) {
      closeModal();
    }
  });

  resetFormBtn.addEventListener("click", () => {
    clearForm();
    formStatus.textContent = "Reset";
    formStatus.className = "status-pill status-warning";
  });

  batchForm.addEventListener("submit", event => {
    event.preventDefault();

    const batch = getFormData();
    const error = validateBatch(batch);

    if (error) {
      formStatus.textContent = error;
      formStatus.className = "status-pill status-alert";
      window.HatchToast.warning(error);
      return;
    }

    const isUpdate = batches.some(item => item.id === batch.id);

    window.HatchModal.open({
      title: isUpdate ? "Save batch changes?" : "Save new batch?",
      message: `Save "${batch.name}" to your incubator batch records?`,
      confirmText: "Save Batch",
      cancelText: "Cancel",
      confirmClass: "modal-btn-primary",
      onConfirm: () => {
        saveBatch(batch);
        formStatus.textContent = "Saved";
        formStatus.className = "status-pill status-ok";
        closeModal();
        clearForm();
        refreshBatchPredictions();
        window.HatchToast.success(isUpdate ? "Batch changes saved." : "Batch saved.");
      }
    });
  });

  renderApp();
  refreshBatchPredictions();
});
