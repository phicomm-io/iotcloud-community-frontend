/* One active command through body completion; bounded jobs and subscribers.
 * Reads share only an in-flight attempt. A write starts a new read epoch. */
const commandQueue=(()=>{
 let active=null,epoch=0;
 const pending=[],reads=new Set(['status.get','capabilities.get','config.get']);
 const error=(code,message=code)=>Object.assign(Error(message),{code});
 const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,k)=>(o[k]=v[k],o),{}):v);
 function remove(job){const i=pending.indexOf(job);if(i>=0)pending.splice(i,1);}
 function settle(sub,err,data){
  if(sub.done)return;sub.done=true;clearTimeout(sub.timer);sub.signal?.removeEventListener('abort',sub.cancel);
  sub.job.subs.delete(sub);
  if(err)sub.reject(err);else sub.resolve(sub.job.key?JSON.parse(JSON.stringify(data)):data);
 }
 async function pump(){
  if(active||!pending.length)return;
  let index=0;for(let i=1;i<pending.length;i++)if(pending[i].priority<pending[index].priority)index=i;
  const job=active=pending.splice(index,1)[0];job.started=true;
  try{
   const response=await fetch('/api/v1/command',{method:'POST',signal:job.controller.signal,headers:{'Content-Type':'application/json'},body:job.body,cache:'no-store'});
   const reply=await response.json();
   if(!response.ok||!['ok','accepted'].includes(reply.code))throw error(reply.code||'http_error',reply.message||reply.code||('HTTP '+response.status));
   for(const sub of [...job.subs])settle(sub,null,reply.data||{});
  }catch(e){
   if(!e.code)e=Object.assign(error(e.name==='AbortError'?'timeout':'offline',e.message),{unknown:job.write});
   for(const sub of [...job.subs])settle(sub,e);
  }finally{active=null;pump();}
 }
 function cancel(job,sub,code){
  settle(sub,error(code));
  if(!job.subs.size){if(job===active)job.controller.abort();else remove(job);}
 }
 function command(action,params={},options={}){
  if(options.signal?.aborted)return Promise.reject(error('cancelled'));
  const write=!action.endsWith('.get');
  let body,key;
  try{
   const request={action,params};
   if(write)request.request_id=globalThis.crypto?.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
   body=JSON.stringify(request);
   const normalized=action==='status.get'&&Object.keys(params).length===1&&params.view==='full'?{}:params;
   key=reads.has(action)?epoch+':'+action+':'+stable(normalized):null;
  }catch(e){return Promise.reject(e);}
  let job=key&&[active,...pending].find(j=>j&&j.key===key&&!j.controller.signal.aborted&&j.subs.size);
  if(job&&job.subs.size>=16)return Promise.reject(error('queue_full'));
  if(!job){
   if(pending.length>=16||(!write&&pending.length>=12))return Promise.reject(error('queue_full'));
   job={body,key,write,priority:write?0:options.background?2:1,controller:new AbortController(),subs:new Set(),started:false};
   pending.push(job);
   if(write){
    epoch++;globalThis.UI?.invalidateStatus?.({live:!!options.live});
    for(const old of [...pending])if(old!==job&&old.priority===2)for(const sub of [...old.subs])cancel(old,sub,'superseded');
   }
  }else if(!options.background)job.priority=Math.min(job.priority,1);
  const promise=new Promise((resolve,reject)=>{
   const sub={job,resolve,reject,signal:options.signal,done:false};
   sub.cancel=()=>cancel(job,sub,'cancelled');job.subs.add(sub);
   sub.timer=setTimeout(()=>cancel(job,sub,'timeout'),options.timeoutMs??20000);
   sub.signal?.addEventListener('abort',sub.cancel,{once:true});
  });
  pump();return promise;
 }
 command.epoch=()=>epoch;
 command.cancelBackground=()=>{for(const job of [active,...pending])if(job?.priority===2)for(const sub of [...job.subs])cancel(job,sub,'cancelled');};
 return command;
})();
function command(action,params={},options={}){return commandQueue(action,params,options);}
command.epoch=commandQueue.epoch;
command.cancelBackground=commandQueue.cancelBackground;
async function api(path,data){
 if(path==='/status')return command('status.get');
 if(path==='/sensors/average')return command('sensors.average.get');
 if(path==='/power')return command('power.get');
 if(path==='/wifi/scan')return command(data===undefined?'wifi.scan.get':'wifi.scan');
 const domains={'/binding/config':'binding','/binding/status':'binding.status','/binding/probe':'binding.probe','/linkage/config':'linkage','/light/advanced':'light_effect','/sleep/config':'night','/time/config':'time'};
 if(domains[path])return command(domains[path]+(path==='/binding/probe'?'':data===undefined?'.get':'.set'),data||{});
 const direct={'/reboot':'system.reboot','/device/reset':'system.reset','/ota':'ota.start','/childLock':'child_lock.set','/child_lock':'child_lock.set','/led':'indicator.set','/outlet':'outlet.set','/fan':'fan.set','/fan/config':'fan.set','/light':'light.set','/light/config':'light.set'};
 if(direct[path]){if(['/light','/light/config'].includes(path)&&data.brightness!==undefined)data={...data,brightness:Math.round(data.brightness*100/255)};return command(direct[path],data);}
 if(path==='/display/brightness')return command('display.set',{brightness:data.level*25});
 if(path==='/socket'){for(let index=0;index<data.states.length;index++)await command('outlet.set',{index,on:!!data.states[index]});return {};}
 const sections={'/wifi/config':'wifi','/mqtt/config':'mqtt','/bemfa/config':'bemfa','/deviceName':'device','/auth/password':'auth','/socketNames':'socket','/mqtt/report/freq':'report','/power/coefficient':'meter','/ntp/config':'ntp'};
 if(sections[path]){
  let values={...data};
  if(path==='/power/coefficient')values={coefficient_x100:Number(data)};
  if(path==='/mqtt/config'){delete values.topic_mode;delete values.clear_password;if(data.clear_password)values.password='';else if(!values.password)delete values.password;}
  if(path==='/bemfa/config'){delete values.clear_secret;if(data.clear_secret)values.secret_key='';else if(!values.secret_key)delete values.secret_key;}
  if(path==='/wifi/config'){delete values.open_network;if(data.open_network)values.password='';else if(!values.password)delete values.password;}
  return command('config.set',{section:sections[path],values});
 }
 throw Error('不支持的操作');
}
