// Local HTTP is not cloud authorization. Only the physical LCD reveals the code.
document.addEventListener('DOMContentLoaded', async () => {
  const token = (() => { try { return JSON.parse(localStorage.getItem('hatchaiActiveSession') || 'null')?.token; } catch { return null; } })();
  if (!token) return;
  let busy = false, timer = null;
  async function request(operation) {
    const controller = new AbortController();const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch('/api/notifications/' + operation, { method: 'POST', headers: { 'X-HatchAI-Session': token }, cache: 'no-store', signal: controller.signal });
      const result = await response.json();if (!response.ok) throw new Error(result.message || 'Pairing request failed.');return result;
    } finally { clearTimeout(timeout); }
  }
  let initial;try { initial = await request('status'); } catch { return; } // Server-verified session required.
  const dialog = document.createElement('dialog');dialog.setAttribute('aria-labelledby', 'notificationTitle');
  dialog.style.cssText = 'max-width:420px;width:calc(100% - 48px);padding:24px;border:1px solid #cbd5e1;border-radius:12px;font:inherit';
  dialog.innerHTML = '<h2 id="notificationTitle">HATCHAI notifications</h2><p>Pair this phone using the code on the physical LCD. Safety warnings take priority over the code. Internet is required on both the controller and phone.</p><p id="notificationState" role="status" aria-live="polite"></p><button type="button" id="notificationEnable" style="min-height:44px;margin:8px">Enable Notifications</button><button type="button" id="notificationCancel" style="min-height:44px;margin:8px">Cancel Pairing</button><button type="button" id="notificationLater" style="min-height:44px;margin:8px">Not Now</button>';
  document.body.appendChild(dialog);
  const text = dialog.querySelector('#notificationState'), enable = dialog.querySelector('#notificationEnable');
  function show(value) {
    text.textContent = !value.credentialsReady ? 'Controller notification credentials are not provisioned.' : !value.utcReady ? 'Waiting for verified UTC synchronization.' : !value.networkReady ? 'Connect the controller to an internet router.' : 'Pairing status: ' + value.state;
  }
  show(initial);
  enable.addEventListener('click', async () => {
    if (busy) return;busy = true;enable.disabled = true;
    const page = window.open('about:blank', '_blank');if (page) page.opener = null;
    try {
      await request('start');if (page) page.location = 'https://hatchai-8d34c.web.app/';
      text.textContent = 'Pairing requested. Read the physical LCD code and enter it on the secure notification page.';
      if (!page) text.textContent += ' Allow popups, then open https://hatchai-8d34c.web.app/ manually.';
      clearInterval(timer);timer = setInterval(async () => { try { show(await request('status')); } catch { clearInterval(timer); } }, 5000);
    } catch (error) { if (page) page.close();text.textContent = error.message; }
    finally { busy = false;enable.disabled = false; }
  });
  dialog.querySelector('#notificationCancel').addEventListener('click', async () => { try { show(await request('cancel')); } catch (error) { text.textContent = error.message; } });
  dialog.querySelector('#notificationLater').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { clearInterval(timer);sessionStorage.setItem('hatchaiNotificationModal', 'seen'); });
  if (!sessionStorage.getItem('hatchaiNotificationModal')) dialog.showModal();
  const reopen = document.createElement('button');reopen.type = 'button';reopen.textContent = 'Notification pairing';reopen.style.minHeight = '44px';
  reopen.addEventListener('click', () => dialog.showModal());document.querySelector('main')?.appendChild(reopen);
});
