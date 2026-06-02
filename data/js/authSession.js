const HatchAuthSession = (() => {
  const SESSION_KEY = "hatchaiActiveSession";
  const CLIENT_KEY = "hatchaiClientId";
  const LOCAL_TIMEOUT_MS = 90000;
  const HEARTBEAT_MS = 30000;
  const LOGIN_PAGE = "index.html";

  let heartbeatTimer = null;

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return String(Date.now() + Math.random());
  }

  function getClientId() {
    let clientId = sessionStorage.getItem(CLIENT_KEY);

    if (!clientId) {
      clientId = createId();
      sessionStorage.setItem(CLIENT_KEY, clientId);
    }

    return clientId;
  }

  function getSession() {
    return window.HatchStorage?.get(SESSION_KEY, null);
  }

  function saveSession(username) {
    const session = {
      token: getClientId(),
      username,
      expiresAt: Date.now() + LOCAL_TIMEOUT_MS
    };

    window.HatchStorage?.set(SESSION_KEY, session);
    return session;
  }

  function clearSession() {
    const session = getSession();

    if (!session || session.token === getClientId()) {
      window.HatchStorage?.remove(SESSION_KEY);
    }
  }

  function isOwnSessionActive() {
    const session = getSession();
    return Boolean(
      session &&
      session.token === getClientId() &&
      Number(session.expiresAt) > Date.now()
    );
  }

  function isLockedByAnotherClient() {
    const session = getSession();
    return Boolean(
      session &&
      session.token !== getClientId() &&
      Number(session.expiresAt) > Date.now()
    );
  }

  async function postSession(path, body) {
    try {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams(body).toString()
      });

      const payload = await response.json();
      return { available: true, ok: response.ok, status: response.status, payload };
    } catch (error) {
      return { available: false, ok: false, payload: null };
    }
  }

  async function start(username, password = "") {
    if (isLockedByAnotherClient()) {
      return {
        ok: false,
        available: false,
        message: "Another session is already logged in. Logout first or wait for it to expire."
      };
    }

    const token = getClientId();
    const result = await postSession("/api/session/start", { token, username, password });

    if (result.available && !result.ok) {
      return {
        ok: false,
        available: true,
        status: result.status,
        message: result.payload?.message || "Another user is already logged in."
      };
    }

    if (!result.available) {
      return {
        ok: false,
        available: false,
        message: "ESP32 session API is not available."
      };
    }

    saveSession(username);
    startHeartbeat();

    return { ok: true, available: true };
  }

  function startLocal(username) {
    if (isLockedByAnotherClient()) {
      return {
        ok: false,
        message: "Another session is already logged in. Logout first or wait for it to expire."
      };
    }

    saveSession(username);
    startHeartbeat();
    return { ok: true };
  }

  async function saveAccount(username, password = "") {
    const body = { username };

    if (password) {
      body.password = password;
    }

    return postSession("/api/account", body);
  }

  async function keepAlive() {
    if (!isOwnSessionActive()) {
      return false;
    }

    const session = saveSession(getSession().username || "user");
    const result = await postSession("/api/session/keepalive", {
      token: session.token
    });

    if (result.available && !result.ok) {
      clearSession();
      return false;
    }

    return true;
  }

  async function logout() {
    const session = getSession();

    if (session && session.token === getClientId()) {
      await postSession("/api/session/end", { token: session.token });
    }

    clearSession();
    window.location.href = LOGIN_PAGE;
  }

  function startHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    heartbeatTimer = setInterval(async () => {
      const active = await keepAlive();

      if (!active && !isLoginPage()) {
        window.location.href = LOGIN_PAGE;
      }
    }, HEARTBEAT_MS);
  }

  function isLoginPage() {
    const page = window.location.pathname.split("/").pop() || LOGIN_PAGE;
    return page === LOGIN_PAGE || page === "";
  }

  function requireLogin() {
    if (isLoginPage()) {
      if (isOwnSessionActive()) {
        window.location.href = "dashboard.html";
      }

      return;
    }

    if (!isOwnSessionActive()) {
      window.location.href = LOGIN_PAGE;
      return;
    }

    startHeartbeat();
    keepAlive();
  }

  document.addEventListener("DOMContentLoaded", requireLogin);

  return {
    start,
    startLocal,
    saveAccount,
    logout,
    requireLogin,
    isOwnSessionActive
  };
})();

window.HatchAuthSession = HatchAuthSession;
