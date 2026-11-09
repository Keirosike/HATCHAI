import { HatchaiOnlineAuth } from './supabase-auth.js';
import { readIncubators } from './incubator-read.js';
const auth = new HatchaiOnlineAuth();
const form = document.getElementById('login'), password = document.getElementById('password');
const submit = document.getElementById('submit'), status = document.getElementById('status'), logout = document.getElementById('logout');
const visibility = document.getElementById('visibility');
let busy = false;
let dashboard = null;
const refresh = document.getElementById('refreshIncubator');
// Explicit loopback-only test mode; all other pages use configured HTTPS API.
const localWorker = location.origin === 'http://127.0.0.1:8080' && new URLSearchParams(location.search).get('worker-test') === '1';
visibility.addEventListener('click', () => {
  const show = password.type === 'password';password.type = show ? 'text' : 'password';
  visibility.textContent = show ? 'Hide password' : 'Show password';visibility.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
  event.preventDefault();if (busy) return;
  if (!window.isSecureContext) { status.textContent = 'Open this page over HTTPS or localhost to sign in.';return; }
  busy = true;submit.disabled = true;status.textContent = 'Verifying online sign-in…';
  const secret = password.value;password.value = '';password.type = 'password';visibility.textContent = 'Show password';visibility.setAttribute('aria-pressed', 'false');
  try {
    await auth.signIn(document.getElementById('email').value, secret);
    form.hidden = true;logout.hidden = false;
    status.textContent = 'Supabase verified your sign-in. Loading your incubator…';
    try {
      const rows = await readIncubators(auth.accessToken(), undefined, localWorker);
      status.textContent = rows.length ? rows.map(row => `${row.device_name} (${row.device_id})`).join('\n') + (localWorker ? '\nVerified through local Worker. ' : '\nVerified through deployed Worker. ') + 'Monitoring not connected yet.' :
        'Signed in, but no incubator is available to this account. Check its ownership and access policy.';
      if (rows.length) {
        try {
          const { mountOnlineDashboard } = await import('./online-dashboard.js');
          dashboard = await mountOnlineDashboard({ auth, incubators: rows, localWorker, onStatus: verified => {
            status.textContent = verified ? (localWorker ? 'Verified through local Worker.' : 'Verified through deployed Worker.') + ' Monitoring not connected yet.' :
              'Incubator access is not verified. See dashboard status below; sign in again if your session expired.';
          } });
          refresh.hidden = false;
        } catch { status.textContent += '\nThe dashboard could not be loaded. Reload this page and sign in again.'; }
      }
    } catch (error) { status.textContent = error.message; }
  } catch (error) { status.textContent = error.message;password.focus(); }
  finally { busy = false;submit.disabled = false; }
});
logout.addEventListener('click', async () => {
  if (busy) return;busy = true;logout.disabled = true;
  dashboard?.destroy();dashboard = null;refresh.hidden = true;
  try { await auth.signOut();status.textContent = 'Signed out.'; }
  catch { status.textContent = 'This page’s session was cleared. Server sign-out could not be confirmed.'; }
  finally { form.hidden = false;logout.hidden = true;logout.disabled = false;busy = false;document.getElementById('email').focus(); }
});
refresh.addEventListener('click', async () => {
  if (busy || !dashboard) return;
  busy = true;refresh.disabled = true;
  status.textContent = 'Refreshing authorized incubator information…';
  try { await dashboard.refresh(); }
  finally { refresh.disabled = false;busy = false; }
});
