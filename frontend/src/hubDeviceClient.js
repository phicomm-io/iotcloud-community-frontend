import {commandFormat,deviceEntry,deviceKey,normalizeMAC,requestId,statusSnapshot} from './deviceProtocol.js';
import {verifyCapabilities} from './deviceWire.js';

const abortError=()=>new DOMException('Read superseded','AbortError');
const failure=code=>Object.assign(Error(code),{code});
export const hubDeviceIdentity=d=>[d.mac,d.model,d.wire_format,d.wire_version,d.firmware_version,d.variant||d.firmware_variant].join('/');
const identity=hubDeviceIdentity;
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);

// /devices is the gateway's discovery-bound inventory, not a browser LAN probe.
export function hubDeviceEntry(raw){
 return {...deviceEntry({...raw,wire_format:raw.default_wire_format||raw.wire_format||'',variant:raw.variant||raw.firmware_variant}),
  ...(typeof raw.online==='boolean'?{online:raw.online}:{}),...(raw.ip?{ip:raw.ip}:{}),...(typeof raw.paired==='boolean'?{paired:raw.paired}:{})};
}

// One gateway has one UDP command slot. Keep that lane occupied through body
// decoding, even after a page stops reading. Writes are sent exactly once.
export function createHubDeviceClient({request,onStatus=()=>{},onCapabilities=()=>{},timeoutMs=12000,maxQueued=64}={}){
 const devices=new Map(),epochs=new Map(),reads=new Map(),jobs=[];
 let working=false,disposed=false;
 const current=job=>!disposed&&identity(devices.get(job.key)||{})===job.identity;
 function retain(list){
  const next=new Map(list.map(d=>[deviceKey(d),d]));
  for(const job of [...jobs])if(job.read&&identity(next.get(job.key)||{})!==job.identity)cancel(job);
  for(const job of reads.values())if(identity(next.get(job.key)||{})!==job.identity)cancel(job);
  devices.clear();for(const [key,d] of next)devices.set(key,{...d});
 }
 function finishUser(user,error,value){
  if(user.done)return;
  user.done=true;user.signal?.removeEventListener('abort',user.abort);
  if(error)user.reject(error);else user.resolve(structuredClone(value));
 }
 function cancel(job){
  for(const user of job.users)finishUser(user,abortError());
  if(reads.get(job.signature)===job)reads.delete(job.signature);
  const index=jobs.indexOf(job);if(index>=0)jobs.splice(index,1);
 }
 async function drain(){
  if(working)return;working=true;
  try{while(jobs.length){
   jobs.sort((a,b)=>a.priority-b.priority);
   const job=jobs.shift();
   if(job.read&&(!current(job)||job.users.every(user=>user.done))){cancel(job);continue;}
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   let result;
   try{
    result=await request('/hub/devices/'+job.device.mac+'/command',{method:'POST',body:JSON.stringify(job.data),signal:controller.signal});
    if(!result||typeof result.code!=='string'||result.request_id!==job.data.request_id)throw failure('invalid_reply');
    if(job.read&&!current(job))throw failure('identity_changed');
    if(result.code==='ok'&&job.data.action==='capabilities.get'){
     try{verifyCapabilities(result.data,{device_id:job.device.mac,model:job.device.model,firmware_version:job.device.firmware_version,variant:job.device.variant||job.device.firmware_variant});}catch{throw failure('identity_mismatch');}
    }
    if(result.code==='ok'&&job.data.action==='status.get'){
     if(!result.data||normalizeMAC(result.data.device_id)!==job.device.mac)throw failure('identity_mismatch');
     if(current(job)&&job.epoch===(epochs.get(job.key)||0)&&job.users.some(user=>!user.done))onStatus(job.key,statusSnapshot(result.data));
    }
    if(result.code==='ok'&&job.data.action==='capabilities.get'&&current(job)&&job.users.some(user=>!user.done))onCapabilities(job.key,result.data);
   }catch(error){
    result=error.reply&&error.reply.request_id===job.data.request_id?error.reply:{code:controller.signal.aborted?'timeout':error.code||(job.read?'offline':'uncertain'),message:error.message,request_id:job.data.request_id};
   }finally{clearTimeout(timer);if(!job.read)epochs.set(job.key,(epochs.get(job.key)||0)+1);if(reads.get(job.signature)===job)reads.delete(job.signature);}
   for(const user of job.users)finishUser(user,null,result);
  }}finally{working=false;}
 }
 function dispatch(device,requestData,{signal,background=false}={}){
  const captured={...device},key=deviceKey(captured),read=String(requestData.action||'').endsWith('.get');
  if(disposed)return Promise.resolve({code:'offline'});
  if(read&&signal?.aborted)return Promise.reject(abortError());
  try{if(commandFormat(captured)!=='msgpack')throw failure('discovery_required');}catch(error){return Promise.resolve({code:error.code||'discovery_required'});}
  if(!devices.has(key)||identity(devices.get(key))!==identity(captured))return Promise.resolve({code:'identity_changed'});
  if(!read)epochs.set(key,(epochs.get(key)||0)+1);
  const signature=[key,identity(captured),epochs.get(key)||0,requestData.action,stable(requestData.params||{})].join(':');
  let job=read?reads.get(signature):null;
  if(!job){
   if(jobs.length>=maxQueued)return Promise.resolve({code:'busy'});
   job={device:captured,key,identity:identity(captured),epoch:epochs.get(key)||0,signature,read,priority:read?(background?2:1):0,users:[],data:{action:requestData.action,params:requestData.params||{},request_id:requestData.request_id||requestId()}};
   jobs.push(job);if(read)reads.set(signature,job);
  }else if(!background)job.priority=1;
  const result=new Promise((resolve,reject)=>{
   const user={resolve,reject,signal:read?signal:undefined,done:false};
   user.abort=()=>{finishUser(user,abortError());if(job.users.every(item=>item.done)&&reads.get(signature)===job)reads.delete(signature);};
   job.users.push(user);user.signal?.addEventListener('abort',user.abort,{once:true});
   if(user.signal?.aborted)user.abort();
  });
  drain();return result.then(value=>({...value,request_id:requestData.request_id||value.request_id}));
 }
 function cancelReads(){for(const job of reads.values())cancel(job);}
 return {retain,dispatch,cancelReads,stop(){cancelReads();disposed=true;devices.clear();}};
}
