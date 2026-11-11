import { HatchaiOnlineAuth } from './supabase-auth.js';
import { readIncubators } from './incubator-read.js';
const auth = new HatchaiOnlineAuth();
const form = document.getElementById('login'), password = document.getElementById('password');
const submit = document.getElementById('submit'), status = document.getElementById('status'), logout = document.getElementById('logout');
const visibility = document.getElementById('visibility');
let busy = false;
let dashboard = null;
const loading=document.getElementById('onlineLoading');
function setLoading(active){if(active)document.getElementById('loadingMessage').textContent='Loading...';loading.hidden=!active;document.getElementById('onlineLogin').hidden=active||Boolean(dashboard);}
const refresh = document.getElementById('refreshIncubator');
// Explicit loopback-only test mode; all other pages use configured HTTPS API.
const localWorker = location.origin === 'http://127.0.0.1:8080' && new URLSearchParams(location.search).get('worker-test') === '1';
visibility.addEventListener('click', () => {
  const show = password.type === 'password';password.type = show ? 'text' : 'password';
  visibility.setAttribute('aria-label', show ? 'Hide password' : 'Show password');visibility.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
  event.preventDefault();if (busy) return;
  if (!window.isSecureContext) { status.textContent = 'Open this page over HTTPS or localhost to sign in.';return; }
  busy = true;submit.disabled = true;form.setAttribute('aria-busy','true');status.className='status';status.textContent='';
  const secret = password.value;password.value = '';password.type = 'password';visibility.setAttribute('aria-label', 'Show password');visibility.setAttribute('aria-pressed', 'false');
  try {
    await auth.signIn(document.getElementById('email').value, secret);
    setLoading(true);
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
  } catch (error) { status.className='status error';status.textContent=error.message.startsWith('Sign-in was not accepted.')?'Invalid email or password.':error.message;password.focus(); }
  finally { busy = false;submit.disabled = false;form.removeAttribute('aria-busy');setLoading(false); }
});
async function performSignOut() {
  if (busy) return;busy = true;logout.disabled = true;
  dashboard?.destroy();dashboard = null;refresh.hidden = true;setLoading(true);document.getElementById('loadingMessage').textContent='Signing out...';
  try { await auth.signOut();status.textContent = 'Signed out.'; }
  catch { status.textContent = 'This page’s session was cleared. Server sign-out could not be confirmed.'; }
  finally { form.hidden = false;logout.hidden = true;logout.disabled = false;busy = false;setLoading(false);document.getElementById('email').focus(); }
}
const logoutDialog=document.getElementById('logoutDialog');
logout.addEventListener('click',()=>{if(busy||logoutDialog.open)return;logoutDialog.showModal();document.getElementById('logoutCancel').focus();});
for(const id of ['logoutCancel','logoutClose'])document.getElementById(id).addEventListener('click',()=>logoutDialog.close());
logoutDialog.addEventListener('click',event=>{if(event.target===logoutDialog){const r=logoutDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)logoutDialog.close();}});
document.getElementById('logoutConfirm').addEventListener('click',()=>{logoutDialog.close();performSignOut();});
refresh.addEventListener('click', async () => {
  if (busy || !dashboard) return;
  busy = true;refresh.disabled = true;setLoading(true);document.getElementById('loadingMessage').textContent='Refreshing incubator...';
  status.textContent = 'Refreshing authorized incubator information…';
  try { await dashboard.refresh(); }
  finally { refresh.disabled = false;busy = false;setLoading(false); }
});
