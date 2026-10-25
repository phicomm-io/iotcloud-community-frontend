
import {t} from './i18n.js';
import {hubMode} from './deployment.js';
const key = 'iotcloud.server';
export const nodes = [
 {id:'china',label:t('p.fefdd0fd8715'),apiOrigin:'https://mqtt.fjrcn.cn',mqttWS:'wss://mqtt.fjrcn.cn/mqtt'},
 {id:'us',label:t('p.74b94f25d109'),apiOrigin:'https://mqtt.fjrcn.com',mqttWS:'wss://mqtt.fjrcn.com/mqtt'},
];
export let server = {apiOrigin:'', mqttWS:''};
export function validateServer(value) {
 const result={};
 for(const [key,protocols] of Object.entries({apiOrigin:['https:','http:'],mqttWS:['wss:','ws:']})) {
  const raw=(value[key]||'').trim();
  if(!raw){result[key]='';continue;}
  const url=new URL(raw);
  if(!protocols.includes(url.protocol)||url.username||url.password||url.hash||url.search||(key==='apiOrigin'&&url.pathname!=='/'))throw Error(t('p.89e2c78b36ce'));
  if(location.protocol==='https:'&&['http:','ws:'].includes(url.protocol))throw Error(t('p.aca57fcee314'));
  result[key]=raw.replace(/\/$/,'');
 }
 return result;
}
export async function loadServer() {
 if(hubMode){server={apiOrigin:'',mqttWS:''};return;}
 try {const response=await fetch((import.meta.env?.BASE_URL||'/')+'config.json',{cache:'no-store'});if(response.ok)server=validateServer(await response.json());}catch{}
 try {const saved=localStorage.getItem(key);if(saved)server=validateServer(JSON.parse(saved));}catch{}
}
export function saveServer(value){server=validateServer(value);localStorage.setItem(key,JSON.stringify(server));location.reload();}
export const apiURL=path=>server.apiOrigin+'/api'+path;
export const scopeKey=()=>server.apiOrigin||(globalThis.location?.origin||'local');
export const currentNode=()=>nodes.find(node=>node.apiOrigin===scopeKey())?.id||'custom';
export function selectNode(id){
 const node=nodes.find(node=>node.id===id);
 if(!node)throw Error(t('p.8fe353017507'));
 saveServer({apiOrigin:node.apiOrigin===location.origin?'':node.apiOrigin,mqttWS:node.mqttWS});
}
// Keep sessions across browser restarts; migrate existing tab-only sessions.
export function sessionToken(value) {
 const key='iotcloud.session.'+scopeKey();
 if(value!==undefined){
  for(const name of ['localStorage','sessionStorage'])try{if(value)globalThis[name].setItem(key,value);else globalThis[name].removeItem(key);}catch{}
  return value||'';
 }
 for(const name of ['localStorage','sessionStorage'])try{
  const saved=globalThis[name].getItem(key);
  if(saved){if(name==='sessionStorage')sessionToken(saved);return saved;}
 }catch{}
 return '';
}
