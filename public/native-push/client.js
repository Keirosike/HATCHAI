import { onlineApiUrl } from '../online-api-settings.js';

const safeError = response => response.status===401 ? 'Sign in again to manage notifications.' :
  response.status===403 ? 'Incubator access denied.' : response.status===409 ? 'This subscription belongs to another account. Disable it from that account first.' :
  response.status===429 ? 'Too many requests. Please wait before retrying.' : 'Registration Failed. Notification service is unavailable.';
const testErrors={
  test_stored_subscription_invalid:'Test failed: stored browser subscription is invalid. Disable and re-enable notifications.',
  test_private_key_format:'Test failed: NATIVE_PUSH_VAPID_PRIVATE_KEY must be a 32-byte unpadded base64url key (43 characters).',
  test_public_key_format:'Test failed: NATIVE_PUSH_VAPID_PUBLIC_KEY must be a 65-byte unpadded base64url key (87 characters).',
  test_subject_format:'Test failed: NATIVE_PUSH_VAPID_SUBJECT must be a valid mailto: address or HTTPS contact URL.',
  test_vapid_pair_invalid:'Test failed: configured VAPID public/private keys do not form a valid signing pair.',
  test_payload_encryption_failed:'Test failed: Web Push payload encryption could not complete with the stored subscription.',
  test_subscription_lookup_failed:'Test failed: backend could not retrieve this enabled subscription.',
  test_configuration_or_encryption_failed:'Test failed: VAPID key configuration or payload encryption is invalid.',
  test_unconfigured:'Test failed: VAPID configuration is missing.',
  test_disabled:'Test failed: controlled testing is disabled.',
  test_unknown:'Test delivery outcome is unknown after a network failure or timeout. Do not repeatedly resend.',
  test_expired:'This push subscription has expired. Disable and re-enable notifications.',
  test_retryable:'Push service is temporarily unavailable or rate-limited. Wait before another test.',
  test_failed:'Push service rejected the test notification.'
};
export function nativePushClient({ token, incubatorId, localWorker=false, browser=globalThis, fetcher=globalThis.fetch.bind(globalThis) }) {
  let busy=false, disposed=false, serverDisabled=false;
  const base=localWorker ? 'http://127.0.0.1:8787' : onlineApiUrl;
  if(localWorker && browser.location.origin!=='http://127.0.0.1:8080')throw new Error('Invalid local test origin');
  const configured=new URL(base);
  if(!localWorker && (configured.protocol!=='https:'||configured.pathname!=='/'||configured.username||configured.password||configured.search||configured.hash))throw new Error('Invalid API configuration');
  async function api(path,body) {
    if(disposed)throw new Error('Signed out.');
    const bearer=token();if(!bearer)throw new Error('Sign in again to manage notifications.');
    const response=await fetcher(base+'/online/push/'+path,{method:body?'POST':'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const failure=result=>{const error=new Error(safeError(response));
      error.safeMessage=(path==='test'?(testErrors[result?.code]||'Test request failed; existing registration was preserved.'):safeError(response))+
        ' (HTTP '+response.status+(path==='test'&&Number.isInteger(result?.providerStatus)&&result.providerStatus>=100&&result.providerStatus<=599?', provider '+result.providerStatus:'')+').';return error;};
    const reader=response.body?.getReader();if(!reader)throw response.ok?new Error('Invalid registration response.'):failure();
    const parts=[];let length=0;
    for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>8192){await reader.cancel();throw new Error('Invalid registration response.');}parts.push(part.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    const text=new TextDecoder().decode(bytes);
    let result;try{result=JSON.parse(text);}catch{throw response.ok?new Error('Invalid registration response.'):failure();}
    if(!response.ok)throw failure(result);
    if(disposed)throw new Error('Signed out.');return result;
  }
  function supported(){return browser.isSecureContext && browser.Notification && browser.PushManager && browser.navigator?.serviceWorker;}
  async function registration(create=false) {
    const scope=new URL('/native-push/',browser.location.origin).href;
    const script=new URL('/native-push/service-worker.js',browser.location.origin).href;
    const all=await browser.navigator.serviceWorker.getRegistrations();
    const existing=all.find(r=>r.scope===scope);
    if(existing && [existing.active,existing.waiting,existing.installing].filter(Boolean).some(w=>w.scriptURL!==script))
      throw new Error('Another service worker uses the notification scope. Review it before enabling notifications.');
    if(!create)return existing;
    // A more specific scope coexists with a root Firebase worker. Never unregister it.
    // Re-registering the exact native script explicitly checks for updates even
    // though the dashboard itself lives outside the /native-push/ scope.
    const result=await browser.navigator.serviceWorker.register(script,{scope:'/native-push/',updateViaCache:'none'});
    // Register can return the existing active registration. Explicitly fetch an
    // update before deciding its handler is current; do not clear subscriptions.
    if(existing) {
      let timer;
      try {await Promise.race([result.update(),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Native notification worker update timed out.')),10000);
      })]);}finally{clearTimeout(timer);}
    }
    if(result.active && !result.installing && !result.waiting)return result;
    await new Promise((resolve,reject)=>{
      const worker=result.installing||result.waiting;if(!worker)return reject(new Error('Service worker installation failed.'));
      const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Service worker installation timed out.'));},10000);
      const changed=()=>{if(worker.state==='activated'||worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);worker.state==='activated'?resolve():reject(new Error('Service worker installation failed.'));}};
      worker.addEventListener('statechange',changed);changed();
    });return result;
  }
  async function hash(value){const bytes=await browser.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
  const preference='hatchai-native-push-disabled:'+incubatorId;
  function disabledFor(endpointHash){try{return browser.localStorage?.getItem(preference)===endpointHash;}catch{return false;}}
  async function store(subscription){const result=await api('subscribe',{incubatorId,subscription:subscription.toJSON(),deviceLabel:'Web browser'});if(result.registered!==true)throw new Error('Registration not confirmed.');
    try{browser.localStorage?.removeItem(preference);}catch{}return 'Notifications Enabled';}
  async function status() {
    serverDisabled=false;
    if(!supported())return 'Browser Unsupported';
    if(browser.Notification.permission==='denied')return 'Permission Denied';
    if(browser.Notification.permission!=='granted')return 'Permission Required';
    const reg=await registration();const sub=await reg?.pushManager.getSubscription();
    if(!sub)return 'Notifications Disabled';
    const result=await api('status?incubatorId='+encodeURIComponent(incubatorId));
    if(!Array.isArray(result.subscriptions))throw new Error('Invalid registration response.');
    if(!result.subscriptions.every(x=>x && /^[0-9a-f]{64}$/.test(x.endpointHash)&&typeof x.enabled==='boolean'))throw new Error('Invalid registration response.');
    const fingerprint=await hash(sub.endpoint),record=result.subscriptions.find(x=>x.endpointHash===fingerprint);
    serverDisabled=record?.enabled===false;
    return record?.enabled===true?'Notifications Enabled':'Notifications Disabled';
  }
  async function exclusive(action){if(busy||disposed)throw new Error('Notification operation unavailable.');busy=true;try{return await action();}finally{busy=false;}}
  async function lastReceipt(reg) {
    // Read our one same-origin metadata record directly. A dashboard outside
    // the native worker's scope must not depend on a cold worker message reply.
    if(browser.caches?.open){
      let timer;
      try {
        const result=await Promise.race([(async()=>{
          const cache=await browser.caches.open('hatchai-native-push-diagnostic-v1');
          const response=await cache.match(new URL('/native-push/__last-test-receipt',browser.location.origin).href);
          if(!response)return {available:true,receipt:null};
          const reader=response.body?.getReader();if(!reader)return null;
          const parts=[];let size=0;
          for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;
            if(size>1024){await reader.cancel();return null;}parts.push(p.value);}
          const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
          return {available:true,receipt:JSON.parse(new TextDecoder().decode(bytes))};
        })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);
        if(result)return result;
      }catch{}finally{clearTimeout(timer);}
    }
    if(typeof reg?.active?.postMessage!=='function')return null;
    const channel=new MessageChannel();
    return new Promise(resolve=>{
      const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
      const timer=setTimeout(()=>finish(null),1200);
      channel.port1.onmessage=event=>finish({available:true,receipt:event.data});
      try {reg.active.postMessage({type:'HATCHAI_NATIVE_PUSH_DIAGNOSTIC'},[channel.port2]);}catch{finish(null);}
    });
  }
  return {
    status, get busy(){return busy;}, dispose(){disposed=true;},
    checkDisplay(){return exclusive(async()=>{
      if(browser.Notification?.permission!=='granted')return 'Allow browser notifications before checking display.';
      const reg=await registration(true);
      try {await reg.showNotification('HATCHAI Device Display Check',{
        body:'This is a local browser display check, not a cloud push.',tag:'hatchai-local-display-check',data:{url:'/online-login.html'}});}
      catch {return 'Device display check failed. Browser or Android notification display is blocked.';}
      const diagnostic=await lastReceipt(reg),last=diagnostic?.receipt;
      const valid=last && Number.isSafeInteger(last.at) && ['received','shown','failed'].includes(last.display);
      return 'Local notification display requested. '+(valid?'Last cloud test: browser '+last.display+' at '+new Date(last.at).toLocaleTimeString()+'.':'No cloud test receipt is recorded on this browser yet.');
    });},
    test(){return exclusive(async()=>{
      if(await status()!=='Notifications Enabled')throw new Error('Enable notifications first.');
      const reg=await registration(true),sub=await reg?.pushManager.getSubscription();
      if(!sub)throw new Error('Enable notifications first.');
      const result=await api('test',{incubatorId,endpointHash:await hash(sub.endpoint)});
      if(result.accepted!==true)throw new Error('Test delivery not confirmed.');
      if(typeof result.testId!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(result.testId))throw new Error('Invalid test response.');
      const deadline=performance.now()+8000;
      while(!disposed && performance.now()<deadline){
        const diagnostic=await lastReceipt(reg);if(!diagnostic) return 'Test accepted by push service. This device receipt check is unavailable; delivery remains unverified.';
        const last=diagnostic.receipt;
        if(last?.testId===result.testId){
          if(last.display==='shown')return 'Cloud test RECEIVED on this device. Notification display was requested.';
          if(last.display==='failed')return 'Cloud test RECEIVED, but notification display FAILED on this device.';
        }
        await new Promise(resolve=>setTimeout(resolve,750));
      }
      return 'Push service ACCEPTED the test, but this device has NO CLOUD RECEIPT yet. Delivery remains unverified.';
    });},
    enable(){return exclusive(async()=>{
      if(!supported())return 'Browser Unsupported';
      if(browser.Notification.permission==='denied')return 'Permission Denied';
      // Permission is invoked synchronously from the explicit button handler.
      if(browser.Notification.permission!=='granted' && await browser.Notification.requestPermission()!=='granted')return browser.Notification.permission==='denied'?'Permission Denied':'Permission Required';
      const {publicKey}=await api('public-key');
      if(typeof publicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(publicKey))throw new Error('Invalid notification configuration.');
      const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const reg=await registration(true);let sub=await reg.pushManager.getSubscription();
      if(sub?.options?.applicationServerKey && Array.from(new Uint8Array(sub.options.applicationServerKey)).join()!==Array.from(bytes).join())throw new Error('Notification key changed. Disable this browser subscription before enabling it again.');
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      return store(sub);
    });},
    reconcile(){return exclusive(async()=>{
      const current=await status();
      if(current!=='Notifications Disabled'||browser.Notification.permission!=='granted'||serverDisabled)return current;
      const reg=await registration();const sub=await reg?.pushManager.getSubscription();return sub && !disabledFor(await hash(sub.endpoint))?store(sub):current;
    });},
    disable(){return exclusive(async()=>{
      if(!supported())return 'Browser Unsupported';
      const reg=await registration(),sub=await reg?.pushManager.getSubscription();
      if(sub){const result=await api('unsubscribe',{incubatorId,endpoint:sub.endpoint});if(result.registered!==false)throw new Error('Removal not confirmed.');
        // Preference only, never authorization. Preserve an explicit disable if
        // browser removal fails; returning must not silently reactivate it.
        try{browser.localStorage?.setItem(preference,await hash(sub.endpoint));}catch{}
        if(!await sub.unsubscribe())throw new Error('Server disabled notifications; browser removal could not be confirmed.');}
      return 'Notifications Disabled';
    });}
  };
}
