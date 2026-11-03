import {encodeWire,decodeResponse,wireMime} from './wireCodec.js';
export {decodeResponse} from './wireCodec.js';
const failure=(code,status=0)=>Object.assign(Error(code),{code,status});
const canonical=value=>String(value||'').replace(/[:-]/g,'').toLowerCase();
export function fixedDeviceWire({fetcher=globalThis.fetch,origin='',format='json'}={}){
 return {discover:async()=>null,get format(){return format;},get identity(){return null;},headers:()=>({Accept:wireMime(format),'Content-Type':wireMime(format)}),encode:value=>encodeWire(value,format),decodeResponse,
 request(path,{value,beforeSend,...options}={}){beforeSend?.();return fetcher(origin+path,{...options,...(value===undefined?{}:{body:encodeWire(value,format)}),headers:{Accept:wireMime(format),...(value===undefined?{}:{'Content-Type':wireMime(format)}),...options.headers}});}};
}
// A transport is scoped to one origin and one verified device/firmware identity.
// Only public, read-only info discovers the format. Business requests never retry
// in another format after busy, expiration, timeout or an ambiguous write result.
export function createDeviceWire({fetcher=globalThis.fetch,origin='',expectedIdentity={}}={}){
 let format=null,identity=null,pending=null,legacyBasicVerified=false,onIdentityChange=()=>{};
 function validate(data,responseFormat){
  if(!data||typeof data!=='object'||Array.isArray(data)||data.api_version!==1)throw failure('Invalid device discovery');
  const id=canonical(data.device_id),model=data.model;
  if(!/^[a-f0-9]{12}$/.test(id)||!['a1','m1','tc1','daikin','s30-v1b'].includes(model))throw failure('Invalid device identity');
  if(expectedIdentity.device_id&&canonical(expectedIdentity.device_id)!==id||expectedIdentity.mac&&canonical(expectedIdentity.mac)!==id||expectedIdentity.model&&expectedIdentity.model!==model)throw failure('Device identity changed');
  const marked=['wire_version','wire_formats','default_wire_format'].some(key=>Object.hasOwn(data,key));
  let next='json';
  if(marked){
   if(data.wire_version!==1||data.default_wire_format!=='msgpack'||!Array.isArray(data.wire_formats)||!data.wire_formats.includes('msgpack')||typeof data.firmware_version!=='string'||!data.firmware_version||typeof (data.variant||data.firmware_variant)!=='string'||!(data.variant||data.firmware_variant))throw failure('Unsupported device wire contract');
   next='msgpack';
  }else if(responseFormat==='msgpack')throw failure('Missing binary discovery contract');
  return {format:next,identity:{device_id:id,model,firmware_version:data.firmware_version||data.version||'',variant:data.variant||data.firmware_variant||''},data};
 }
 async function discover({signal,force=false,legacyPassword=''}={}){
  if(pending)return pending;if(format&&!force)return identity;
  pending=(async()=>{
   let response=await fetcher(origin+'/api/v1/info',{signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/msgpack, application/json'}});
   let legacyRetry=false;
   if(response.status===401&&legacyPassword){legacyRetry=true;const authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+legacyPassword)));response=await fetcher(origin+'/api/v1/info',{signal,credentials:'omit',redirect:'error',cache:'no-store',headers:{Accept:'application/json',Authorization:authorization}});}
   if(!response.ok)throw failure(response.status===503?'busy':response.status===401?'unauthorized':'HTTP '+response.status,response.status);
   const reply=await decodeResponse(response);
   if(reply?.code!=='ok')throw failure(reply?.code||'Invalid device discovery',response.status);
   const type=response.headers?.get('Content-Type')?.split(';')[0],verified=validate(reply.data,type==='application/msgpack'?'msgpack':'json');
   if(legacyRetry&&(verified.format!=='json'||type==='application/msgpack'))throw failure('Invalid legacy discovery');
   if(identity&&JSON.stringify(identity)!==JSON.stringify(verified.identity))onIdentityChange();
   format=verified.format;legacyBasicVerified=legacyRetry&&format==='json';identity=Object.freeze(verified.identity);return identity;
  })();try{return await pending;}finally{pending=null;}
 }
 return {discover,get legacyBasicVerified(){return legacyBasicVerified;},get format(){return format;},get identity(){return identity;},setOnIdentityChange(callback){onIdentityChange=callback;},headers:()=>({Accept:wireMime(format),'Content-Type':wireMime(format)}),encode(value){if(!format)throw failure('Discovery required');return encodeWire(value,format);},decodeResponse,
 async request(path,{value,beforeSend,...options}={}){await discover({signal:options.signal});beforeSend?.();return fetcher(origin+path,{credentials:'omit',...options,redirect:'error',cache:'no-store',...(value===undefined?{}:{body:encodeWire(value,format)}),headers:{Accept:wireMime(format),...(value===undefined?{}:{'Content-Type':wireMime(format)}),...options.headers}});}};
}

export function verifyCapabilities(data,identity){
 if(!identity||!data||canonical(data.device_id)!==identity.device_id||data.model!==identity.model||data.firmware_version!==identity.firmware_version||(data.variant||data.firmware_variant)!==identity.variant)throw failure('Device capabilities identity changed');
 return data;
}
