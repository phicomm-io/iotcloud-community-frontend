

// Device service.js retains its HTTP-shaped API; transport is supplied by host.
(()=>{
window.deviceParentTransport=true;
const bridgeMessages={"p.f9ce625a07fc": ["No receipt yet. Wait for a status update.", "暂未收到操作回执，请等待状态更新"], "p.85dade959621": ["Unsupported operation", "不支持的操作"], "p.bcce0d150ca6": ["Unsupported upload", "不支持的上传"]};
const t=(id,args={})=>{if(globalThis.I18N){I18N.extend(bridgeMessages);return I18N.t(id,args);}return bridgeMessages[id][1].replace(/\{(\w+)\}/g,(_,key)=>args[key]??'');};

 const pending=new Map();
 const sourceReads=new Map();
 window.getDeviceSensorSources=kind=>new Promise(resolve=>{
  const id=crypto.randomUUID(),timer=setTimeout(()=>{sourceReads.delete(id);resolve([]);},5000);
  sourceReads.set(id,{resolve,timer});parent.postMessage({type:'device-sensor-sources',id,kind:kind==='display'?'display':'co2'},parent.location.origin);
 });
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==parent.location.origin||event.data?.type!=='device-sensor-sources-result')return;
  const entry=sourceReads.get(event.data.id);if(!entry)return;
  sourceReads.delete(event.data.id);clearTimeout(entry.timer);entry.resolve(Array.isArray(event.data.sources)?event.data.sources:[]);
 });
 window.addEventListener('pagehide',()=>{for(const {resolve,timer} of sourceReads.values()){clearTimeout(timer);resolve([]);}sourceReads.clear();});
 let activeRead=null;
 function send(id,entry){entry.sent=true;if(entry.read)activeRead=id;parent.postMessage({type:'device-command',id,request:entry.request},parent.location.origin);}
 function nextRead(){
  if(activeRead)return;
  const waiting=[...pending].filter(([,entry])=>entry.read&&!entry.sent);
  const next=waiting.find(([,entry])=>entry.request.action==='status.get')||waiting[0];
  if(next)send(...next);
 }
 function remove(id){const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);entry.cleanup();if(activeRead===id)activeRead=null;}
 function cancelRead(id){const entry=pending.get(id);if(entry?.read&&entry.sent)parent.postMessage({type:'device-command-cancel',id},parent.location.origin);}

 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==parent.location.origin||event.data?.type!=='device-result')return;
  const entry=pending.get(event.data.id);if(!entry)return;
  remove(event.data.id);
  entry.resolve(new Response(JSON.stringify(event.data.reply),{status:200,headers:{'Content-Type':'application/json'}}));nextRead();
 });
 const nativeFetch=window.fetch?.bind(window),resources=new Map();
 function finishResource(id,error,result){
  const entry=resources.get(id);if(!entry)return;
  resources.delete(id);clearTimeout(entry.timer);entry.cleanup();
  if(error)entry.reject(error);else entry.resolve(new Response(result.bytes,{status:result.status}));
 }
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==parent.location.origin||event.data?.type!=='device-resource-result')return;
  finishResource(event.data.id,event.data.error?Error(event.data.error):null,event.data);
 });
 window.addEventListener('pagehide',()=>{for(const id of resources.keys())finishResource(id,Error('Cancelled'));for(const id of pending.keys()){const entry=pending.get(id);cancelRead(id);remove(id);entry.resolve(new Response(JSON.stringify({code:'cancelled'}),{status:200}));}});
 window.fetch=(url,options={})=>{
  if(['/api/v1/config/backup','/api/v1/config/restore'].includes(url))return new Promise((resolve,reject)=>{
   if(options.signal?.aborted){reject(Error('Cancelled'));return;}
   const id=crypto.randomUUID(),abort=()=>finishResource(id,Error('Cancelled')),timer=setTimeout(()=>finishResource(id,Error('Timeout')),24000);
   resources.set(id,{resolve,reject,timer,cleanup:()=>options.signal?.removeEventListener('abort',abort)});
   options.signal?.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>options.body instanceof Blob?options.body.arrayBuffer():options.body).then(body=>{if(resources.has(id))parent.postMessage({type:'device-resource',id,path:url,method:options.method||'GET',body},parent.location.origin);}).catch(error=>finishResource(id,error));
  });
  if(typeof url==='string'&&url.startsWith('https://'))return nativeFetch?nativeFetch(url,{...options,credentials:'omit',headers:{},redirect:'error'}):Promise.reject(Error('Network'));
  if(url!=='/api/v1/command')return Promise.reject(Error(t('p.85dade959621')));
  return new Promise((resolve,reject)=>{
   const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
   const abort=()=>{cancelRead(id);remove(id);clearTimeout(timer);cleanup();reject(Error(t('p.f9ce625a07fc')));nextRead();};
   const cleanup=()=>options.signal?.removeEventListener('abort',abort);
   const timer=setTimeout(abort,24000);
   if(options.signal?.aborted){abort();return;}
   options.signal?.addEventListener('abort',abort,{once:true});
   const request=JSON.parse(options.body),entry={resolve,timer,cleanup,request,read:request.action.endsWith('.get'),sent:false};
   pending.set(id,entry);
   if(entry.read)nextRead();else send(id,entry);
  });
 };
})();
window.addEventListener('storage',event=>{
 if(event.key!=='phicomm.appearance')return;
 if(event.newValue==='system'||!event.newValue)delete document.documentElement.dataset.theme;
 else document.documentElement.dataset.theme=event.newValue;
});
// Only the host can choose the authenticated device URL. Never upload to cloud.
(()=>{
 const uploads=new Map();
 window.createDeviceUpload=()=>{
  const id=crypto.randomUUID(),headers={},unsupported=()=>Error(globalThis.I18N?.t('p.bcce0d150ca6')||'Unsupported upload');
  const xhr={upload:{},status:0,responseText:'',timeout:310000,
   setRequestHeader(name,value){headers[String(name).toLowerCase()]=String(value);},
   open(method,path){if(method!=='POST'||!['/api/v1/ota/upload','/api/v1/ota/upload-unsigned','/api/v1/ota/convert'].includes(path))throw unsupported();this.rescue=path.endsWith('-unsigned');this.convert=path==='/api/v1/ota/convert';},
   send(file){
    if(this.convert&&(headers['x-iotcloud-target-variant']!=='hub'||headers['x-iotcloud-confirm']!=='full-to-hub'))throw unsupported();
    uploads.set(id,this);parent.postMessage({type:'device-upload',id,file,rescue:!!this.rescue,...(this.convert?{target:{variant:'hub',confirm:'full-to-hub'}}:{})},parent.location.origin);
   },
   abort(){parent.postMessage({type:'device-upload-abort',id},parent.location.origin);uploads.delete(id);this.onabort?.();this.onloadend?.();}};return xhr;
 };
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==parent.location.origin)return;
  const xhr=uploads.get(event.data?.id);if(!xhr)return;
  if(event.data.type==='device-upload-progress'){xhr.upload.onprogress?.({lengthComputable:true,loaded:event.data.loaded,total:event.data.total});}
  else if(event.data.type==='device-upload-result'){uploads.delete(event.data.id);xhr.status=event.data.result.status;xhr.responseText=event.data.result.text;xhr.onload?.();xhr.onloadend?.();}
 });
 window.addEventListener('pagehide',()=>{for(const xhr of uploads.values())xhr.abort();});
})();
