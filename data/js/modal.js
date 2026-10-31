window.HatchModal = {
  modal: null,
  title: null,
  message: null,
  confirmBtn: null,
  cancelBtn: null,
  onConfirm: null,
  initialized: false,
  previousFocus: null,

  init() {
    if (this.initialized) return true;

    this.modal = document.getElementById("confirmModal");
    this.title = document.getElementById("modalTitle");
    this.message = document.getElementById("modalMessage");
    this.confirmBtn = document.getElementById("modalConfirmBtn");
    this.cancelBtn = document.getElementById("modalCancelBtn");

    if (!this.modal || !this.title || !this.message || !this.confirmBtn || !this.cancelBtn) {
      console.error("Modal elements are missing.");
      return false;
    }

    this.confirmBtn.addEventListener("click", () => {
      if (typeof this.onConfirm === "function") {
        this.onConfirm();
      }

      this.close();
    });

    this.cancelBtn.addEventListener("click", () => {
      this.close();
    });

    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) {
        this.close();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!this.modal.classList.contains("active")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation(); // dismiss only this top confirmation dialog
        this.close();
      } else if (event.key === "Tab") {
        const buttons = [this.confirmBtn, this.cancelBtn];
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault();
        buttons[index < 0 ? 1 : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    });

    this.initialized = true;
    return true;
  },

  open(options = {}) {
    if (!this.modal) {
      this.init();
    }

    if (!this.modal) {
      console.error("Modal is not initialized.");
      return false;
    }

    const {
      title = "Are you sure?",
      message = "This action cannot be undone.",
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmClass = "modal-btn-danger",
      onConfirm = null,
      details = [],
      notice = ""
    } = options;

    this.title.textContent = title;
    this.message.textContent = message;
    this.confirmBtn.textContent = confirmText;
    this.cancelBtn.textContent = cancelText;
    this.confirmBtn.className = "modal-btn " + confirmClass;
    this.onConfirm = onConfirm;
    this.previousFocus = document.activeElement;
    const list = document.getElementById("modalDetails");
    if (list) {
      list.replaceChildren();
      details.forEach(([label, value]) => {
        const row = document.createElement("div");
        const term = document.createElement("dt"), description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        row.append(term, description);
        list.append(row);
      });
      list.hidden = details.length === 0;
    }
    const note = document.getElementById("modalNotice");
    if (note) { note.textContent = notice; note.hidden = !notice; }
    this.modal.dataset.variant = details.length ? "review" : "";

    this.modal.classList.add("active");
    this.modal.setAttribute("aria-hidden", "false");

    // Start long reviews at the heading so a small screen shows the first values.
    if (details.length) { this.title.tabIndex = -1; this.title.focus(); }
    else this.confirmBtn.focus();

    return true;
  },

  close() {
    if (!this.modal) return;

    this.modal.classList.remove("active");
    this.modal.setAttribute("aria-hidden", "true");
    this.onConfirm = null;
    if (this.previousFocus?.isConnected && !this.previousFocus.disabled) this.previousFocus.focus();
    this.previousFocus = null;
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.HatchModal.init();
  });
} else {
  window.HatchModal.init();
}
