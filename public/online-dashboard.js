import {readCaptures,readCaptureImage} from './camera-api.js';
import './shared/js/app.js';
import './shared/js/cameraView.js';
import './shared/js/dashboardAdapters.js';
import './shared/js/dashboard.js';
import {createTelemetryReader,readCameraEvents} from './telemetry-api.js';
import { readIncubators } from './incubator-read.js';
import { mountNotifications } from './native-push/modal.js';

const pages=new Set(['dashboard','control','camera','batch','settings','log']);
async function fragment(page){
 const response=await fetch('./shared/'+page+'-fragment.html',{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Shared page unavailable.');
 const reader=response.body?.getReader();if(!reader)throw new Error('Shared page unavailable.');
 let length=0;const chunks=[];
 while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>65536){await reader.cancel();throw new Error('Shared page too large.');}chunks.push(part.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const template=document.createElement('template');template.innerHTML=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(template.content.querySelector('script,object,embed')||!template.content.querySelector('main'))throw new Error('Invalid shared page.');
 for(const node of template.content.querySelectorAll('*'))for(const attribute of node.attributes)if(/^on/i.test(attribute.name))throw new Error('Inline handler refused.');
 return template;
}
async function waitForStyles(host){
 await Promise.all([...host.querySelectorAll('link[rel="stylesheet"]')].map(link=>new Promise((resolve,reject)=>{
  if(link.sheet)return resolve();
  const done=error=>{clearTimeout(timer);link.removeEventListener('load',loaded);link.removeEventListener('error',failed);error?reject(new Error('Page styles unavailable.')):resolve();};
  const loaded=()=>done(false),failed=()=>done(true),timer=setTimeout(failed,8000);link.addEventListener('load',loaded,{once:true});link.addEventListener('error',failed,{once:true});
 })));
}
export async function mountOnlineDashboard({auth,incubators,localWorker,onStatus}){
 const host=document.getElementById('onlineDashboard'),login=document.getElementById('onlineLogin');
 const sessionStatus=document.getElementById('status');
 const loginStyle=document.querySelector('link[href="shared/css/login.css"]');
 const notifications=document.createElement('div'),loading=document.getElementById('onlineLoading');
 const controls=['status','logout','refreshIncubator'].map(id=>{const element=document.getElementById(id),marker=document.createComment('session-control');element.before(marker);return {element,marker};});
 let current=null,cameraCleanup=null,navbarCleanup=null,dead=false,busy=false,pending=null,selected=incubators[0].id;
 let notificationCleanup=await mountNotifications({auth,incubatorId:selected,localWorker,host:notifications});
 const readTelemetry=createTelemetryReader(localWorker);
 const adapter=()=>window.HatchDashboardAdapters.online({accessToken:()=>auth.accessToken(),readIncubators:token=>readIncubators(token,undefined,localWorker),initialIncubators:incubators,selectedIncubator:()=>selected,readTelemetry:(token,id)=>readTelemetry(token,id,localWorker)});
 function restoreControls(){for(const {element,marker} of controls)marker.after(element);}
 function text(id,value){const element=host.querySelector('#'+id);if(element)element.textContent=value;}
 async function show(page){
  if(dead||!pages.has(page))return;if(busy){pending=page;return;}busy=true;loading.hidden=false;document.getElementById('loadingMessage').textContent='Loading '+(page==='log'?'logs':page)+'...';
  try{
   const template=await fragment(page);if(dead)return;
   current?.destroy();current=null;cameraCleanup?.();cameraCleanup=null;navbarCleanup?.();restoreControls();
   // One page owns the DOM IDs and page-specific styles, exactly as on ESP32.
   host.hidden=true;host.replaceChildren(template.content.cloneNode(true));await waitForStyles(host);if(dead)return;host.hidden=false;login.hidden=true;if(loginStyle)loginStyle.disabled=true;
   for(const link of host.querySelectorAll('#navLinks a')){
    const name=link.getAttribute('href')?.replace('.html','');if(!pages.has(name)){link.removeAttribute('href');continue;}
    link.href='#'+name;link.classList.toggle('active',name===page);
    link.addEventListener('click',event=>{event.preventDefault();history.pushState(null,'','#'+name);show(name).catch(()=>{sessionStatus.textContent='Page unavailable. Please sign in again.';});});
   }
   navbarCleanup=window.HatchApp.initNavbar();text('wifiStatus','Online account');
   if(page==='dashboard'){
    current=window.HatchDashboard.init({adapter:adapter(),onOnlineStatus:onStatus});await current.ready;
   }else{
    for(const control of host.querySelectorAll('input,select,textarea,button')){
     if(control.closest('nav'))continue;control.disabled=true;
     if(control.matches('input[type=checkbox]')){control.checked=false;control.indeterminate=true;}
     else if('value' in control)control.value='';
    }
    host.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
    if(page==='control'){
     text('controlStatusBadge','Status unavailable');text('lockBadge','Online: read-only');
     text('controlNotice','Hardware controls are available only on your local ESP32 dashboard.');
     for(const id of ['heaterStatus','bulbActualState','heaterDemandValue','settingsStatus'])text(id,'Unavailable');
    }
    if(page==='batch'){
     for(const element of host.querySelectorAll('strong,[id^="currentBatch"],#slotCountBadge,#progressPercent,#daysRemaining'))element.textContent='Unavailable';
     text('currentBatchMeta','Cloud batches are not synchronized. Manage existing batches on the local dashboard.');
     const preview=host.querySelector('#openBatchModal'),modal=host.querySelector('#batchModal'),close=host.querySelector('#closeBatchModal');
     preview.disabled=false;close.disabled=false;text('formStatus','Read-only');text('batchModalDescription','This is the shared batch form. Cloud batch synchronization is unavailable; existing local batches are unchanged.');
     const dismiss=()=>{modal.classList.remove('active');modal.setAttribute('aria-hidden','true');preview.focus();};
     preview.addEventListener('click',()=>{modal.classList.add('active');modal.setAttribute('aria-hidden','false');close.focus();});close.addEventListener('click',dismiss);modal.addEventListener('click',event=>{if(event.target===modal)dismiss();});modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dismiss();}if(event.key==='Tab'){event.preventDefault();close.focus();}});
    }
    if(page==='log'){for(const id of ['totalEvents','warningCount','criticalCount','lastSync'])text(id,'Unavailable');host.querySelector('#miniLogTable').replaceChildren();host.querySelector('#logTimeline').textContent='Cloud logs are not synchronized.';host.querySelector('main .badge').textContent='Unavailable';for(const note of host.querySelectorAll('.overview-grid .subtext'))note.textContent='Cloud records unavailable';}
    if(page==='camera')cameraCleanup=window.HatchCameraView.mount(host,{mode:'online',preview:'captures',getCapture:record=>readCaptureImage(auth.accessToken(),selected,record.id,localWorker),getStatus:async()=>{const token=auth.accessToken();const [data,events,images]=await Promise.all([readTelemetry(token,selected,localWorker),readCameraEvents(token,selected,localWorker),readCaptures(token,selected,localWorker)]);const captures=images.length?images:events;const sample=data?.online?data.latest?.sample:null;return {cameras:sample?['upper','lower'].map(position=>({position,online:sample[position+'CameraOnline'],chick:sample[position+'Chick'],detectorOk:null})):[],captures};}});
    if(page==='settings'){
     text('accountDisplayName','Supabase account');text('espConnectedSsid','Unavailable online');text('wifiCardStatus','Hardware settings remain on the local ESP32 dashboard.');text('espWifiBadge','Unavailable');text('saveStatus','Online mode does not change local hardware settings.');text('wifiNetworkList','Wi-Fi scanning is available on the local dashboard.');
     host.querySelector('#notificationSettingsHost').append(notifications);
     const logoutButton=host.querySelector('#logoutBtn');logoutButton.disabled=false;logoutButton.addEventListener('click',()=>document.getElementById('logout').click());
     const account=host.querySelector('.account-box').parentElement;
     const selector=document.createElement('select');selector.className='input-box';selector.setAttribute('aria-label','Incubator');
     for(const row of incubators){const option=document.createElement('option');option.value=row.id;option.textContent=row.device_name;selector.append(option);}selector.value=selected;
     selector.addEventListener('change',async()=>{selector.disabled=true;try{if(!incubators.some(row=>row.id===selector.value))return;selected=selector.value;notificationCleanup();notificationCleanup=await mountNotifications({auth,incubatorId:selected,localWorker,host:notifications});if(dead)notificationCleanup();}catch{sessionStatus.textContent='Notification settings unavailable. Sign in again.';}finally{selector.disabled=false;}});
     const label=document.createElement('label');label.textContent='Incubator';label.append(selector);account.append(label);
     sessionStatus.className='small-note';account.append(sessionStatus);
    }
   }
   window.scrollTo(0,0);
  }catch(error){if(!dead){host.replaceChildren();const note=document.createElement('p');note.className='page';note.textContent='This page could not be loaded. Reload HATCHAI to retry.';host.append(note);host.hidden=false;}throw error;}finally{loading.hidden=true;busy=false;if(pending&&!dead){const next=pending;pending=null;queueMicrotask(()=>show(next).catch(()=>{sessionStatus.textContent='Page unavailable. Sign in again.';}));}}
 }
 const route=()=>{const page=location.hash.slice(1);show(pages.has(page)?page:'dashboard').catch(()=>{sessionStatus.textContent='Page unavailable. Sign in again.';});};
 window.addEventListener('popstate',route);
 try{await show(pages.has(location.hash.slice(1))?location.hash.slice(1):'dashboard');}catch(error){dead=true;window.removeEventListener('popstate',route);notificationCleanup();cameraCleanup?.();current?.destroy();navbarCleanup?.();restoreControls();host.replaceChildren();host.hidden=true;login.hidden=false;if(loginStyle)loginStyle.disabled=false;throw error;}
 return {refresh:()=>current?current.refresh():readIncubators(auth.accessToken(),undefined,localWorker),destroy(){dead=true;window.removeEventListener('popstate',route);notificationCleanup();cameraCleanup?.();current?.destroy();navbarCleanup?.();restoreControls();for(const {element,marker} of controls)marker.replaceWith(element);host.replaceChildren();host.hidden=true;login.hidden=false;if(loginStyle)loginStyle.disabled=false;}};
}
