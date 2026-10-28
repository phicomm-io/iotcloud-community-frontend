import {createDeviceAuth,createDeviceWire} from './deviceAuth.js';

// Each host entry owns its session; replacing/removing an entry retires only it.
export function createDeviceHttpSession({fetcher,origin,expectedIdentity,password='',onRequired}={}){
 const wire=createDeviceWire({fetcher,origin,expectedIdentity});
 const auth=createDeviceAuth({wire,onRequired});
 let pending=null,closed=false;
 const cancelled=()=>new DOMException('Device session closed','AbortError');
 async function ready(signal){
  if(closed||signal?.aborted)throw cancelled();
  let work;
  if(auth.authenticated||auth.needsLogin)work=auth.ensure();
  else work=pending||=(async()=>{await wire.discover({legacyPassword:password});if(closed)throw cancelled();await auth.login(password);})().finally(()=>{pending=null;});
  if(!signal){await work;if(closed)throw cancelled();return;}
  let abort;
  try{await Promise.race([work,new Promise((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);if(closed)throw cancelled();}
  finally{signal.removeEventListener('abort',abort);}
 }
 return {wire,auth,ready,async fetch(path,options={}){await ready(options.signal);return auth.fetch(path,options);},release(){closed=true;return auth.release();}};
}
