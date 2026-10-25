
import {t} from './i18n.js';
import {deviceEntry,normalizeMAC} from './deviceProtocol.js';
import {localAddress,basicPassword,savePreference} from './deviceConnection.js';
export const localScope=()=>location.origin+':local';
export const localListKey='phicomm.local-devices';
// Credentials live only in this page session, never in browser storage.
export const localPasswords=new Map();
export function savedLocalDevices(){try{return JSON.parse(localStorage.getItem(localListKey)||'[]').map(deviceEntry);}catch{return [];}}
export async function connectLocal(raw,password='',fetcher=fetch){
 const address=localAddress(raw);if(!address)throw Error(t('p.ef2b49c5fe84'));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
 try{
  const response=await fetcher(address+'/api/v1/info',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:password?{Authorization:basicPassword(password)}:{}});
  if(response.status===401)throw Error(t('p.87794d0c839a'));
  if(!response.ok)throw Error(t('p.23a84a23f636')+response.status);
  const info=await response.json(),data=info.data;
  if(info.code!=='ok'||data?.api_version!==1)throw Error(t('p.937d246a8029'));
  const device=deviceEntry({mac:normalizeMAC(data.device_id),model:data.model,version:'v2'});
  const devices=savedLocalDevices().filter(d=>d.mac!==device.mac);devices.push(device);
  savePreference(localScope(),device.mac,{mode:'auto',address});
  localStorage.setItem(localListKey,JSON.stringify(devices));localPasswords.set(device.mac,password);
  return device;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error(t('p.873e919e4fcd'));throw e;}
 finally{clearTimeout(timer);}
}
