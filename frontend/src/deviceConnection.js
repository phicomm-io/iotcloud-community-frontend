import {normalizeMAC} from './deviceProtocol.js';

export function localAddress(raw){
 if(!raw)return '';
 const value=String(raw).trim();
 if(!/^(?:http:\/\/)?\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\/?$/.test(value))throw Error('请输入内网 IPv4 地址，可附加端口');
 const url=new URL(value.startsWith('http://')?value:'http://'+value),p=url.hostname.split('.').map(Number);
 if(p.length!==4||p.some(n=>n>255)||!(p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168))||Number(url.port||80)<1||Number(url.port||80)>65535)throw Error('请输入有效的内网 IPv4 地址');
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
 async function request(e,path,{signal,...options}={},timeout=20000){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();e.controllers.add(abort);
  try{const r=await fetcher(e.address+path,{...options,signal:abort.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{...options.headers,...(e.password?{Authorization:basicPassword(e.password)}:{})}});if(r.status===401)throw Error('网页管理密码错误或未填写');if(!r.ok)throw Error('设备 HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);e.controllers.delete(abort);signal?.removeEventListener('abort',cancel);}
 }
 function invalidate(e){for(const c of e.controllers)c.abort();e.controllers.clear();}
 function configure(key,device,prefs,password=''){
  const address=prefs.address||prefs.lastAddress||'',old=entries.get(key);
  if(old&&old.address===address&&old.mode===prefs.mode&&old.password===password&&old.device.mac===device.mac&&old.device.model===device.model)return;
  if(old)invalidate(old);
  entries.set(key,{device:{...device},address,mode:prefs.mode,password,controllers:new Set(),promise:null});
  records[key]={ready:false,checking:false,address,reason:prefs.mode==='mqtt'?'始终使用 MQTT':address?'等待探测':'未设置内网地址'};
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
     const info=await request(e,'/api/v1/info',{signal:controller.signal},2000),i=info.data;
     if(info.code!=='ok'||!i||normalizeMAC(i.device_id)!==normalizeMAC(e.device.mac)||i.model!==e.device.model||i.api_version!==1)throw Error('地址对应的设备身份不匹配或固件不支持内网连接');
     const status=await request(e,'/api/v1/status',{signal:controller.signal},2000);
     if(status.code!=='ok'||!status.data||normalizeMAC(status.data.device_id)!==normalizeMAC(e.device.mac))throw Error('设备状态校验失败');
     if(current(key,e)){records[key]={ready:true,checking:false,address:e.address,reason:'内网已连接',info:i};onStatus(key,status.data);}
     return current(key,e);
    }finally{clearTimeout(timer);}
   }catch(err){if(current(key,e))records[key]={ready:false,checking:false,address:e.address,reason:err.name==='AbortError'?'内网探测超时':err.message||'浏览器未允许内网访问，可继续使用 MQTT'};return false;}
   finally{active--;drain();e.promise=null;}
  })();return e.promise;
 }
 async function dispatch(key,requestData,mqttRequest){
  const e=entries.get(key);if(!e)return mqttRequest();if(e?.mode!=='mqtt'&&e?.address&&!records[key]?.ready)await probe(key);
  if(!e||!current(key,e))return {code:'offline',message:'设备连接已变化，请重试'};
  if(!records[key]?.ready||e.mode==='mqtt')return mqttRequest();
  try{
   const result=await request(e,'/api/v1/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestData)});
   if(!current(key,e))return {code:'offline',message:'设备连接已变化，请重新读取状态'};
   if(requestData.action==='status.get'&&result.code==='ok')onStatus(key,result.data);
   return result;
  }catch(err){
   if(current(key,e))Object.assign(records[key],{ready:false,reason:err.message||'内网连接中断'});
   if(requestData.action.endsWith('.get')&&current(key,e))return mqttRequest();
   return {code:'uncertain',message:'操作回执未确认，请读取设备状态后再决定是否重试'};
  }
 }
 function upload(key,file,rescue,onProgress=()=>{},XMLHttpRequestClass=globalThis.XMLHttpRequest){
  const e=entries.get(key);
  if(!e||e.mode==='mqtt'||!records[key]?.ready)return {promise:Promise.resolve({status:0,text:'文件上传需要可用的内网连接，请检查地址、网页密码与浏览器权限'}),abort(){}};
  const xhr=new XMLHttpRequestClass(),controller={abort:()=>xhr.abort()};e.controllers.add(controller);
  const promise=new Promise(resolve=>{
   xhr.open('POST',e.address+(rescue?'/api/v1/ota/upload-unsigned':'/api/v1/ota/upload'));xhr.timeout=310000;xhr.withCredentials=false;xhr.setRequestHeader('Content-Type','application/octet-stream');if(e.password)xhr.setRequestHeader('Authorization',basicPassword(e.password));
   xhr.upload.onprogress=event=>{if(current(key,e)&&event.lengthComputable)onProgress(event.loaded,event.total);};
   xhr.onload=()=>resolve({status:xhr.status,text:xhr.responseText});
   xhr.onerror=xhr.ontimeout=xhr.onabort=()=>resolve({status:0,text:'上传结果未确认，请读取设备升级状态；不会自动重传'});
   xhr.send(file);
  }).finally(()=>e.controllers.delete(controller));return {promise,abort:controller.abort};
 }
 function retain(keys){for(const [key,e] of entries)if(!keys.includes(key)){invalidate(e);entries.delete(key);delete records[key];}}
 function stop(){disposed=true;for(const e of entries.values())invalidate(e);entries.clear();drain();}
 return {configure,probe,dispatch,upload,retain,stop};
}
