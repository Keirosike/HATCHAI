// Canonical camera view shared by the local and online dashboards.
window.HatchCameraView=Object.freeze({mount(root,adapter){
 const toggle=root.querySelector('#cameraPreviewSwitch'),panels=[...root.querySelectorAll('[data-position]')],status=root.querySelector('#cameraStatus');
 let dead=false,busy=false,timer=null,enabled=true,generation=0;const photos=new Map();
 try{enabled=localStorage.getItem('hatchai-camera-preview-v1:'+adapter.mode)!=='off';}catch{}
 toggle.disabled=!adapter.preview;toggle.checked=Boolean(adapter.preview&&enabled);
 function clearPhoto(panel){const photo=photos.get(panel);if(photo){URL.revokeObjectURL(photo.url);photo.image.remove();photos.delete(panel);}}
 function stop(){generation++;for(const p of panels){clearPhoto(p);const frame=p.querySelector('iframe');frame.removeAttribute('src');frame.hidden=true;p.querySelector('.camera-placeholder').hidden=false;}}
 function previewUrl(value){if(adapter.preview!==true||adapter.mode!=='local'||typeof value!=='string')return '';try{const u=new URL(value),b=u.hostname.split('.').map(Number);if(u.protocol!=='http:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port&&u.port!=='80'||b.length!==4||b.some(n=>!Number.isInteger(n)||n<0||n>255)||!(b[0]===10||b[0]===192&&b[1]===168||b[0]===172&&b[1]>=16&&b[1]<=31))return '';return u.href;}catch{return '';}}
 async function snapshot(panel,record,ticket){
  if(!record||!enabled||typeof adapter.getCapture!=='function')return false;
  if(photos.get(panel)?.id===record.id)return true;
  const blob=await adapter.getCapture(record);if(dead||ticket!==generation||!enabled||document.hidden)return false;
  if(!(blob instanceof Blob)||blob.type!=='image/jpeg'||blob.size>131072)throw Error();
  clearPhoto(panel);const image=document.createElement('img');image.className='camera-snapshot';image.alt=(record.position==='upper'?'Upper':'Lower')+' camera capture '+record.capturedAt;
  const url=URL.createObjectURL(blob);image.src=url;panel.querySelector('.camera-viewport').append(image);photos.set(panel,{id:record.id,url,image});return true;
 }
 async function update(){if(dead||busy||document.hidden)return;busy=true;const ticket=generation;
  try{const data=await adapter.getStatus();if(dead||ticket!==generation)return;if(!data||!Array.isArray(data.cameras)||data.cameras.length>2)throw Error();
   const positions=new Set();for(const camera of data.cameras){if(!['upper','lower'].includes(camera.position)||positions.has(camera.position))throw Error();positions.add(camera.position);}
   const records=(Array.isArray(data.captures)?data.captures:[]).slice(0,50).filter(r=>['upper','lower'].includes(r.position)&&typeof r.capturedAt==='string'&&Number.isFinite(Date.parse(r.capturedAt))&&typeof r.chick==='boolean');
   await Promise.all(panels.map(async panel=>{const item=data.cameras.find(c=>c.position===panel.dataset.position),frame=panel.querySelector('iframe'),placeholder=panel.querySelector('.camera-placeholder');
    panel.querySelector('.camera-status').textContent=item?.online===true?(item.detectorOk===false?'Detector unavailable':'Camera connected'):(item?.online===false?'Camera offline':'Unavailable');
    const url=item?.online===true?previewUrl(item.url):'';
    if(adapter.preview==='captures'){
     frame.removeAttribute('src');frame.hidden=true;const record=records.filter(r=>r.position===panel.dataset.position&&typeof r.id==='string'&&/^[0-9a-f-]{36}$/i.test(r.id)).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];
     if(enabled&&record&&!document.hidden){const shown=await snapshot(panel,record,ticket);if(dead||ticket!==generation)return;placeholder.hidden=shown;panel.querySelector('.camera-status').textContent+=' / Latest capture: '+record.capturedAt;}
     else{clearPhoto(panel);placeholder.hidden=false;placeholder.textContent=enabled?'No cloud capture available':'Preview disabled';}
    }else if(enabled&&url&&!document.hidden){if(frame.getAttribute('src')!==url)frame.src=url;frame.hidden=false;placeholder.hidden=true;}
    else{frame.removeAttribute('src');frame.hidden=true;placeholder.hidden=false;placeholder.textContent=!enabled?'Preview disabled':adapter.preview?'Preview unavailable':'Secure cloud preview unavailable';}
   }));
   if(dead||ticket!==generation)return;
   status.textContent=data.unassigned?'A legacy camera is connected without a verified Upper/Lower assignment.':adapter.preview==='captures'?'Cloud previews show the latest stored capture.':'The switch controls preview connections only.';
   const gallery=root.querySelector('#cameraCaptures');gallery.replaceChildren();if(!records.length){const p=document.createElement('p');p.textContent='No verified capture records available.';gallery.append(p);}else for(const record of records){const article=document.createElement('article');article.textContent=(record.position==='upper'?'Upper Camera':'Lower Camera')+' / '+record.capturedAt+' / '+(record.chick?'Chick detected':'No chick detected');gallery.append(article);}
  }catch{if(!dead&&ticket===generation){stop();status.textContent='Camera status unavailable. Retrying automatically.';for(const p of panels)p.querySelector('.camera-status').textContent='Unavailable';}}
  finally{busy=false;if(!dead)timer=setTimeout(update,adapter.mode==='local'?5000:15000);}
 }
 const change=()=>{enabled=toggle.checked;try{localStorage.setItem('hatchai-camera-preview-v1:'+adapter.mode,enabled?'on':'off');}catch{}clearTimeout(timer);if(!enabled)stop();else update();};
 const visibility=()=>{if(document.hidden)stop();else{clearTimeout(timer);update();}};toggle.addEventListener('change',change);document.addEventListener('visibilitychange',visibility);update();
 return ()=>{dead=true;clearTimeout(timer);stop();toggle.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);};
}});
