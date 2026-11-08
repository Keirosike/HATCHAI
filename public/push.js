import { getHatchaiMessaging } from './firebase-config.js';
import { vapidKey } from './push-settings.js';
import { getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging.js';
import { PairingClient } from './pairing-client.js';
const client = new PairingClient();
const status = document.getElementById('status'), enable = document.getElementById('enable'), disable = document.getElementById('disable'), redeem = document.getElementById('redeem'), code = document.getElementById('pairingCode');
let authorized = false, busy = false, authorizationDeadline = 0;
function message(value) { status.textContent = value; }
function buttons() { enable.disabled = busy || !authorized; disable.disabled = busy || !authorized; redeem.disabled = busy || authorized; }
async function action(work) {
  if (busy) return;busy = true;buttons();
  try { await work(); }
  catch (error) { message(error.name === 'AbortError' ? 'Request timed out. Registration has not been confirmed; retry to reconcile.' : error.message || 'Notification operation failed.'); }
  finally { busy = false;buttons(); }
}
function supported() {
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || !vapidKey) throw new Error('Use Android Chrome with HTTPS and internet access.');
}
redeem.addEventListener('click', () => action(async () => {
  supported();await client.redeem(code.value);code.value = '';authorized = true;authorizationDeadline = Date.now() + 295000;
  message('LCD code verified. Tap Enable Notifications to allow notifications and register this phone.');
}));
enable.addEventListener('click', () => {
  if (!authorized || busy) return;
  if (Date.now() >= authorizationDeadline) { authorized = false;buttons();message('Authorization expired. Enter a fresh LCD pairing code.');return; }
  const permission = Notification.requestPermission();
  action(async () => {
    supported();if (await permission !== 'granted') { message('Notifications were not allowed. No token was registered.');return; }
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;const messaging = await getHatchaiMessaging();
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) throw new Error('Firebase did not return a token.');
    let confirmed;
    try { confirmed = await client.register(token); }
    catch (firstError) {
      try { await client.reconcile();confirmed = await client.register(token); }
      catch { throw firstError; }
    }
    authorizationDeadline = confirmed.authorizedUntil * 1000;
    localStorage.removeItem('hatchaiPushToken');localStorage.removeItem('hatchaiPushDisabled');
    message('This phone is securely registered. Cloudflare confirmed token storage. Chick-detection delivery remains disabled pending its separate review.');
  });
});
disable.addEventListener('click', () => action(async () => {
  await client.unregister();authorized = false;localStorage.setItem('hatchaiPushDisabled', 'true');
  try { await deleteToken(await getHatchaiMessaging());message('Cloud registration disabled and local Firebase token deleted.'); }
  catch { message('Cloud registration disabled. Local Firebase token cleanup failed; the server registration remains revoked.'); }
}));
buttons();
action(async () => {
  supported();localStorage.removeItem('hatchaiPushToken');
  try { const auth = await client.reconcile();authorized = true;authorizationDeadline = auth.authorizedUntil * 1000;message('Browser ownership verified. Tap Enable Notifications to confirm or refresh this phone token.'); }
  catch { message('Enter the physical LCD code to pair this phone. Keep your phone online; the ESP32 access point alone does not provide internet.'); }
  const messaging = await getHatchaiMessaging();
  if (messaging) onMessage(messaging, () => message('A HATCHAI notification was received.'));
});
