const DEFAULT_ACCOUNT = {
  fullName: "Admin User",
  username: "admin"
};

const DEFAULT_SETTINGS = {
  temperatureOffset: "0.0",
  humidityOffset: "0",
  calibrationNote: ""
};

const HatchSettings = {
  showToast(message, type = "info") {
    if (!window.HatchToast) return;

    if (typeof HatchToast[type] === "function") {
      HatchToast[type](message);
      return;
    }

    HatchToast.show(message, { type });
  },

  setStatus(message, color, type = "info") {
    HatchApp.setStatus(message, color);
    this.showToast(message, type);
  },

  updateAccountDisplay() {
    const fullName =
      HatchApp.getValue("fullName", DEFAULT_ACCOUNT.fullName).trim() ||
      DEFAULT_ACCOUNT.fullName;

    HatchApp.setText("accountDisplayName", fullName);
    HatchApp.setText("accountAvatar", fullName.charAt(0).toUpperCase());
  },

  getAccountData() {
    return {
      fullName: HatchApp.getValue("fullName").trim(),
      username: HatchApp.getValue("username").trim()
    };
  },

  getSettingsData() {
    return {
      temperatureOffset: HatchApp.getValue("temperatureOffset"),
      humidityOffset: HatchApp.getValue("humidityOffset"),
      calibrationNote: HatchApp.getValue("calibrationNote")
    };
  },

  syncRemoteAccount(account, password) {
    if (!window.HatchAuthSession?.saveAccount) return;

    HatchAuthSession.saveAccount(account.username, password).then(result => {
      if (result.available && !result.ok) {
        this.showToast("ESP32 account sync failed.", "warning");
      }
    });
  },

  saveAccount(options = {}) {
    const account = this.getAccountData();
    const { showSuccess = true } = options;

    const newPassword = HatchApp.getValue("newPassword");
    const confirmPassword = HatchApp.getValue("confirmPassword");
    const savedPassword = HatchStorage.get("hatchaiPassword", "");

    if (!account.fullName || !account.username) {
      this.setStatus("Please complete full name and username.", "#DC2626", "warning");
      return false;
    }

    if (newPassword || confirmPassword) {
      if (newPassword.length < 4) {
        this.setStatus("Password must be at least 4 characters.", "#DC2626", "warning");
        return false;
      }

      if (newPassword !== confirmPassword) {
        this.setStatus("Passwords do not match.", "#DC2626", "warning");
        return false;
      }

      HatchStorage.set("hatchaiPassword", newPassword);
    }

    HatchStorage.set("hatchaiAccount", account);
    this.syncRemoteAccount(account, newPassword || savedPassword);

    HatchApp.setValue("newPassword", "");
    HatchApp.setValue("confirmPassword", "");

    this.updateAccountDisplay();

    if (showSuccess) {
      this.setStatus("Account saved successfully.", "#16A34A", "success");
    }

    return true;
  },

  resetAccount() {
    this.applyAccount(DEFAULT_ACCOUNT);

    HatchApp.setValue("newPassword", "");
    HatchApp.setValue("confirmPassword", "");

    HatchStorage.remove("hatchaiAccount");
    HatchStorage.remove("hatchaiPassword");
    this.syncRemoteAccount(DEFAULT_ACCOUNT, "1234");

    this.updateAccountDisplay();
    this.setStatus("Account reset to default.", "#2563EB", "info");
  },

  applyAccount(account) {
    HatchApp.setValue("fullName", account.fullName || DEFAULT_ACCOUNT.fullName);
    HatchApp.setValue("username", account.username || DEFAULT_ACCOUNT.username);
  },

  saveSettings() {
    const accountSaved = this.saveAccount({ showSuccess: false });

    if (!accountSaved) return;

    const settings = this.getSettingsData();

    HatchStorage.set("hatchaiSettings", settings);

    if (window.HatchWifi?.saveWifiStatus) {
      HatchWifi.saveWifiStatus();
    }

    this.setStatus("Settings saved successfully.", "#16A34A", "success");
  },

  resetSettings() {
    this.applySettings(DEFAULT_SETTINGS);

    HatchStorage.remove("hatchaiSettings");
    HatchStorage.remove("hatchaiWifi");

    if (window.HatchWifi?.resetWifiState) {
      HatchWifi.resetWifiState();
    }

    this.setStatus("Settings reset to defaults.", "#2563EB", "info");
  },

  applySettings(settings) {
    HatchApp.setValue(
      "temperatureOffset",
      settings.temperatureOffset || DEFAULT_SETTINGS.temperatureOffset
    );

    HatchApp.setValue(
      "humidityOffset",
      settings.humidityOffset || DEFAULT_SETTINGS.humidityOffset
    );

    HatchApp.setValue(
      "calibrationNote",
      settings.calibrationNote || DEFAULT_SETTINGS.calibrationNote
    );
  },

  loadSavedData() {
    const account = HatchStorage.get("hatchaiAccount", DEFAULT_ACCOUNT);
    const settings = HatchStorage.get("hatchaiSettings", DEFAULT_SETTINGS);

    this.applyAccount(account);
    this.applySettings(settings);
    this.updateAccountDisplay();
  },

  logoutUser() {
    if (window.HatchAuthSession?.logout) {
      HatchAuthSession.logout();
      return;
    }

    window.location.href = "index.html";
  },

  confirmAction(options) {
    if (window.HatchModal?.open && HatchModal.open(options)) {
      return;
    }

    const fallbackConfirm = confirm(options.message || "Are you sure?");

    if (fallbackConfirm && typeof options.onConfirm === "function") {
      options.onConfirm();
    }
  },

  bindEvents() {
    HatchApp.get("saveAccountBtn")?.addEventListener("click", () => {
      this.confirmAction({
        title: "Save account?",
        message: "This will update the account name, username, and password if you entered one.",
        confirmText: "Save account",
        confirmClass: "modal-btn-primary",
        cancelText: "Cancel",
        onConfirm: () => {
          this.saveAccount();
        }
      });
    });

    HatchApp.get("resetAccountBtn")?.addEventListener("click", () => {
      this.confirmAction({
        title: "Reset account?",
        message: "This will restore the default account name and username.",
        confirmText: "Reset account",
        cancelText: "Cancel",
        onConfirm: () => {
          this.resetAccount();
        }
      });
    });

    HatchApp.get("saveSettingsBtn")?.addEventListener("click", () => {
      this.confirmAction({
        title: "Save settings?",
        message: "This will save your account and incubator configuration in this browser.",
        confirmText: "Save settings",
        confirmClass: "modal-btn-primary",
        cancelText: "Cancel",
        onConfirm: () => {
          this.saveSettings();
        }
      });
    });

    HatchApp.get("resetSettingsBtn")?.addEventListener("click", () => {
      this.confirmAction({
        title: "Reset settings?",
        message: "This will clear your saved settings and restore the default HatchAI configuration.",
        confirmText: "Reset defaults",
        cancelText: "Cancel",
        onConfirm: () => {
          this.resetSettings();
        }
      });
    });

    HatchApp.get("logoutBtn")?.addEventListener("click", () => {
      this.confirmAction({
        title: "Log out?",
        message: "You will be returned to the login page.",
        confirmText: "Logout",
        cancelText: "Cancel",
        onConfirm: () => {
          this.logoutUser();
        }
      });
    });

    HatchApp.get("fullName")?.addEventListener("input", () => {
      this.updateAccountDisplay();
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  HatchSettings.bindEvents();
  HatchSettings.loadSavedData();
});
