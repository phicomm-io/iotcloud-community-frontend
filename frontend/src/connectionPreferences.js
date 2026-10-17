// Legacy credentials stay untouched until a successful platform login.
export function legacyCredentials(storage = localStorage) {
 try {
  const value = JSON.parse(storage.getItem('mqtt_config') || 'null');
  if (typeof value?.username !== 'string' || !value.username.trim() || typeof value.password !== 'string' || !value.password) return null;
  // Never prefill a different node with legacy Broker credentials.
  if(globalThis.location?.hostname){
   const host=new URL(scopeKey()).hostname;
   let legacyHost='mqtt.fjrcn.cn';
   try{if(value.host)legacyHost=new URL(value.host).hostname;}catch{return null;}
   if(host!==legacyHost)return null;
  }
  return {username:value.username, password:value.password};
 } catch { return null; }
}
import {scopeKey} from './serverConfig.js';
const key = owner => 'phicomm.connection.' + scopeKey() + ':' + owner;
export function autoConnect(owner, storage = localStorage) {
 try {
  const value = storage.getItem(key(owner));
  return value === null ? storage.getItem('mqtt_auto_connect') !== 'false' : value !== 'false';
 } catch { return true; }
}
export function setAutoConnect(owner, enabled, storage = localStorage) {
 try { storage.setItem(key(owner), String(enabled)); } catch { /* Storage may be disabled. */ }
}
export function rememberLogin(owner, password, storage = localStorage) {
 try { storage.setItem('phicomm.mqtt-login.'+scopeKey(), JSON.stringify({owner,password})); } catch { /* Keep in-memory credentials. */ }
}
export function savedPassword(owner, storage = localStorage) {
 try { const key='phicomm.mqtt-login.'+scopeKey(); let raw=storage.getItem(key); if(!raw && storage===globalThis.localStorage){try{raw=globalThis.sessionStorage?.getItem(key);if(raw)storage.setItem(key,raw);}catch{}} const saved=JSON.parse(raw || 'null'); return saved?.owner===owner && typeof saved.password==='string' ? saved.password : ''; } catch { return ''; }
}
export function forgetLogin(storage = localStorage) {
 const key='phicomm.mqtt-login.'+scopeKey();
 try { storage.removeItem(key); } catch { /* Storage may be disabled. */ }
 try { globalThis.sessionStorage?.removeItem(key); } catch { /* Remove legacy credentials too. */ }
}
