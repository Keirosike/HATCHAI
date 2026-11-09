import './shared/js/app.js';
import './shared/js/dashboardAdapters.js';
import './shared/js/dashboard.js';
import { readIncubators } from './incubator-read.js';

// This module never loads espApi, authSession, batchStore or notificationPairing.
export async function mountOnlineDashboard({ auth, incubators, localWorker, onStatus }) {
  const response = await fetch('./shared/dashboard-fragment.html', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Shared dashboard assets are unavailable. Run the local packaging command.');
  const length = Number(response.headers.get('Content-Length'));
  if (length > 32768) throw new Error('Shared dashboard assets are invalid.');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Shared dashboard assets are unavailable.');
  let size = 0; const chunks = [];
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 32768) { await reader.cancel(); throw new Error('Shared dashboard assets are invalid.'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const template = document.createElement('template');
  template.innerHTML = new TextDecoder().decode(bytes); // Generated same-origin static markup, never API data.
  if (template.content.querySelector('script, iframe, form') || !template.content.querySelector('#environmentChart')) throw new Error('Shared dashboard assets are invalid.');
  const host = document.getElementById('onlineDashboard');
  host.replaceChildren(template.content.cloneNode(true));
  for (const link of host.querySelectorAll('#navLinks a')) {
    if (link.getAttribute('href') === 'dashboard.html') link.href = '#onlineDashboard';
    else { link.closest('li').hidden = true; link.removeAttribute('href'); }
  }
  host.querySelector('.title p').textContent = 'Online monitoring · controls remain on the local dashboard';
  const info = document.createElement('section'); info.className = 'card safety-note';
  for (const id of ['onlineIncubatorInfo', 'onlineVerification']) {
    const line = document.createElement('p'); line.id = id; info.append(line);
  }
  host.querySelector('main').prepend(info);
  // Reuse the actual session controls rather than duplicating a login/dashboard.
  const restore = [];
  for (const id of ['status', 'logout', 'refreshIncubator']) {
    const element = document.getElementById(id);
    const marker = document.createComment('session-control');
    element.before(marker);
    info.append(element);
    if (element.tagName === 'BUTTON') element.classList.add('btn', 'btn-soft');
    restore.push(() => { marker.replaceWith(element); element.classList.remove('btn', 'btn-soft'); });
  }
  const loginPanel = document.getElementById('onlineLogin');
  loginPanel.hidden = true;
  const adapter = window.HatchDashboardAdapters.online({ accessToken: () => auth.accessToken(),
    readIncubators: token => readIncubators(token, undefined, localWorker), initialIncubators: incubators });
  host.hidden = false;
  const navbarCleanup = window.HatchApp.initNavbar();
  const instance = window.HatchDashboard.init({ adapter, onOnlineStatus: onStatus });
  await instance.ready;
  return { refresh: instance.refresh, destroy() {
    instance.destroy(); navbarCleanup?.(); restore.forEach(move => move());
    host.replaceChildren(); host.hidden = true; loginPanel.hidden = false;
  } };
}
