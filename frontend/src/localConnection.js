import {deviceEntry,normalizeMAC} from './deviceProtocol.js';
import {localAddress,basicPassword,savePreference} from './deviceConnection.js';
export const localScope=()=>location.origin+':local';
export const localListKey='phicomm.local-devices';
// Credentials live only in this page session, never in browser storage.
export const localPasswords=new Map();
export function savedLocalDevices(){try{return JSON.parse(localStorage.getItem(localListKey)||'[]').map(deviceEntry);}catch{return [];}}
export async function connectLocal(raw,password='',fetcher=fetch){
 const address=localAddress(raw);if(!address)throw Error('请填写设备内网 IP');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
 try{
  const response=await fetcher(address+'/api/v1/info',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',headers:password?{Authorization:basicPassword(password)}:{}});
  if(response.status===401)throw Error('请检查设备网页管理密码');
  if(!response.ok)throw Error('设备 HTTP '+response.status);
  const info=await response.json(),data=info.data;
  if(info.code!=='ok'||data?.api_version!==1)throw Error('设备固件尚不支持本地直连，请先升级固件');
  const device=deviceEntry({mac:normalizeMAC(data.device_id),model:data.model,version:'v2'});
  const devices=savedLocalDevices().filter(d=>d.mac!==device.mac);devices.push(device);
  savePreference(localScope(),device.mac,{mode:'auto',address});
  localStorage.setItem(localListKey,JSON.stringify(devices));localPasswords.set(device.mac,password);
  return device;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('未能连接设备，请检查 IP、网页密码及浏览器的本地网络访问权限');throw e;}
 finally{clearTimeout(timer);}
}
