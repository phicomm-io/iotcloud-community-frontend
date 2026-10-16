import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadServer,selectNode,scopeKey,sessionToken,apiURL} from './serverConfig.js';
import {rememberLogin,savedPassword,legacyCredentials} from './connectionPreferences.js';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
test('switching nodes isolates sessions and MQTT passwords, including same-origin China',async()=>{
 const old=new Map(['location','fetch','localStorage','sessionStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 try{
  Object.assign(globalThis,{location:{origin:'https://mqtt.fjrcn.cn',hostname:'mqtt.fjrcn.cn',protocol:'https:',reload(){}},fetch:async()=>({ok:false}),localStorage:storage(),sessionStorage:storage()});
  selectNode('china');await loadServer();assert.equal(scopeKey(),'https://mqtt.fjrcn.cn');sessionToken('china-token');rememberLogin('same-user','china-password');
  localStorage.setItem('mqtt_config',JSON.stringify({host:'wss://mqtt.fjrcn.cn/mqtt',username:'china-user',password:'china-secret'}));
  selectNode('us');await loadServer();assert.equal(apiURL('/auth/me'),'https://mqtt.fjrcn.com/api/auth/me');assert.equal(sessionToken(),'');assert.equal(savedPassword('same-user'),'');assert.equal(legacyCredentials(),null);
  sessionToken('us-token');rememberLogin('same-user','us-password');
  selectNode('china');await loadServer();assert.equal(sessionToken(),'china-token');assert.equal(savedPassword('same-user'),'china-password');assert.equal(legacyCredentials().username,'china-user');
  selectNode('us');await loadServer();assert.equal(sessionToken(),'us-token');assert.equal(savedPassword('same-user'),'us-password');
 }finally{for(const [key,descriptor] of old){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
