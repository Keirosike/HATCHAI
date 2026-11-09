document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
});

window.HatchApp = {
  initNavbar,
  get(id) {
    return document.getElementById(id);
  },

  getValue(id, fallback = "") {
    const element = this.get(id);
    return element ? element.value : fallback;
  },

  setValue(id, value) {
    const element = this.get(id);

    if (element) {
      element.value = value;
    }
  },

  setText(id, value) {
    const element = this.get(id);

    if (element) {
      element.textContent = value;
    }
  },

  setStatus(message, color) {
    const status = this.get("saveStatus") || this.get("status");

    if (!status) return;

    status.textContent = message;

    if (color) {
      status.style.color = color;
    }
  }
};

function initNavbar() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (!hamburger || !navLinks) return;
  const listeners = [];
  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  on(hamburger, "click", () => {
    hamburger.classList.toggle("active");
    navLinks.classList.toggle("active");

    const isOpen = navLinks.classList.contains("active");
    hamburger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.querySelectorAll("#navLinks a").forEach(link => {
    on(link, "click", () => {
      hamburger.classList.remove("active");
      navLinks.classList.remove("active");
      hamburger.setAttribute("aria-expanded", "false");
    });
  });

  on(window, "resize", () => {
    if (window.innerWidth > 700) {
      hamburger.classList.remove("active");
      navLinks.classList.remove("active");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });
  return () => listeners.forEach(remove => remove());
}
