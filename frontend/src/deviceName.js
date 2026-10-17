// Some firmware reconnects after saving a name, before publishing the receipt.
// Confirm with a fresh read, never with cached/retained state or a repeated write.
export function saveDeviceName(send,device,name,done,{schedule=setTimeout,cancel=clearTimeout}={}){
 let finished=false,timer;
 const expected=name||(['a1','m1'].includes(device.model)?`${device.model.toUpperCase()}-${device.mac.slice(-4).toUpperCase()}`:null);
 function finish(reply){if(finished)return;finished=true;cancel(timer);done(reply);}
 function verify(){
  if(finished)return;
  send({action:'config.get',params:{}},reply=>{
   if(finished)return;
   if(reply.code==='ok'&&expected!==null&&reply.data?.name===expected){finish({code:'ok',data:{name:expected}});return;}
   timer=schedule(verify,1500);
  },device,{timeoutMs:3000});
 }
 // Schedule first so a synchronous offline/error response can cancel it.
 timer=schedule(verify,1500);
 send({action:'config.set',params:{section:'device',values:{name}}},finish,device);
}
