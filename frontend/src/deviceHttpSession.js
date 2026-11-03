import {createDeviceAuth,createDeviceWire} from './deviceAuth.js';

// Each host entry owns its session; replacing/removing an entry retires only it.
export function createDeviceHttpSession({fetcher,origin,expectedIdentity,password='',onRequired,discoveryTimeout=5000}={}){
 const wire=createDeviceWire({fetcher,origin,expectedIdentity});
 const auth=createDeviceAuth({wire,onRequired});
 let pending=null,closed=false,discovery=null;
 const cancelled=()=>new DOMException('Device session closed','AbortError');
 async function ready(signal){
  if(closed||signal?.aborted)throw cancelled();
  let work;
  if(auth.authenticated||auth.needsLogin)work=auth.ensure();
  else work=pending||=(async()=>{
   // Discovery belongs to the session, not to any one waiting request. A
   // subscriber can leave without killing peers, but discovery cannot hang.
   const controller=new AbortController();discovery=controller;
   const timer=setTimeout(()=>controller.abort(),discoveryTimeout);
   try{await wire.discover({legacyPassword:password,signal:controller.signal});}
   finally{clearTimeout(timer);if(discovery===controller)discovery=null;}
   if(closed)throw cancelled();await auth.login(password);
  })().finally(()=>{pending=null;});
  if(!signal){await work;if(closed)throw cancelled();return;}
  let abort;
  try{await Promise.race([work,new Promise((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);if(closed)throw cancelled();}
  finally{signal.removeEventListener('abort',abort);}
 }
 return {wire,auth,ready,async fetch(path,options={}){await ready(options.signal);if(closed||options.signal?.aborted)throw cancelled();return auth.fetch(path,options);},release(){closed=true;discovery?.abort();return auth.release();}};
}
