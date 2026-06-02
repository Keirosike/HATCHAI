document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const statusMessage = document.getElementById("status");

  const DEFAULT_USERNAME = "admin";
  const DEFAULT_PASSWORD = "1234";

  if (!loginForm || !usernameInput || !passwordInput || !statusMessage) {
    return;
  }

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = "status " + type;
  }

  function clearStatus() {
    statusMessage.textContent = "";
    statusMessage.className = "status";
  }

  function validateLogin(username, password) {
    const savedAccount = window.HatchStorage?.get("hatchaiAccount", null);
    const savedPassword = window.HatchStorage?.get("hatchaiPassword", null);
    const validUsername = savedAccount?.username || DEFAULT_USERNAME;
    const validPassword = savedPassword || DEFAULT_PASSWORD;

    return username === validUsername && password === validPassword;
  }

  function saveLocalCredentials(username, password) {
    window.HatchStorage?.set("hatchaiAccount", {
      fullName: "Admin User",
      username
    });
    window.HatchStorage?.set("hatchaiPassword", password);
  }

  async function startLocalSession(username, password) {
    if (!validateLogin(username, password)) {
      showStatus("Invalid username or password.", "error");
      return false;
    }

    await window.HatchAuthSession.saveAccount(username, password);

    const session = await window.HatchAuthSession.start(username, password);

    if (session.ok) {
      saveLocalCredentials(username, password);
      return true;
    }

    if (!session.available) {
      const localSession = window.HatchAuthSession.startLocal(username);

      if (localSession.ok) {
        saveLocalCredentials(username, password);
        return true;
      }
    }

    showStatus(session.message || "Cannot start login session.", "error");
    return false;
  }

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    clearStatus();

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showStatus("Please fill all fields.", "error");
      return;
    }

    const session = await window.HatchAuthSession.start(username, password);

    if (!session.ok) {
      const canUseLocalFallback = !session.available || session.status === 401;
      const fallbackStarted = canUseLocalFallback
        ? await startLocalSession(username, password)
        : false;

      if (!fallbackStarted) {
        if (!canUseLocalFallback) {
          showStatus(session.message, "error");
        }

        return;
      }
    } else {
      saveLocalCredentials(username, password);
    }

    showStatus("Login successful. Redirecting...", "success");

    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 800);
  });
});
