document.addEventListener('DOMContentLoaded',()=>{
  const status=document.getElementById('cameraStatus'), button=document.getElementById('showCamera');
  const frame=document.getElementById('cameraFrame'), link=document.getElementById('openCamera');
  let url='', busy=false;
  function hide(){ frame.hidden=true; frame.removeAttribute('src'); button.textContent='Show camera'; }
  button.addEventListener('click',()=>{if(!url)return;if(!frame.hidden){hide();return;}frame.src=url;frame.hidden=false;button.textContent='Hide camera';});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
  async function poll(){
    if(busy||document.hidden)return;busy=true;
    try{
      const data=await HatchEspApi.request('/api/camera',{timeoutMs:6000});
      const next=data.online && /^http:\/\/\d{1,3}(?:\.\d{1,3}){3}$/.test(data.url)?data.url:'';
      if(next!==url){hide();url=next;}
      button.disabled=!url;link.hidden=!url;if(url)link.href=url;
      status.textContent=!data.online?'Camera offline — check Wi-Fi and matching camera keys.':!data.detectorOk?'Camera connected; detector is qualifying or unavailable.':data.chick?'Chick detected by camera.':'Camera connected — no chick detected in the latest result.';      document.getElementById('buzzerStatus').textContent=data.buzzerEnabled?'Passive buzzer configured on the incubator. Physical sound is not verified.':'Sound disabled: confirm a free buzzer pin. GPIO25 is assigned to the lower roller.';
    }catch(error){status.textContent='Camera status unavailable: '+error.message;url='';hide();button.disabled=true;link.hidden=true;}
    finally{busy=false;}
  }
  poll();setInterval(poll,5000);
});
