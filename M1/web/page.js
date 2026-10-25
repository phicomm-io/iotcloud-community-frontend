/* M1 air quality monitor page. The monitor only reports readings and answers
 * link requests from an A1; linkage rules live on the A1. */
(()=>{
'use strict';
const {t}=I18N;
const {$,h,icon,toast,run,confirm,summary,card,info,pageHead,seg,prettyMac,normalizeMac,clone}=UI;
const METRICS=['pm25','formaldehyde','temperature','humidity'];
const STALE_MS=15000;
const PRESSURE_STALE_MS=10000;
let bindingStatus={peers:[]};
let pressureSnapshot=null,pressureReceivedAt=0;

function renderPressure(){
 const b=pressureSnapshot;
 const fresh=b?.ready===true&&b.valid===true&&['BMP388','BMP390'].includes(b.model)&&
  typeof b.pressure_hpa==='number'&&Number.isFinite(b.pressure_hpa)&&b.pressure_hpa>=300&&b.pressure_hpa<=1250&&
  typeof b.age_ms==='number'&&Number.isFinite(b.age_ms)&&b.age_ms>=0&&
  b.age_ms+Math.max(0,performance.now()-pressureReceivedAt)<PRESSURE_STALE_MS;
 $('pressureReading').hidden=!fresh;
 $('pressureValue').textContent=fresh?b.pressure_hpa.toFixed(1):'';
 $('pressureModel').textContent=fresh?b.model:'';
 if(fresh)$('pressureReading').title=b.model;
 else $('pressureReading').removeAttribute('title');
}
// Expire this optional reading even if status polling stops succeeding.
// Browsers pause timers in the back/forward cache and resume them on restore.
// Keep this timer, and expire immediately on pageshow even if polling fails.
setInterval(renderPressure,1000);
window.addEventListener('pageshow',renderPressure);

/* ---------- Home: readings ---------- */
const tiles={};
$('metrics').append(...METRICS.map(k=>{const el=SensorUI.tile(k,UI.AIR[k].unit);tiles[k]=el;return el.card;}));
// A serial number proves identification; bus initialization alone does not.
let lastCo2=null,lastCo2Serial='';
const co2Scale=h('div');
const co2Badge=h('span',{class:'badge'});
const co2Value=h('span',{class:'num',id:'co2Value'},'—');
const co2Card=h('section',{class:'card metric',id:'co2Card'},
 h('div',{class:'metric-head'},h('div',{class:'label','data-i18n':'m.co2'},t('m.co2')),co2Badge),
 h('div',{class:'stat'},co2Value,h('small',{},UI.AIR.co2.unit)),co2Scale);
co2Card.hidden=true;
$('metrics').append(co2Card);
const screen=seg([[0,'state.off'],[1,'1'],[2,'2'],[3,'3'],[4,'4']],v=>run(null,()=>UI.control('display.set',{brightness:v*25},{brightness_requested:v}),'toast.accepted'),{full:true,aria:t('m1.screen')});
screen.dataset.control='brightness';
$('screenSeg').replaceWith(screen);
// Only show screen configuration after both controller and module detection.
const co2Display=h('section',{class:'card stack',id:'co2DisplayConfig'});
co2Display.hidden=true;
const displayMode=h('select',{id:'co2DisplayMode'},...[['0','co2screen.none'],['1','co2screen.replace'],['2','co2screen.alternate']].map(([value,key])=>h('option',{value,i18n:key})));
const displaySlot=h('select',{id:'co2DisplaySlot'},h('option',{value:'0',i18n:'m.formaldehyde'}),h('option',{value:'1',i18n:'m.pm25'}));
const displayInterval=h('input',{id:'co2DisplayInterval',type:'number',min:1,max:3600,step:1,value:5});
const displayLow=h('input',{id:'co2DisplayLow',type:'number',min:0,max:65535,step:1,value:1000});
const displayHigh=h('input',{id:'co2DisplayHigh',type:'number',min:0,max:65535,step:1,value:1500});
let screenConfig=null,screenEditing=false;
const screenForm=h('form',{class:'stack'},
 ...[[displayMode,'co2screen.mode'],[displaySlot,'co2screen.slot'],[displayInterval,'co2screen.interval'],[displayLow,'co2screen.low'],[displayHigh,'co2screen.high']].map(([input,key])=>h('label',{class:'field'},h('span',{i18n:key}),input)),
 h('button',{class:'btn primary',type:'submit',i18n:'common.save'}));
screenForm.addEventListener('input',()=>{screenEditing=true;});
UI.onSubmit(screenForm,async()=>{
 if(!screenConfig)throw Error(t('co2screen.unavailable'));
 const values=[displayMode,displaySlot,displayInterval,displayLow,displayHigh].map(el=>Number(el.value));
 if(!values.every(Number.isInteger)||values[2]<1||values[2]>3600||values[3]<0||values[4]>65535||values[3]>values[4])throw Error(t('co2screen.invalid'));
 await UI.control('co2_display.set',{mode:values[0],slot:values[1],interval_seconds:values[2],low:values[3],high:values[4],revision:screenConfig.revision});
 screenEditing=false;
},'toast.accepted');
co2Display.append(h('h2',{i18n:'co2screen.title'}),h('p',{class:'help',i18n:'co2screen.help'}),screenForm);
document.querySelector('[data-settings-page="device"]').append(co2Display);
const RANK={ok:0,warn:1,bad:2};
function renderHome(s){
 // Optimistic controls and their final render reuse the same measurement.
 // Only a newly decoded status object starts a new receipt-time age origin.
 if(pressureSnapshot!==s.barometer){
  pressureSnapshot=s.barometer;
  pressureReceivedAt=performance.now();
 }
 renderPressure();
 const config=s.co2_display;
 co2Display.hidden=!(config?.available===true&&config.mcu_supported===true&&config.module_present===true&&s.scd40?.serial);
 if(!co2Display.hidden){
  screenConfig=config;
  if(!screenEditing){displayMode.value=String(config.mode);displaySlot.value=String(config.slot);displayInterval.value=config.interval_seconds;displayLow.value=config.low;displayHigh.value=config.high;}
 }
 const co2=s.scd40;
 if(co2?.serial&&co2.serial!==lastCo2Serial){lastCo2=null;lastCo2Serial=co2.serial;}
 const co2Fresh=co2?.ready&&co2.valid&&Number.isFinite(co2.age_ms)&&co2.age_ms<20000&&
  typeof co2.co2_ppm==='number'&&Number.isFinite(co2.co2_ppm)&&co2.co2_ppm>0;
 if(co2Fresh)lastCo2=Math.round(co2.co2_ppm);
 co2Card.hidden=lastCo2===null;
 $('metrics').classList.toggle('with-co2',!co2Card.hidden);
 co2Value.textContent=lastCo2===null?'—':String(lastCo2);
 co2Value.style.color=co2Fresh?'':'var(--muted)';
 const co2Grade=lastCo2===null?null:UI.grade('co2',lastCo2);
 co2Badge.className='badge '+(co2Fresh?co2Grade.cls:'');
 co2Badge.textContent=co2Fresh?t(co2Grade.key):lastCo2!==null?t('m.co2_stale'):'';
 co2Scale.replaceChildren(UI.airScale('co2',lastCo2??0));
 co2Scale.classList.toggle('co2-stale',!co2Fresh);
 co2Scale.classList.toggle('co2-empty',lastCo2===null);
 co2Scale.title=t('m.co2_range');
 co2Scale.setAttribute('aria-label',t('m.co2_range'));

 const stale=!s.sensor_valid||s.age_ms>STALE_MS;
 const fmt={pm25:v=>String(Math.round(v)),formaldehyde:v=>v.toFixed(3),temperature:v=>v.toFixed(1),humidity:v=>v.toFixed(0)};
 const grades={};
 for(const k of METRICS){const g=UI.grade(k,s[k]);grades[k]=g;const el=tiles[k];
  el.value.textContent=s.sensor_received&&typeof s[k]==='number'&&Number.isFinite(s[k])?fmt[k](s[k]):'—';
  el.badge.className='badge '+(stale?'':g.cls);el.badge.textContent=t(g.key);
  el.scale.replaceChildren(UI.airScale(k,s[k]));}
 // Overall verdict comes from the pollutants; comfort only adds a remark.
 const worst=['pm25','formaldehyde'].reduce((a,k)=>RANK[grades[k].cls]>RANK[grades[a].cls]?k:a,'pm25');
 const v=$('verdict');v.dataset.level=stale?'':grades[worst].cls;
 const both=g=>grades[g].cls==='ok';
 $('overall').textContent=stale?t('m1.no_data'):t(both('pm25')&&both('formaldehyde')?(grades.pm25.key.endsWith('excellent')?'m1.v_excellent':'m1.v_good'):grades[worst].cls==='warn'?'m1.v_fair':'m1.v_poor');
 const why=METRICS.filter(k=>grades[k].cls!=='ok').map(k=>t('m.'+k)+' '+t(grades[k].key));
 $('overallWhy').textContent=stale?t('m1.stale_hint'):why.length?why.join(' · '):t('m1.all_ok');
 $('freshDot').className='dot '+(stale?'bad':'ok live');
 $('freshText').textContent=stale?t('m1.stale'):t('m1.updated',{n:Math.max(0,Math.round(s.age_ms/1000))});
 if(document.activeElement&&document.activeElement.parentNode!==screen)screen.set(s.brightness_requested);
}
function peerSessionRows(){
 return SensorUI.peers(bindingStatus);
}
function renderPeers(){
 const rows=peerSessionRows(),capacity=Number(bindingStatus.max_sessions)||4;
 const head=h('div',{class:'card-head'},h('div',{},h('h2',{i18n:'m1.linked'}),h('p',{class:'help',i18n:'m1.linked_desc'})),
  h('span',{class:'badge '+(rows.length?'ok':'')},rows.length+' / '+capacity));
 $('peerCard').replaceChildren(head,rows.length?h('div',{class:'list'},rows):h('div',{class:'empty'},t('m1.linked_empty')));
}
/* Session status is read-only; sources are configured on each A1. */
async function showBinding(){
 bindingStatus=await api('/binding/status');renderPeers();
 const rows=peerSessionRows(),capacity=Number(bindingStatus.max_sessions)||4;
 document.querySelector('[data-settings-page="binding"]').replaceChildren(pageHead('nav.permission','m1.perm_lead'),
  h('section',{class:'card'},h('div',{class:'card-head'},h('h2',{i18n:'m1.linked'}),h('span',{class:'badge'},rows.length+' / '+capacity)),
   rows.length?h('div',{class:'list'},rows):h('div',{class:'empty'},t('m1.linked_empty')),info('m1.perm_hint')));
}

/* The device schedules and repeats beeps independently of this page. */
let wakeStatus=null,wakeReadAt=0,wakePending=false,wakeReadPending=false,wakeLastPoll=0,wakeGeneration=0;
function renderWakeAlarm(){
 const box=$('wakeAlarmCard');if(!box)return;
 const remaining=wakeStatus?.active?Math.max(0,Math.ceil(wakeStatus.remaining_seconds-(Date.now()-wakeReadAt)/1000)):0;
 $('wakeAlarmState').textContent=wakeStatus===null?t('wake.unknown'):remaining?t('wake.ringing',{n:remaining}):t('wake.idle');
 box.classList.toggle('warn',remaining>0);
 $('wakeAlarmStop').disabled=wakePending;
 const s=UI.state||{};$('wakeAlarmPreview').disabled=wakePending||remaining>0||!!(s.ota_active||s.reboot_pending||s.wifi_trial_active);
}
async function pollWakeAlarm(force=false){
 if(!$('wakeAlarmCard')||wakeReadPending||wakePending||(!force&&(document.hidden||Date.now()-wakeLastPoll<4000)))return;
 wakeReadPending=true;wakeLastPoll=Date.now();const generation=wakeGeneration;
 try{const state=await command('wake_alarm.get');if(generation===wakeGeneration){wakeStatus=state;wakeReadAt=Date.now();}}
 catch{if(generation===wakeGeneration)wakeStatus=null;}
 finally{wakeReadPending=false;renderWakeAlarm();}
}
function installWakeAlarm(){
 if($('wakeAlarmCard'))return;
 async function control(action,params={}){
  if(wakePending)return;wakePending=true;wakeGeneration++;renderWakeAlarm();
  try{wakeStatus=await command(action,params);wakeReadAt=Date.now();}
  finally{wakePending=false;renderWakeAlarm();}
 }
 const box=h('section',{class:'card stack',id:'wakeAlarmCard'},h('h2',{i18n:'wake.title'}),
  h('p',{id:'wakeAlarmState',role:'status'}),info('wake.home_hint'),
  h('div',{class:'form-actions'},h('button',{id:'wakeAlarmStop',type:'button',class:'btn',i18n:'wake.stop',onclick:()=>run(null,()=>control('wake_alarm.stop'),null)}),
   h('button',{id:'wakeAlarmPreview',type:'button',class:'btn ghost',i18n:'wake.preview',onclick:()=>run(null,()=>control('wake_alarm.start',{duration_seconds:3}),null)})));
 $('metrics').after(box);renderWakeAlarm();pollWakeAlarm(true);
}
setInterval(()=>{renderWakeAlarm();pollWakeAlarm();},1000);

/* ---------- Boot ---------- */
const clock=UI.clockCard({
 load:async()=>UI.state||await api('/status'),
 save:async v=>{
  const s=UI.state;
  if(v.timezone_minutes!==s.timezone_minutes)await api('/time/config',{timezone_minutes:v.timezone_minutes});
  if(v.ntp_host!==s.ntp_host)await api('/ntp/config',{ntp_host:v.ntp_host});
 },
 status:s=>[['clock.synced',t('s.'+(s.ntp_status||'syncing')),s.ntp_synced?'ok':'warn'],
  ['clock.tz',UI.tzLabel(s.timezone_minutes||0)],['clock.ntp',s.ntp_host||'—'],
  ['clock.last',s.ntp_last_success?new Date(s.ntp_last_success*1000).toLocaleString(I18N.lang):'—']]});
$('clockCard').replaceWith(clock.el);

UI.start({
 capabilities(caps){if(caps.actions?.includes("wake_alarm.start")&&caps.actions.includes("wake_alarm.get")&&caps.actions.includes("wake_alarm.stop")){this.nav.schedule="wake.schedules";this.scheduleLead="wake.lead";installWakeAlarm();}},
 model:'M1',kindKey:'kind.m1',icon:'air',mqttHostMax:127,factoryReset:true,
 otaName:'phicomm_m1.ota.bin.signed',haHintKey:'mqtt.ha_m1',otaHintKey:'fw.hint_m1',buttonHintKey:'sys.hint_m1',
 scheduleLead:'sch.lead_a1',interval:1000,
 groups:[['grp.network',['network','mqtt']],['grp.device',['device']],['grp.auto',['binding','schedule','night']],['grp.system',['firmware','diagnostics','logs','maintenance']]],
 nav:{network:'nav.wifi',mqtt:'nav.mqtt',device:'nav.general',binding:'nav.permission',schedule:'nav.schedule',night:'nav.sleep',firmware:'nav.firmware',diagnostics:'nav.diagnostics',logs:'nav.logs',maintenance:'nav.maintenance'},
 pages:{device:{show:clock.show,status:clock.status},binding:{show:showBinding}},
 diagGroups:[['diag.g_sensor',['uart_ready','sensor_valid','sensor_received','age_ms','temperature','humidity','formaldehyde','pm25','rx_frames','unknown_frames','uart_errors','discarded_bytes','last_frame']],
  ['diag.g_clock',['timezone_minutes','ntp_host','ntp_status','ntp_server','ntp_synced','ntp_screen_queued','ntp_last_success','ntp_next_seconds']],
  ['diag.g_screen',['brightness_requested']],
  ['diag.g_ota_img',['ota_signature_verified','ota_image_verified','ota_key_id','ota_image_length','ota_release_counter','ota_version']]],
 healthChecks:s=>[['diag.c_sensor',s.uart_ready&&s.sensor_valid?'ok':'bad',s.uart_errors?t('diag.errors',{n:s.uart_errors}):t(s.sensor_valid?'state.ok':'m1.no_data')],
  ['diag.c_clock',s.ntp_synced?'ok':'warn',t('s.'+(s.ntp_status||'syncing'))]],
 onStatus:s=>{renderHome(s);renderWakeAlarm();pollWakeAlarm();}
});
I18N.onChange(()=>{renderPeers();const p=document.querySelector('[data-settings-page="binding"]');if(p&&!p.hidden)showBinding();});
// The linked list is small and changes rarely; refresh it with the status.
(async function poll(){try{if(document.hidden||($('homePage').hidden&&UI.activePage()!=='binding'&&UI.activePage()!=='linkage'))return;bindingStatus=await api('/binding/status');renderPeers();}catch{}finally{setTimeout(poll,4000);}})();
renderPeers();
})();
