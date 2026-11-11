// Local HTTP cannot authorize cloud subscription changes; never requests permission.
document.addEventListener('DOMContentLoaded',()=>{
 const host=document.getElementById('notificationSettingsHost');if(!host)return;
 const button=document.createElement('button');button.type='button';button.className='btn btn-soft';button.textContent='Notifications';host.append(button);
 const shell=document.createElement('div');
 shell.innerHTML='<div id="offlineNotifications" class="modal-overlay" aria-hidden="true"><section class="modal-card notification-modal" role="dialog" aria-modal="true" aria-labelledby="offlineNotificationsTitle" aria-describedby="offlineNotificationsDescription"><button type="button" class="notification-close" aria-label="Close">&#215;</button><h2 id="offlineNotificationsTitle">Notifications</h2><p id="offlineNotificationsDescription">Enable notifications to receive HATCHAI alerts on this device.</p><p role="status" aria-live="polite">Native Web Push requires https://myhatchai.web.app. Sign in there to manage this device. Local incubation continues independently.</p><div class="modal-actions"><button type="button" class="modal-btn modal-btn-primary">Enable Notifications</button><button type="button" class="modal-btn modal-btn-cancel">Disable Notifications</button></div></section></div>';
 const modal=shell.firstElementChild;document.body.append(modal);const actions=[...modal.querySelectorAll('button')];
 const close=()=>{modal.classList.remove('active');modal.setAttribute('aria-hidden','true');button.focus();};
 button.addEventListener('click',()=>{modal.classList.add('active');modal.setAttribute('aria-hidden','false');actions[1].focus();});actions[0].addEventListener('click',close);
 for(const action of actions.slice(1))action.addEventListener('click',()=>{modal.querySelector('[role="status"]').textContent='Open https://myhatchai.web.app and sign in to enable or disable cloud notifications. No cloud settings were changed here.';});
 modal.addEventListener('click',event=>{if(event.target===modal)close();});
 modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){event.preventDefault();const i=actions.indexOf(document.activeElement);actions[(i+(event.shiftKey?-1:1)+actions.length)%actions.length].focus();}});
});
