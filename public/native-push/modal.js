import { nativePushClient } from './client.js';

export async function mountNotifications({auth,incubatorId,localWorker,host}) {
  if(!document.getElementById('confirmModal')){
    const shell=document.createElement('div');
    shell.innerHTML='<div class="modal-overlay" id="confirmModal" aria-hidden="true"><section class="modal-card notification-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalMessage"><img src="/shared/a/images/hatchai-logo.webp" width="44" height="44" alt="HATCHAI"><h2 id="modalTitle"></h2><p id="modalMessage"></p><p id="pushModalStatus" role="status" aria-live="polite"></p><div class="modal-actions"><button type="button" id="modalConfirmBtn" class="modal-btn modal-btn-primary"></button><button type="button" id="pushDisable" class="modal-btn modal-btn-cancel">Disable Notifications</button></div><button type="button" id="modalCancelBtn" class="notification-close" aria-label="Close">&#215;</button></section></div>';
    document.body.append(shell.firstElementChild);
    await import('../shared/js/modal.js');
  }
  const client=nativePushClient({token:()=>auth.accessToken(),incubatorId,localWorker});
  const button=document.createElement('button');button.type='button';button.className='btn btn-soft';button.textContent='Notifications';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  host.append(button,status);let dead=false,state='Notifications Disabled';
  const userId=auth.userId?.();
  const onboardingKey=userId ? 'hatchai-push-onboarding-v1:'+userId : null;
  const remember=()=>{try{if(onboardingKey)localStorage.setItem(onboardingKey,'completed');}catch{}};
  const completed=()=>{try{return !onboardingKey||localStorage.getItem(onboardingKey)==='completed';}catch{return true;}};
  const disable=document.getElementById('pushDisable'),enable=document.getElementById('modalConfirmBtn');
  const paint=()=>{if(dead)return;status.textContent=state;
    document.getElementById('pushModalStatus').textContent=state+(state==='Permission Denied'?'. Allow notifications in this browser’s site settings, then reopen this dialog.':'');
    if(state==='Notifications Enabled')remember();
    enable.disabled=client.busy||['Permission Denied','Browser Unsupported'].includes(state);disable.disabled=client.busy;};
  async function run(action){try{const pending=action();paint();state=await pending;}catch(error){state=error.safeMessage|| (error.message.startsWith('Sign in')?'Sign in again to manage notifications.':error.message.startsWith('Another service worker')?'Registration Failed. Another service worker uses the notification scope; review it before enabling.':'Notification operation failed. Existing registration was preserved; check connection and retry.');}finally{paint();}}
  const open=()=>{
    window.HatchModal.open({title:'Notifications',message:'Enable notifications to receive HATCHAI alerts on this device.',confirmText:'Enable Notifications',cancelText:'\u00d7',closeOnConfirm:false,confirmClass:'modal-btn-primary',onConfirm:()=>run(()=>client.enable())});
    document.getElementById('modalCancelBtn').setAttribute('aria-label','Close');
    paint();remember();
  };
  button.addEventListener('click',open);
  const onDisable=()=>run(()=>client.disable());disable.addEventListener('click',onDisable);
  // Only the consent actions and normal dismissal participate in keyboard navigation.
  const trap=event=>{if(event.key!=='Tab'||!document.getElementById('confirmModal').classList.contains('active'))return;
    event.preventDefault();event.stopImmediatePropagation();const buttons=[enable,disable,document.getElementById('modalCancelBtn')].filter(x=>!x.disabled);
    const i=buttons.indexOf(document.activeElement);buttons[(i+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();};
  document.addEventListener('keydown',trap,true);
  await run(()=>client.reconcile());
  if(!dead&&!completed())open();
  return ()=>{dead=true;client.dispose();window.HatchModal.close();disable.removeEventListener('click',onDisable);document.removeEventListener('keydown',trap,true);button.remove();status.remove();};
}
