import {apiURL,scopeKey} from './serverConfig.js';
const pages=new Set(['/','/login','/register','/guest','/admin','/settings','/guest/settings']);
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
let fallbackVisitor,fallbackSession;
function identity(now){
 try{
  let visitor=localStorage.getItem('phicomm.analytics-visitor.'+scopeKey());
  if(!/^[a-f0-9]{32}$/.test(visitor||'')){visitor=random();localStorage.setItem('phicomm.analytics-visitor.'+scopeKey(),visitor);}
  let session;try{session=JSON.parse(localStorage.getItem('phicomm.analytics-visit.'+scopeKey())||'null');}catch{}
  if(!session||!/^[a-f0-9]{32}$/.test(session.id||'')||now-session.at>1800000)session={id:random()};
  session.at=now;localStorage.setItem('phicomm.analytics-visit.'+scopeKey(),JSON.stringify(session));return {visitor,session:session.id};
 }catch{return {visitor:fallbackVisitor||=(random()),session:fallbackSession||=(random())};}
}
export function track(event,page=location.pathname,model=''){
 if(import.meta.env?.VITE_LOCAL_ONLY==='1'||location.hash?.startsWith('#/local')||!pages.has(page))return;
 try{
  let referrer='';try{referrer=document.referrer?new URL(document.referrer).origin:'';}catch{}
  const data={...identity(Date.now()),event,page,model,referrer,screen:innerWidth<768?'mobile':innerWidth<1200?'tablet':'desktop'};
  // Fire and forget: telemetry can never block login, MQTT or device controls.
  fetch(apiURL('/analytics/event'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true}).catch(()=>{});
 }catch{ /* Analytics unavailable; normal application behavior continues. */ }
}
