// Authentication shares the verified device wire contract.
import {fixedDeviceWire,createDeviceWire,decodeResponse} from './deviceWire.js';
export {createDeviceWire,decodeResponse};
export {verifyCapabilities} from './deviceWire.js';

const authError=(code,status)=>Object.assign(Error(code==='unauthorized'?'Sign in to this device':code==='busy'?'Device busy; try again':code),{code,status});
const basic=password=>'Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+password)));
// Remote device connections own an ephemeral session. Standalone pages can opt
// into a tab-scoped token shared with the same device's embedded hub console.
export function createDeviceAuth({fetcher=globalThis.fetch,origin='',onRequired=()=>{},allowLegacy=true,wire=fixedDeviceWire({fetcher,origin}),sessionStore=null}={}){
 let token='',legacy='',legacyReady=false,blocked=false,pending=null,generation=0,loginAbort=null,emptySession=false,discovered=false,rebindGeneration=-1;
 let restoreAttempted=false,restoring=null,restoreAbort=null;
 const clearStored=()=>{try{sessionStore?.clear();}catch{}};
 const storeSession=()=>{try{if(token&&wire.identity)sessionStore?.write({token,identity:wire.identity,expires:Date.now()+1800000});else clearStored();}catch{}};
 const headers=()=>token?{Authorization:'Bearer '+token}:legacy?{Authorization:legacy}:{};
 const reset=({requireLogin=true}={})=>{generation++;loginAbort?.abort();loginAbort=null;restoreAbort?.abort();restoreAbort=null;token=legacy='';legacyReady=false;emptySession=false;blocked=requireLogin;pending=null;clearStored();};
 function required(){if(!blocked){blocked=true;onRequired();}}
 function observe(status,authorization){if(arguments.length>1&&authorization!==headers().Authorization)return;if(status===401){if(emptySession&&token){reset({requireLogin:false});return login('').catch(()=>{});}token=legacy='';legacyReady=false;clearStored();required();}}
 async function login(password=''){
  if(pending)return pending;
  const previous=token;token=legacy='';legacyReady=false;emptySession=false;restoreAttempted=true;clearStored();
  let version=generation;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);loginAbort=controller;
  pending=(async()=>{
   if(previous)await retire(previous);
   if(version!==generation)throw authError('cancelled',0);
   await wire.discover({legacyPassword:password,signal:controller.signal,force:discovered});discovered=true;
   if(rebindGeneration===generation&&version===generation-1)version=generation;
   if(version!==generation)throw authError('cancelled',0);
   const response=await wire.request('/api/v1/auth/login',{method:'POST',signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',...(wire.format==='json'&&wire.legacyBasicVerified&&password?{headers:{Authorization:basic(password)}}:{}),value:{password}});
   if(version!==generation&&!response.ok)throw authError('cancelled',0);
   if(response.status===404&&allowLegacy&&wire.format==='json'){legacy=password?basic(password):'';legacyReady=true;emptySession=password==='';blocked=false;return;}
   if(response.status===401){token=legacy='';legacyReady=false;emptySession=false;required();throw authError('unauthorized',401);}
   if(!response.ok)throw authError(response.status===503?'busy':'HTTP '+response.status,response.status);
   const reply=await decodeResponse(response),next=reply?.data?.token;
   if(version!==generation){if(typeof next==='string'&&/^[a-f0-9]{32}$/.test(next))retire(next);throw authError('cancelled',0);}
   if(reply.code==='ok'&&reply.data?.password_required===false&&next===''){
    legacyReady=true;emptySession=true;blocked=false;return;
   }
   if(reply.code!=='ok'||typeof next!=='string'||!/^[a-f0-9]{32}$/.test(next))throw authError('Invalid device session',response.status);
   token=next;legacy='';legacyReady=false;emptySession=password==='';blocked=false;storeSession();
  })();
  try{return await pending;}finally{clearTimeout(timer);if(version===generation){pending=null;loginAbort=null;}}
 }
 async function ensure(){
  const version=generation;
  if(token||legacyReady)return version;
  if(blocked)throw authError('unauthorized',401);
  if(sessionStore&&!restoreAttempted){
   restoring||=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);restoreAbort=controller;
    try{await wire.discover({signal:controller.signal});discovered=true;}finally{clearTimeout(timer);if(restoreAbort===controller)restoreAbort=null;}
    if(version!==generation||restoreAttempted)return;
    restoreAttempted=true;
    let saved;try{saved=sessionStore.read();}catch{}
    if(saved&&typeof saved.token==='string'&&/^[a-f0-9]{32}$/.test(saved.token)&&
       Number.isFinite(saved.expires)&&saved.expires>Date.now()&&saved.expires<=Date.now()+1800000&&
       wire.identity&&JSON.stringify(saved.identity)===JSON.stringify(wire.identity))token=saved.token;
    else clearStored();
   })().finally(()=>{restoring=null;});
   await restoring;
   if(version!==generation)throw authError('cancelled',0);
   if(token)return version;
  }
  await login('');
  if(version!==generation&&rebindGeneration!==generation)throw authError('cancelled',0);
  return generation;
 }
 async function request(path,options={}){
  const version=await ensure();
  if(version!==generation||options.signal?.aborted)throw authError('cancelled',0);
  const authorization=headers().Authorization;
  const response=await wire.request(path,{...options,credentials:'omit',redirect:'error',cache:'no-store',headers:{...options.headers,...headers()},beforeSend(){if(version!==generation||options.signal?.aborted)throw authError('cancelled',0);options.beforeSend?.();}});
  if(version===generation)await observe(response.status,authorization);
  return response; // Never replay a mutation, including after expiration.
 }
 async function logout(){const silent=emptySession,version=generation,authorization=headers().Authorization;try{if(token)await wire.request('/api/v1/auth/logout',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{Authorization:authorization},value:{}});}finally{if(version===generation&&authorization===headers().Authorization){reset({requireLogin:!silent});if(!silent)onRequired();}}}
 function retire(value){
  // Only the exact token owned by this instance is retired; never reauthenticate.
  let timer;const deadline=new Promise(resolve=>{timer=setTimeout(resolve,2000);});
  try{return Promise.race([deadline,Promise.resolve(wire.request('/api/v1/auth/logout',{method:'POST',keepalive:true,credentials:'omit',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+value},value:{}})).catch(()=>{})]).finally(()=>clearTimeout(timer));}catch{clearTimeout(timer);return Promise.resolve();}
 }
 function release(){
  const previous=token;reset({requireLogin:false});
  return previous?retire(previous):Promise.resolve();
 }
 async function changePassword(password,{relogin=false,beforeSend}={}){const version=await ensure();if(version!==generation)throw authError('cancelled',0);const authorization=headers().Authorization;const response=await request('/api/v1/command',{method:'POST',beforeSend,value:{action:'config.set',request_id:globalThis.crypto?.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),params:{section:'auth',values:{password}}}});if(!response.ok)throw authError(response.status===401?'unauthorized':response.status===503?'busy':'HTTP '+response.status,response.status);const reply=await decodeResponse(response);if(!['ok','accepted'].includes(reply?.code))throw authError(reply?.code||'Invalid device response',response.status);if(version!==generation||authorization!==headers().Authorization)return reply;reset({requireLogin:password!==''&&!relogin});if(relogin)await login(password);else if(password!=='')onRequired();return reply;}
 wire.setOnIdentityChange?.(()=>{if(loginAbort){generation++;rebindGeneration=generation;token=legacy='';legacyReady=false;emptySession=false;blocked=false;}else reset({requireLogin:false});});
 return {wire,login,ensure,fetch:request,headers,observe,logout,release,changePassword,reset,setOnRequired(callback){onRequired=callback;},get authenticated(){return !!token||legacyReady;},get needsLogin(){return blocked;}};
}

// Only a same-origin page can retain its token across navigation. Passwords,
// legacy Basic credentials and remotely connected devices are never persisted.
export function createDevicePageAuth(options={}){
 let sessionStore=null;
 try{
  const location=globalThis.location;
  if(location&&new URL(options.origin||location.origin,location.href).origin===location.origin){
   const storage=globalThis.sessionStorage,key='iotcloud.device-session.v1';
   sessionStore={read:()=>JSON.parse(storage.getItem(key)||'null'),write:value=>storage.setItem(key,JSON.stringify(value)),clear:()=>storage.removeItem(key)};
  }
 }catch{}
 return createDeviceAuth({...options,sessionStore});
}
