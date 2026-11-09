document.addEventListener('DOMContentLoaded', () => {
  window.HatchDashboard.init({ adapter: window.HatchDashboardAdapters.local(window.HatchEspApi, window.HatchBatchStore) });
});
