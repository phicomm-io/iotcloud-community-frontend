(()=>{
'use strict';
const {$,h,run}=UI,{t}=I18N;
const metrics=[['pm25','µg/m³'],['co2','ppm'],['temperature','°C'],['humidity','%'],['tvoc','ppb'],['formaldehyde','mg/m³']];
const tiles=Object.fromEntries(metrics.map(([key,unit])=>{const el=SensorUI.tile(key,unit);$('metrics').append(el.card);el.card.hidden=key==='formaldehyde';return [key,el];}));
let snapshot=null,receivedAt=0,status={peers:[]};
function render(s){
 if(snapshot!==s){snapshot=s;receivedAt=performance.now();}
 const elapsed=Math.max(0,performance.now()-receivedAt),grades={};let count=0;
 for(const [key] of metrics){
  const field=s.sensors?.[key],el=tiles[key];el.card.hidden=key==='formaldehyde'&&!field;
  const valid=field?.valid===true&&typeof field.value==='number'&&Number.isFinite(field.value)&&typeof field.age_ms==='number'&&field.age_ms+elapsed<20000;
  grades[key]=SensorUI.reading(el,key,field?.value,valid);if(valid)count++;
  if(key==='co2'&&!valid&&s.co2_warmup_seconds_remaining>elapsed/1000)el.badge.textContent=t('daikin.warmup',{n:Math.ceil(s.co2_warmup_seconds_remaining-elapsed/1000)});
 }
 const ranked=['pm25','formaldehyde','co2'].filter(k=>grades[k]),rank={ok:0,warn:1,bad:2};
 const worst=ranked.reduce((a,k)=>!a||rank[grades[k].cls]>rank[grades[a].cls]?k:a,null),level=worst?grades[worst].cls:'';
 $('verdict').dataset.level=level;
 $('overall').textContent=t(!worst?'m1.no_data':level==='bad'?'m1.v_poor':level==='warn'?'m1.v_fair':'m1.v_good');
 const why=Object.keys(grades).filter(k=>grades[k]&&grades[k].cls!=='ok').map(k=>t('m.'+k)+' '+t(grades[k].key));
 $('overallWhy').textContent=t(!count?'m1.stale_hint':'m1.all_ok');if(why.length)$('overallWhy').textContent=why.join(' · ');
 $('freshDot').className='dot '+(count?'ok live':'bad');$('freshText').textContent=t(count?'m1.updated':'m1.stale',{n:Math.floor(elapsed/1000)});
 $('indicator').checked=!!s.indicator_enabled;
}
function renderPeers(){
 const rows=SensorUI.peers(status),count=(status.peers||[]).filter(p=>p.session_ready).length;
 $('peerCard').replaceChildren(h('div',{class:'card-head'},h('div',{},h('h2',{i18n:'m1.linked'}),h('p',{class:'help',i18n:'m1.linked_desc'})),h('span',{class:'badge'},count+' / '+(status.max_sessions||4))),rows.length?h('div',{class:'list'},rows):h('div',{class:'empty'},t('m1.linked_empty')));
 const page=document.querySelector('[data-settings-page="binding"]');page.replaceChildren(UI.pageHead('nav.permission','m1.perm_lead'),h('section',{class:'card'},...SensorUI.peers(status)),UI.info('m1.perm_hint'));
}
$('indicator').onchange=()=>run($('indicator'),()=>UI.control('indicator.set',{enabled:$('indicator').checked},{indicator_enabled:$('indicator').checked}));
UI.start({model:'DAIKIN BRY88AX151K',kindKey:'daikin.kind',icon:'air',factoryReset:true,mqttHostMax:127,interval:2000,
 otaName:'phicomm_daikin.ota.bin.signed',haHintKey:'daikin.ha',otaHintKey:'daikin.ota',buttonHintKey:'daikin.button',
 groups:[['grp.network',['network','mqtt']],['grp.device',['device','binding']],['grp.system',['firmware','diagnostics','maintenance']]],
 nav:{network:'nav.wifi',mqtt:'nav.mqtt',device:'nav.general',binding:'nav.permission',firmware:'nav.firmware',diagnostics:'nav.diagnostics',maintenance:'nav.maintenance'},
 pages:{device:{},binding:{show:async()=>{status=await api('/binding/status');renderPeers();}}},
 diagGroups:[['diag.g_sensor',['sensors','formaldehyde_present','pm_sensor','hardware_model']]],onStatus:render});
I18N.onChange(()=>{if(snapshot)render(snapshot);renderPeers();});
setInterval(()=>{if(snapshot)render(snapshot);},1000);
(async function poll(){try{if(!document.hidden){status=await api('/binding/status');renderPeers();}}catch{}finally{setTimeout(poll,4000);}})();
renderPeers();
})();
