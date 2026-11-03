
import {t} from './i18n.js';
import {deviceEntry,normalizeMAC} from './deviceProtocol.js';
import {localAddress,savePreference} from './deviceConnection.js';
import {createDeviceHttpSession} from './deviceHttpSession.js';
export const localScope=()=>location.origin+':local';
export const localListKey='phicomm.local-devices';
// Credentials live only in this page session, never in browser storage.
export const localPasswords=new Map();
export function savedLocalDevices(){try{return JSON.parse(localStorage.getItem(localListKey)||'[]').map(deviceEntry);}catch{return [];}}
export async function connectLocal(raw,password='',fetcher=fetch){
 const address=localAddress(raw);if(!address)throw Error(t('p.ef2b49c5fe84'));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 const session=createDeviceHttpSession({fetcher,origin:address,password});
 try{
  await session.ready(controller.signal);const identity=session.wire.identity;
  const response=await session.fetch('/api/v1/command',{method:'POST',signal:controller.signal,value:{action:'status.get',params:{}}});
  if(!response.ok)throw Error(response.status===401?t('p.87794d0c839a'):t('p.23a84a23f636')+response.status);
  const status=await session.wire.decodeResponse(response);
  if(status.code!=='ok'||normalizeMAC(status.data?.device_id)!==identity.device_id)throw Error(t('p.937d246a8029'));
  const device=deviceEntry({mac:identity.device_id,model:identity.model,version:'v2',firmware_variant:identity.variant});
  const devices=savedLocalDevices().filter(d=>d.mac!==device.mac);devices.push(device);
  savePreference(localScope(),device.mac,{mode:'auto',address});
  localStorage.setItem(localListKey,JSON.stringify(devices));localPasswords.set(device.mac,password);
  return device;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error(t('p.873e919e4fcd'));throw e;}
 finally{clearTimeout(timer);await session.release();}
}
