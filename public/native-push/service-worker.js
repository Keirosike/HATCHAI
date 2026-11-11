// Native Web Push only. Register explicitly with scope /native-push/ after
// reviewing existing registrations. Never replaces the Firebase worker at /.
// No Firebase SDK, caching, fetch interception, auto-registration or live sender.
// Native scope only; no cached app shell or Firebase registration is replaced.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
async function receipt(display,testId,code='') {
  // One overwritten local metadata record; never a subscription or payload log.
  try {const cache=await caches.open('hatchai-native-push-diagnostic-v1');
    await cache.put(new URL('/native-push/__last-test-receipt',self.location.origin).href,
      new Response(JSON.stringify({at:Date.now(),display,code,testId}),{headers:{'Content-Type':'application/json'}}));
  }catch{} // Diagnostic storage failure must not prevent notification display.
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='HATCHAI_NATIVE_PUSH_DIAGNOSTIC' || !event.ports?.[0])return;
  try {if(new URL(event.source.url).origin!==self.location.origin)return;}catch{return;}
  event.waitUntil((async()=>{let result=null;try{const cache=await caches.open('hatchai-native-push-diagnostic-v1');
    const response=await cache.match(new URL('/native-push/__last-test-receipt',self.location.origin).href);
    if(response)result=await response.json();}catch{}
    event.ports[0].postMessage(result);
  })());
});
self.addEventListener('push', event => {
  let message;
  try {
    if (!event.data || event.data.text().length > 2048) return;
    message = event.data.json();
  } catch { return; }
  if (!message || !['hatchai-chick-detected','hatchai-native-test','hatchai-telemetry-alert'].includes(message.type) ||
      (message.type==='hatchai-chick-detected' && !['upper', 'lower'].includes(message.position)) ||
      typeof message.eventId !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(message.eventId)) return;
  const alerts={temperature_high:'High incubation temperature',temperature_critical:'Critical incubation temperature',temperature_low:'Low incubation temperature',humidity_high:'High incubation humidity',humidity_low:'Low incubation humidity',sensor_failure:'Sensor reading failed',sensor_stale:'Sensor readings are stale',controller_offline:'Controller disconnected'};
  const alert=message.type==='hatchai-telemetry-alert';
  if(alert&&(!Object.hasOwn(alerts,message.kind)||!['active','resolved'].includes(message.status)))return;
  const batch = typeof message.batchName === 'string' && message.batchName.length <= 80 &&
    !/[\x00-\x1f\x7f<>]/.test(message.batchName) ? message.batchName.trim() : '';
  const testing=message.type==='hatchai-native-test';
  const body = alert?alerts[message.kind]+(message.status==='resolved'?' — recovered.':'. Check your incubator.'):testing ? 'Your HATCHAI notification system is working.' : `A hatched chick was detected in the ${message.position} incubation batch.` + (batch ? ` Batch: ${batch}` : '');
  event.waitUntil((async()=>{
    if(testing)await receipt('received',message.eventId);
    try {await self.registration.showNotification(alert?'HATCHAI Incubator Alert':testing?'HATCHAI Test Notification':'HATCHAI — Hatched Chick Detected!', {
    body, tag: 'hatchai-' + (alert?message.kind:testing?'test':message.position) + '-' + message.eventId,
    renotify: false, data: { url: '/online-login.html' }
    });if(testing)await receipt('shown',message.eventId);}
    catch(error){if(testing)await receipt('failed',message.eventId,['NotAllowedError','TypeError','InvalidStateError'].includes(error?.name)?error.name:'DisplayError');}
  })());
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
