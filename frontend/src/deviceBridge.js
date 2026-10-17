// Device service.js retains its HTTP-shaped API; transport is supplied by host.
(()=>{
 const pending=new Map();
 let activeRead=null;
 function send(id,entry){entry.sent=true;if(entry.read)activeRead=id;parent.postMessage({type:'device-command',id,request:entry.request},parent.location.origin);}
 function nextRead(){
  if(activeRead)return;
  const waiting=[...pending].filter(([,entry])=>entry.read&&!entry.sent);
  const next=waiting.find(([,entry])=>entry.request.action==='status.get')||waiting[0];
  if(next)send(...next);
 }
 function remove(id){const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);entry.cleanup();if(activeRead===id)activeRead=null;}

 window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='device-result')return;
  const entry=pending.get(event.data.id);if(!entry)return;
  remove(event.data.id);
  entry.resolve(new Response(JSON.stringify(event.data.reply),{status:200,headers:{'Content-Type':'application/json'}}));nextRead();
 });
 window.fetch=(url,options={})=>{
  if(url!=='/api/v1/command')return Promise.reject(Error('不支持的操作'));
  return new Promise((resolve,reject)=>{
   const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
   const abort=()=>{remove(id);clearTimeout(timer);cleanup();reject(Error('暂未收到操作回执，请等待状态更新'));nextRead();};
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
