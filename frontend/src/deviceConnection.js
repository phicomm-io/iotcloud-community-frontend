
import {t} from './i18n.js';
import {normalizeMAC} from './deviceProtocol.js';
import {createDeviceHttpSession} from './deviceHttpSession.js';

export function localAddress(raw){
 if(!raw)return '';
 const value=String(raw).trim();
 if(!/^(?:http:\/\/)?\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\/?$/.test(value))throw Error(t('p.8c1e3096f2fd'));
 const url=new URL(value.startsWith('http://')?value:'http://'+value),p=url.hostname.split('.').map(Number);
 if(p.length!==4||p.some(n=>n>255)||!(p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168))||Number(url.port||80)<1||Number(url.port||80)>65535)throw Error(t('p.67be4629a923'));
 return url.origin;
}
const storageKey=(scope,key)=>'phicomm.device-connection.'+encodeURIComponent(scope)+':'+encodeURIComponent(key);
export function loadPreference(scope,key,storage=localStorage){
 try{const p=JSON.parse(storage.getItem(storageKey(scope,key))||'{}');return {mode:p.mode==='mqtt'?'mqtt':'auto',address:localAddress(p.address||''),lastAddress:localAddress(p.lastAddress||'')};}catch{return {mode:'auto',address:'',lastAddress:''};}
}
export function savePreference(scope,key,value,storage=localStorage){
 const p={mode:value.mode==='mqtt'?'mqtt':'auto',address:localAddress(value.address||''),lastAddress:localAddress(value.lastAddress||'')};storage.setItem(storageKey(scope,key),JSON.stringify(p));return p;
}
export function basicPassword(password){return 'Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+password)));}
export function createDeviceTransport({fetcher=globalThis.fetch,records={},onStatus=()=>{}}={}){
 let active=0,disposed=false;const entries=new Map(),queue=[];
 const drain=()=>{while(active<2&&queue.length){active++;queue.shift()();}};
 const slot=()=>new Promise(resolve=>{queue.push(resolve);drain();});
 const current=(key,e)=>!disposed&&entries.get(key)===e;
 const pagehide=()=>{for(const e of entries.values())e.session.auth.release();};
 globalThis.addEventListener?.('pagehide',pagehide);
 async function request(e,path,{signal,...options}={},timeout=20000,raw=false){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();e.controllers.add(abort);
  try{
   const r=await e.session.fetch(path,{...options,signal:abort.signal});
   if(!r.ok){let reply;try{reply=await e.session.wire.decodeResponse(r);}catch{}const error=Error(r.status===401?t('p.aca4ebdbc19f'):reply?.message||reply?.code||t('p.23a84a23f636')+r.status);error.status=r.status;error.code=reply?.code||(r.status===503?'busy':'http_error');if(reply?.code)error.reply=reply;throw error;}
   return raw?{status:r.status,bytes:await r.arrayBuffer()}:await e.session.wire.decodeResponse(r);
  }finally{clearTimeout(timer);e.controllers.delete(abort);signal?.removeEventListener('abort',cancel);}
 }
 function invalidate(e){for(const c of e.controllers)c.abort();e.controllers.clear();e.session.release();}
 function configure(key,device,prefs,password='',force=false){
  const address=prefs.address||prefs.lastAddress||'',old=entries.get(key);
  if(!force&&old&&old.address===address&&old.mode===prefs.mode&&old.password===password&&['mac','model','firmware_version','firmware_variant','variant','wire_format','wire_version'].every(field=>old.device[field]===device[field]))return;
  if(old)invalidate(old);
  const entry={device:{...device},address,mode:prefs.mode,password,controllers:new Set(),promise:null};
  entry.session=createDeviceHttpSession({fetcher,origin:address,expectedIdentity:device,password,onRequired:()=>{if(current(key,entry))Object.assign(records[key],{ready:false,reason:t('p.aca4ebdbc19f')});}});
  entries.set(key,entry);
  records[key]={ready:false,checking:false,address,reason:prefs.mode==='mqtt'?t('p.148579fd130e'):address?t('p.3a811788f296'):t('p.fed0dc5b0c2f')};
 }
 async function probe(key,force=false){
  const e=entries.get(key);if(!e||disposed||e.mode==='mqtt'||!e.address)return false;if(e.promise)return e.promise;if(!force&&e.lastProbe&&Date.now()-e.lastProbe<30000)return !!records[key]?.ready;e.lastProbe=Date.now();
  e.promise=(async()=>{
   await slot();
   try{
    if(!current(key,e))return false;
    records[key].checking=true;
    // One deadline covers identity and the initial status read.
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
    try{
     await e.session.ready(controller.signal);const identity=e.session.wire.identity,i={...identity,firmware_variant:identity.variant,api_version:1};
     const status=await request(e,'/api/v1/command',{method:'POST',value:{action:'status.get',params:{}},signal:controller.signal},2000);
     if(status.code!=='ok'||!status.data||normalizeMAC(status.data.device_id)!==normalizeMAC(e.device.mac))throw Error(t('p.6966db4cb1c5'));
     if(current(key,e)){records[key]={ready:true,checking:false,address:e.address,reason:t('p.a2d6d3fd2463'),info:i};onStatus(key,status.data);}
     return current(key,e);
    }finally{clearTimeout(timer);}
   }catch(err){if(current(key,e))records[key]={ready:false,checking:false,address:e.address,reason:err.name==='AbortError'?t('p.dc4ace469fac'):err.message||t('p.f09b3b04b23a')};return false;}
   finally{active--;drain();e.promise=null;}
  })();return e.promise;
 }
 async function dispatch(key,requestData,mqttRequest){
  const e=entries.get(key);if(!e)return mqttRequest();if(e?.mode!=='mqtt'&&e?.address&&!records[key]?.ready)await probe(key);
  if(!e||!current(key,e))return {code:'offline',message:t('p.ec7c88a78b95')};
  if(!records[key]?.ready||e.mode==='mqtt')return mqttRequest();
  try{
   const result=await request(e,'/api/v1/command',{method:'POST',value:requestData});
   if(!current(key,e))return {code:'offline',message:t('p.9b8764282633')};
   if(requestData.action==='status.get'&&result.code==='ok')onStatus(key,result.data);
   return result;
  }catch(err){
   if(err.reply&&current(key,e))return err.reply;
   if(err.code==='busy'&&current(key,e))return {code:'busy',message:err.message};
   if(current(key,e))Object.assign(records[key],{ready:false,reason:err.message||t('p.b1d97389d90c')});
   if(requestData.action.endsWith('.get')&&current(key,e))return mqttRequest();
   return {code:'uncertain',message:t('p.f8277e40c9dd')};
  }
 }
 function upload(key,file,rescue,onProgress=()=>{},XMLHttpRequestClass=globalThis.XMLHttpRequest,target){
  const e=entries.get(key);
  const reject=text=>({promise:Promise.resolve({status:0,text}),abort(){}});
  if(!e||e.mode==='mqtt'||!records[key]?.ready)return reject(t('p.6bc40dfa1f9f'));
  if(target!==undefined){
   if(target?.variant!=='hub'||target?.confirm!=='full-to-hub'||e.device.model!=='daikin'||rescue)return reject(t('p.bcce0d150ca6'));
   try{if(localAddress(e.address)!==e.address)return reject(t('p.6bc40dfa1f9f'));}catch{return reject(t('p.6bc40dfa1f9f'));}
  }
  const xhr=new XMLHttpRequestClass(),controller={abort:()=>xhr.abort()};e.controllers.add(controller);
  const promise=new Promise(resolve=>{
   xhr.open('POST',e.address+(target?'/api/v1/ota/convert':rescue?'/api/v1/ota/upload-unsigned':'/api/v1/ota/upload'));xhr.timeout=310000;xhr.withCredentials=false;xhr.responseType='arraybuffer';xhr.setRequestHeader('Accept',e.session.wire.headers().Accept);xhr.setRequestHeader('Content-Type','application/octet-stream');const authorization=e.session.auth.headers().Authorization;if(authorization)xhr.setRequestHeader('Authorization',authorization);
   if(target){xhr.setRequestHeader('X-IoTCloud-Target-Variant','hub');xhr.setRequestHeader('X-IoTCloud-Confirm','full-to-hub');}
   xhr.upload.onprogress=event=>{if(current(key,e)&&event.lengthComputable)onProgress(event.loaded,event.total);};
   xhr.onload=async()=>{
    e.session.auth.observe(xhr.status,authorization);let text='';
    try{if(xhr.response!==undefined&&xhr.response!==null){const reply=await e.session.wire.decodeResponse(new Response(xhr.response,{status:xhr.status,headers:{'Content-Type':xhr.getResponseHeader?.('Content-Type')||e.session.wire.headers().Accept}}));text=reply.message||reply.code||'';}else text=xhr.responseText||'';}catch{text='HTTP '+xhr.status;}
    resolve({status:xhr.status,text});
   };
   xhr.onerror=xhr.ontimeout=xhr.onabort=()=>resolve({status:0,text:t('p.404da89a85cb')});
   xhr.send(file);
  }).finally(()=>e.controllers.delete(controller));return {promise,abort:controller.abort};
 }
 async function resource(key,path,options={}){
  const e=entries.get(key),method=options.method||'GET';
  if(!((path==='/api/v1/config/backup'&&method==='GET')||(path==='/api/v1/config/restore'&&method==='POST')))throw Error(t('backup.invalid_path'));
  if(!e||e.mode==='mqtt'||!await probe(key,true)||!current(key,e))throw Error(t('backup.lan_required'));
  const result=await request(e,path,{method,body:options.body,signal:options.signal,headers:{'Content-Type':'application/octet-stream'}},20000,true);
  if(!current(key,e))throw Error(t('backup.device_changed'));
  return result;
 }
 function retain(keys){for(const [key,e] of entries)if(!keys.includes(key)){invalidate(e);entries.delete(key);delete records[key];}}
 function stop(){disposed=true;globalThis.removeEventListener?.('pagehide',pagehide);for(const e of entries.values())invalidate(e);entries.clear();drain();}
 return {configure,probe,dispatch,upload,resource,retain,stop};
}
