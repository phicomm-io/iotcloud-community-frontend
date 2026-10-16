const key = 'iotcloud.server';
export let server = {apiOrigin:'', mqttWS:''};
export function validateServer(value) {
 const result={};
 for(const [key,protocols] of Object.entries({apiOrigin:['https:','http:'],mqttWS:['wss:','ws:']})) {
  const raw=(value[key]||'').trim();
  if(!raw){result[key]='';continue;}
  const url=new URL(raw);
  if(!protocols.includes(url.protocol)||url.username||url.password||url.hash||url.search||(key==='apiOrigin'&&url.pathname!=='/'))throw Error('请输入有效的服务器地址');
  if(location.protocol==='https:'&&['http:','ws:'].includes(url.protocol))throw Error('HTTPS 页面需要 HTTPS / WSS 服务器');
  result[key]=raw.replace(/\/$/,'');
 }
 return result;
}
export async function loadServer() {
 try {const response=await fetch(import.meta.env.BASE_URL+'config.json',{cache:'no-store'});if(response.ok)server=validateServer(await response.json());}catch{}
 try {const saved=localStorage.getItem(key);if(saved)server=validateServer(JSON.parse(saved));}catch{}
}
export function saveServer(value){server=validateServer(value);localStorage.setItem(key,JSON.stringify(server));location.reload();}
export const apiURL=path=>server.apiOrigin+'/api'+path;
export const scopeKey=()=>server.apiOrigin||(globalThis.location?.origin||'local');
export function sessionToken(value){const key='iotcloud.session.'+scopeKey();if(value!==undefined){if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);}return sessionStorage.getItem(key)||'';}
