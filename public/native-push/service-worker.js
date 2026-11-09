// Native Web Push only. Register explicitly with scope /native-push/ after
// reviewing existing registrations. Never replaces the Firebase worker at /.
// No Firebase SDK, caching, fetch interception, auto-registration or live sender.
self.addEventListener('push', event => {
  let message;
  try {
    if (!event.data || event.data.text().length > 2048) return;
    message = event.data.json();
  } catch { return; }
  if (!message || message.type !== 'hatchai-chick-detected' ||
      !['upper', 'lower'].includes(message.position) ||
      typeof message.eventId !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(message.eventId)) return;
  const batch = typeof message.batchName === 'string' && message.batchName.length <= 80 &&
    !/[\x00-\x1f\x7f<>]/.test(message.batchName) ? message.batchName.trim() : '';
  const body = `A hatched chick was detected in the ${message.position} incubation batch.` + (batch ? ` Batch: ${batch}` : '');
  event.waitUntil(self.registration.showNotification('HATCHAI — Hatched Chick Detected!', {
    body, tag: 'hatchai-' + message.position + '-' + message.eventId,
    renotify: false, data: { url: '/online-login.html' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Do not trust a URL supplied by a push payload or notification data.
  const target = new URL('/online-login.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url === target && typeof client.focus === 'function');
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
