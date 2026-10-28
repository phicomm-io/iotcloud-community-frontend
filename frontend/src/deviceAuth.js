// Authentication is independent of the business wire format.
const encodeWire=value=>JSON.stringify(value);
const decodeResponse=response=>response.json();

const authError=(code,status)=>Object.assign(Error(code==='unauthorized'?'Sign in to this device':code==='busy'?'Device busy; try again':code),{code,status});
const basic=password=>'Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+password)));
// One page owns one session. Neither passwords nor tokens enter browser storage.
export function createDeviceAuth({fetcher=globalThis.fetch,origin='',onRequired=()=>{},allowLegacy=true}={}){
 let token='',legacy='',legacyReady=false,blocked=false,pending=null,generation=0,loginAbort=null,emptySession=false;
 const headers=()=>token?{Authorization:'Bearer '+token}:legacy?{Authorization:legacy}:{};
 const reset=({requireLogin=true}={})=>{generation++;loginAbort?.abort();loginAbort=null;token=legacy='';legacyReady=false;emptySession=false;blocked=requireLogin;pending=null;};
 function required(){if(!blocked){blocked=true;onRequired();}}
 function observe(status,authorization){if(authorization!==undefined&&authorization!==headers().Authorization)return;if(status===401){if(emptySession&&token){reset({requireLogin:false});return login('').catch(()=>{});}token=legacy='';legacyReady=false;required();}}
 async function login(password=''){
  if(pending)return pending;
  const previous=token;token=legacy='';legacyReady=false;emptySession=false;
  const version=generation,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);loginAbort=controller;
  pending=(async()=>{
   if(previous)await retire(previous);
   if(version!==generation)throw authError('cancelled',0);
   const response=await fetcher(origin+'/api/v1/auth/login',{method:'POST',signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json'},body:encodeWire({password})});
   if(version!==generation&&!response.ok)throw authError('cancelled',0);
   if(response.status===404&&allowLegacy){legacy=password?basic(password):'';legacyReady=true;emptySession=password==='';blocked=false;return;}
   if(response.status===401){token=legacy='';legacyReady=false;emptySession=false;required();throw authError('unauthorized',401);}
   if(!response.ok)throw authError(response.status===503?'busy':'HTTP '+response.status,response.status);
   const reply=await decodeResponse(response),next=reply?.data?.token;
   if(version!==generation){if(typeof next==='string'&&/^[a-f0-9]{32}$/.test(next))retire(next);throw authError('cancelled',0);}
   if(reply.code!=='ok'||typeof next!=='string'||!/^[a-f0-9]{32}$/.test(next))throw authError('Invalid device session',response.status);
   token=next;legacy='';legacyReady=false;emptySession=password==='';blocked=false;
  })();
  try{return await pending;}finally{clearTimeout(timer);if(version===generation){pending=null;loginAbort=null;}}
 }
 async function ensure(){if(token||legacyReady)return;if(blocked)throw authError('unauthorized',401);await login('');}
 async function request(path,options={}){
  await ensure();
  const version=generation,authorization=headers().Authorization;
  const response=await fetcher(origin+path,{...options,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json',...options.headers,...headers()}});
  if(version===generation)await observe(response.status,authorization);
  return response; // Never replay a mutation, including after expiration.
 }
 async function logout(){const silent=emptySession;try{if(token)await request('/api/v1/auth/logout',{method:'POST','headers':{'Content-Type':'application/json'},body:encodeWire({})});}finally{reset({requireLogin:!silent});if(!silent)onRequired();}}
 function retire(value){
  // Only the exact token owned by this instance is retired; never reauthenticate.
  let timer;const deadline=new Promise(resolve=>{timer=setTimeout(resolve,2000);});
  try{return Promise.race([deadline,Promise.resolve(fetcher(origin+'/api/v1/auth/logout',{method:'POST',keepalive:true,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+value},body:encodeWire({})})).catch(()=>{})]).finally(()=>clearTimeout(timer));}catch{clearTimeout(timer);return Promise.resolve();}
 }
 function release(){
  const previous=token;reset({requireLogin:false});
  return previous?retire(previous):Promise.resolve();
 }
 async function changePassword(password){await ensure();const version=generation,authorization=headers().Authorization;const response=await request('/api/v1/command',{method:'POST',headers:{'Content-Type':'application/json'},body:encodeWire({action:'config.set',request_id:globalThis.crypto?.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),params:{section:'auth',values:{password}}})});if(!response.ok)throw authError(response.status===401?'unauthorized':response.status===503?'busy':'HTTP '+response.status,response.status);const reply=await decodeResponse(response);if(!['ok','accepted'].includes(reply?.code))throw authError(reply?.code||'Invalid device response',response.status);if(version!==generation||authorization!==headers().Authorization)return reply;reset({requireLogin:password!==''});if(password!=='')onRequired();return reply;}
 return {login,ensure,fetch:request,headers,observe,logout,release,changePassword,reset,setOnRequired(callback){onRequired=callback;},get authenticated(){return !!token||legacyReady;},get needsLogin(){return blocked;}};
}
