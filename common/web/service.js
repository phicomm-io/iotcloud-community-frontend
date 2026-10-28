const checkDeviceWrite=()=>{if(globalThis.DeviceSession?.wire.identity)globalThis.UI?.invalidateIdentity?.(DeviceSession.wire.identity);if(globalThis.UI?.identityChanged)throw Object.assign(Error(I18N.lang==='en'?'Device firmware changed. Refresh this page before saving.':'设备固件已变更，请刷新页面后再保存。'),{code:'identity_changed'});};
const deviceFetch=(path,options={})=>{const write=options.method&&!['GET','HEAD'].includes(options.method.toUpperCase()),check=()=>{if(write)checkDeviceWrite();};check();return globalThis.DeviceSession?DeviceSession.fetch(path,{...options,beforeSend:check}):fetch(path,options);};
// Share only overlapping reads, never completed values or mutations. Each
// subscriber owns cancellation; an unrelated subscriber keeps the wire alive.
const deviceReads=new Map();let deviceReadEpoch=0;
const readAbort=()=>new DOMException('Read superseded','AbortError');
function command(action,params={},options={}){
 if(!action.endsWith('.get'))return deviceCommand(action,params);
 const signal=options.signal;
 if(signal?.aborted)return Promise.reject(readAbort());
 const stable=JSON.stringify(params,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
 const key=deviceReadEpoch+':'+action+':'+stable;
 let read=deviceReads.get(key);
 if(!read){
  const controller=new AbortController();read={controller,users:0};
  read.promise=deviceCommand(action,params,{signal:controller.signal}).finally(()=>{if(deviceReads.get(key)===read)deviceReads.delete(key);});
  deviceReads.set(key,read);
 }
 read.users++;
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(!--read.users&&error?.name==='AbortError'){if(deviceReads.get(key)===read)deviceReads.delete(key);read.controller.abort();}if(error)reject(error);else resolve(globalThis.structuredClone?globalThis.structuredClone(value):JSON.parse(JSON.stringify(value)));};
  const abort=()=>finish(readAbort());signal?.addEventListener('abort',abort,{once:true});
  read.promise.then(value=>finish(null,value),error=>finish(error));
  if(signal?.aborted)abort();
 });
}
async function deviceCommand(action,params={},options={}){
 const identity=globalThis.UI?.identityGeneration||0;
 const request={action,params};
 if(!action.endsWith('.get'))request.request_id=globalThis.crypto?.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
 try{
 if(options.signal?.aborted)throw readAbort();
 const response=await deviceFetch('/api/v1/command',{method:'POST',signal:controller.signal,...(globalThis.DeviceSession?{value:request}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}),cache:'no-store'});
 if(identity!==(globalThis.UI?.identityGeneration||0))throw Object.assign(Error('Device identity changed'),{code:'identity_changed'});
 let reply;try{reply=await (globalThis.DeviceAuth?DeviceAuth.decodeResponse(response):response.json());}catch(error){if(response.status!==503)throw error;reply={code:'busy'};}
 if(identity!==(globalThis.UI?.identityGeneration||0))throw Object.assign(Error('Device identity changed'),{code:'identity_changed'});
 if(!response.ok||!['ok','accepted'].includes(reply.code)){const key='error.'+reply.code;const error=Error(globalThis.I18N?.has(key)?I18N.t(key):reply.message||reply.code||('HTTP '+response.status));error.code=reply.code;throw error;}
 if(action==='capabilities.get'&&globalThis.DeviceSession?.wire.format==='msgpack')DeviceAuth.verifyCapabilities(reply.data,DeviceSession.wire.identity);
 if(!action.endsWith('.get')){deviceReadEpoch++;globalThis.UI?.invalidateStatus?.();}
 return reply.data||{};
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
async function api(path,data,options={}){
 if(path==='/auth/password'&&globalThis.DeviceSession){checkDeviceWrite();const reply=await DeviceSession.changePassword(data.password,{beforeSend:checkDeviceWrite});deviceReadEpoch++;globalThis.UI?.invalidateStatus?.();return reply.data||{};}
 if(path==='/status')return command('status.get',{},options);
 if(path==='/sensors/average')return command('sensors.average.get',{},options);
 if(path==='/power')return command('power.get',{},options);
 if(path==='/wifi/scan')return command(data===undefined?'wifi.scan.get':'wifi.scan');
 const domains={'/binding/config':'binding','/binding/status':'binding.status','/binding/probe':'binding.probe','/linkage/config':'linkage','/light/advanced':'light_effect','/sleep/config':'night','/time/config':'time'};
 if(domains[path])return command(domains[path]+(path==='/binding/probe'?'':data===undefined?'.get':'.set'),data||{},options);
 const direct={'/reboot':'system.reboot','/device/reset':'system.reset','/ota':'ota.start','/childLock':'child_lock.set','/child_lock':'child_lock.set','/led':'indicator.set','/outlet':'outlet.set','/fan':'fan.set','/fan/config':'fan.set','/light':'light.set','/light/config':'light.set'};
 if(direct[path]){if(['/light','/light/config'].includes(path)&&data.brightness!==undefined)data={...data,brightness:Math.round(data.brightness*100/255)};return command(direct[path],data);}
 if(path==='/display/brightness')return command('display.set',{brightness:data.level*25});
 if(path==='/socket'){for(let index=0;index<data.states.length;index++)await command('outlet.set',{index,on:!!data.states[index]});return {};}
 const sections={'/wifi/config':'wifi','/mqtt/config':'mqtt','/deviceName':'device','/auth/password':'auth','/socketNames':'socket','/mqtt/report/freq':'report','/power/coefficient':'meter','/ntp/config':'ntp'};
 if(sections[path]){
  let values={...data};
  if(path==='/power/coefficient')values={coefficient_x100:Number(data)};
  if(path==='/mqtt/config'){delete values.topic_mode;delete values.clear_password;if(data.clear_password)values.password='';else if(!values.password)delete values.password;}
  if(path==='/wifi/config'){delete values.open_network;if(data.open_network)values.password='';else if(!values.password)delete values.password;}
  return command('config.set',{section:sections[path],values});
 }
 throw Error(globalThis.I18N?.t('common.unsupported')||'Unsupported operation');
}
