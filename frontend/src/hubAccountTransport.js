import {createDeviceWire} from './deviceWire.js';
import {createDevicePageAuth} from './deviceAuth.js';
import {encodeWire} from './wireCodec.js';

// All hub APIs use the device WebUI session, including the account-shaped
// inventory endpoints. The namespace in /auth/me is a routing identity.
export function createHubAccountTransport({fetcher=globalThis.fetch,origin='',onRequired=()=>{}}={}){
 const wire=createDeviceWire({fetcher,origin,expectedIdentity:{model:'daikin'}});
 const auth=createDevicePageAuth({wire,fetcher,origin,onRequired,allowLegacy:false});
 return {wire,auth,login:password=>auth.login(password),logout:()=>auth.logout(),
  decodeResponse:response=>wire.decodeResponse(response,{allowArray:true}),
  async request(path,{body,headers,...options}={}){
   const value=body===undefined?undefined:typeof body==='string'?JSON.parse(body):body;
   const clean=new Headers(headers);
   for(const name of ['Content-Type','Accept','Authorization'])clean.delete(name);
   if(path==='/api/auth/login'){
    await auth.login(value?.password||'');
    return auth.fetch('/api/auth/me',{headers:Object.fromEntries(clean)});
   }
   if(path==='/api/auth/logout'){
    await auth.logout();
    return new Response(encodeWire({code:'ok'},'msgpack'),{headers:{'Content-Type':'application/msgpack'}});
   }
   return auth.fetch(path,{...options,...(value===undefined?{}:{value}),headers:Object.fromEntries(clean)});
  },
 };
}
