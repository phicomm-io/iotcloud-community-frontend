// Standalone device pages share a tab-scoped local session. Embedded pages use
// their parent's transport and must never send HTTP credentials over MQTT.
(()=>{
 if(typeof window==='undefined'||window.deviceParentTransport===true)return;
 let prompt=null;
 const tr=(en,zh)=>globalThis.I18N?.lang==='en'?en:zh;
 function signIn(){
  if(prompt)return prompt;
  prompt=new Promise(resolve=>{
   const box=document.createElement('dialog'),form=document.createElement('form'),title=document.createElement('h2'),input=document.createElement('input'),hint=document.createElement('p'),submit=document.createElement('button');
   title.textContent=tr('Sign in to device','登录设备');input.type='password';input.autocomplete='current-password';input.placeholder=tr('Device password','设备密码');input.setAttribute('aria-label',title.textContent);submit.type='submit';submit.textContent=tr('Sign in','登录');
   form.className='stack';submit.className='btn primary';hint.setAttribute('role','alert');
   form.append(title,input,hint,submit);box.append(form);document.body.append(box);
   box.addEventListener('cancel',event=>event.preventDefault());
   form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;hint.textContent='';const password=input.value;input.value='';try{await auth.login(password);box.close?.();box.remove();prompt=null;resolve();globalThis.UI?.reload?.({full:true});}catch(error){hint.textContent=error.status===503?tr('Device busy. Try again.','设备繁忙，请稍后重试。'):tr('Could not sign in. Check the password.','登录失败，请检查密码。');}finally{submit.disabled=false;}};
   if(box.showModal)box.showModal();else box.setAttribute('open','');input.focus();
  });return prompt;
 }
 const fetcher=window.fetch.bind(window),wire=DeviceAuth.createDeviceWire({fetcher});
 const auth=DeviceAuth.createDevicePageAuth({fetcher,wire,onRequired:()=>{signIn();}});
 async function ready(){try{await auth.ensure();}catch(error){if(error.status!==401)throw error;await signIn();}}
 window.DeviceSession={...auth,ready,login:auth.login,async fetch(path,options){await ready();return auth.fetch(path,options);},async logout(){await auth.logout();},headers:auth.headers};
 // Navigation to this device's hub console reuses the same token. Explicit
 // sign-out revokes it; the firmware enforces expiry and password changes.
})();
