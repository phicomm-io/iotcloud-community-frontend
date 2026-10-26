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
setInterval(()=>{renderPressure();renderWakeAlarm();pollWakeAlarm();renderParticles();pollParticles();},1000);
window.addEventListener('pageshow',renderPressure);

/* Independent particle snapshot: keep PM2.5 in the primary readings. */
let particleData=null,particleAt=0,particlePollAt=-Infinity,particlePending=false,particleEnabled=false;
const particleRows=[];
function particleGroup(parent,group,keys,unit){
 const list=h('dl',{class:'particle-grid'});
 for(const [key,label] of keys){const value=h('span',{},'—');
  list.append(h('div',{},h('dt',{},label),h('dd',{},value,...(group==='particles_per_0_1_l'?[]:[h('small',{},unit)]))));
  particleRows.push({group,key,value});}
 parent.append(list);
}
const particleCard=h('section',{class:'card stack',id:'particleCard'},
 h('div',{class:'card-head'},h('h2',{i18n:'particles.title'}),h('span',{class:'badge',id:'particleState',role:'status'})));
particleCard.hidden=true;
particleGroup(particleCard,'atmospheric_ug_m3',[['pm1','PM1.0'],['pm10','PM10']],'µg/m³');
particleCard.append(h('p',{class:'help',i18n:'particles.counts'}));
particleGroup(particleCard,'particles_per_0_1_l',['0_3','0_5','1_0','2_5','5_0','10_0'].map(k=>['gt_'+k,'> '+k.replace('_','.')+' µm']),'');
const cf=h('details',{},h('summary',{i18n:'particles.cf1'}));
particleGroup(cf,'cf1_ug_m3',[['pm1','PM1.0'],['pm10','PM10']],'µg/m³');particleCard.append(cf);
const raw=h('pre',{class:'particle-raw',id:'particleRaw'});
particleCard.append(h('details',{},h('summary',{i18n:'particles.diagnostics'}),raw));
$('metrics').after(particleCard);
function renderParticles(){
 const d=particleData;
 particleCard.hidden=!particleEnabled||d?.supported===false;
 const valid=d?.supported!==false&&d?.available===true&&d.fresh===true&&d.healthy===true&&
  Number.isFinite(d.age_ms)&&d.age_ms>=0&&d.age_ms+Math.max(0,performance.now()-particleAt)<6000;
 $('particleState').textContent=t(valid?'state.ok':'particles.unavailable');
 for(const row of particleRows){const n=d?.pm?.[row.group]?.[row.key];
  row.value.textContent=valid&&Number.isInteger(n)&&n>=0&&n<=65535?String(n):'—';}
 raw.textContent=d?.diagnostics?JSON.stringify(d.diagnostics,null,2):'—';
}
async function pollParticles(){
 if(!particleEnabled||particlePending||document.hidden||$('homePage').hidden||performance.now()-particlePollAt<2000)return;
 particlePending=true;particlePollAt=performance.now();
 try{particleData=await command('sensor_details.get');particleAt=performance.now();}
 catch{particleData=null;}
 finally{particlePending=false;renderParticles();}
}

window.addEventListener('pageshow',()=>{renderParticles();pollParticles();});
I18N.onChange(renderParticles);

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
 const params={mode:values[0],slot:values[1],interval_seconds:values[2],low:values[3],high:values[4],revision:screenConfig.revision};
 await command('co2_display.set',params);
 const confirmed=await command('co2_display.get');
 if(!confirmed||typeof confirmed!=='object'||Array.isArray(confirmed)||!Number.isInteger(confirmed.revision)||confirmed.revision<=params.revision||
    !['mode','slot','interval_seconds','low','high'].every(key=>confirmed[key]===params[key]))throw Error(t('control.unconfirmed'));
 screenConfig=confirmed;screenEditing=false;
 UI.device.onStatus?.(UI.acceptStatus({co2_display:confirmed},true));
},'toast.accepted');
co2Display.append(h('h2',{i18n:'co2screen.title'}),h('p',{class:'help',i18n:'co2screen.help'}),screenForm);
document.querySelector('[data-settings-page="device"]').append(co2Display);
let sourceConfig=null,sourcePending=false,sourceEditing=false,sourceRead=0;
const sourceMode=h('select',{id:'co2SourceMode'},h('option',{value:'local',i18n:'co2source.local'}),h('option',{value:'mqtt',i18n:'co2source.mqtt'}));
const sourceID=h('input',{id:'co2SourceID',maxlength:17,pattern:'[0-9a-fA-F]{12}|[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}',autocomplete:'off'});
sourceID.setAttribute('list','co2SourceCandidates');
const sourceCandidates=h('datalist',{id:'co2SourceCandidates'});
const doubleClick=h('select',{id:'co2DoubleClick'},h('option',{value:'none',i18n:'co2source.no_action'}),h('option',{value:'switch_display',i18n:'co2source.switch'}));
const sourceHint=h('p',{class:'help'});
const sourceForm=h('form',{class:'stack'},
 h('label',{class:'field'},h('span',{i18n:'co2source.source'}),sourceMode),
 h('label',{class:'field'},h('span',{i18n:'co2source.id'}),sourceID,sourceCandidates),
 h('label',{class:'field'},h('span',{i18n:'co2source.double_click'}),doubleClick),sourceHint,
 h('button',{class:'btn primary',type:'submit',i18n:'common.save'}));
const sourceCard=h('section',{class:'card stack',id:'co2SourceConfig',hidden:true},h('h2',{i18n:'co2source.title'}),info('co2source.help'),sourceForm);
document.querySelector('[data-settings-page="device"]').append(sourceCard);
function renderSource(){
 sourceMode.disabled=sourcePending;
 sourceID.disabled=sourceMode.value!=='mqtt'||sourcePending;
 sourceID.required=sourceMode.value==='mqtt';
 doubleClick.disabled=sourcePending||sourceConfig?.button_events_supported!==true;
 sourceHint.textContent=t(sourceConfig?.button_events_supported?'co2source.button_hint':'co2source.button_upgrade');
}
sourceMode.addEventListener('change',renderSource);
sourceForm.addEventListener('input',()=>{sourceEditing=true;});
function validCo2Source(config){
 if(!config||typeof config!=='object'||Array.isArray(config)||!['local','mqtt'].includes(config.source)||
    typeof config.device_id!=='string'||(config.source==='local'?config.device_id!=='':!/^[0-9a-f]{12}$/.test(config.device_id))||
    !['none','switch_display'].includes(config.double_click)||!Number.isInteger(config.revision)||config.revision<0||typeof config.button_events_supported!=='boolean')throw Error(t('control.unconfirmed'));
 return config;
}
async function loadCo2Source(){
 if(sourceCard.hidden||sourcePending)return;
 const generation=++sourceRead,config=validCo2Source(await command('co2_source.get'));
 if(sourcePending||generation!==sourceRead)return;
 if(!sourceEditing){sourceConfig=config;sourceMode.value=config.source;sourceID.value=config.device_id;doubleClick.value=config.double_click;}
 else if(sourceConfig)sourceConfig.button_events_supported=config.button_events_supported;
 renderSource();
 if(window.getDeviceSensorSources){
  const candidates=await window.getDeviceSensorSources();
  sourceCandidates.replaceChildren(...candidates.map(c=>h('option',{value:c.device_id},c.name+' · '+c.ppm+' ppm')));
 }
}
UI.onSubmit(sourceForm,async()=>{
 if(!sourceConfig||sourcePending)throw Error(t('co2source.unavailable'));
 const id=sourceMode.value==='mqtt'?M1DisplayFormat.deviceID(sourceID.value):'';
 if(sourceMode.value==='mqtt'&&!id)throw Error(t('co2source.invalid'));
 const params={source:sourceMode.value,device_id:id,double_click:doubleClick.value,revision:sourceConfig.revision};
 sourcePending=true;sourceRead++;renderSource();
 try{
  await command('co2_source.set',params);const confirmed=validCo2Source(await command('co2_source.get'));
  if(confirmed.revision<=params.revision||!['source','device_id','double_click'].every(key=>confirmed[key]===params[key]))throw Error(t('control.unconfirmed'));
  sourceConfig=confirmed;sourceEditing=false;
 }
 catch(error){try{sourceConfig=validCo2Source(await command('co2_source.get'));}catch{}throw error;}
 finally{sourcePending=false;renderSource();}
},'toast.accepted');
/* Persisted controller thresholds share one revision across both pollutants. */
let thresholdConfig=null,thresholdPending=false,thresholdRead=0,thresholdReadAt=0,thresholdLoading=false;
const thresholdRows={};
const thresholdAlarmStatus=h('p',{class:'help',id:'m1AlarmStatus',role:'status'});
const thresholdCard=h('section',{class:'card stack',id:'m1Thresholds',hidden:true},
 h('h2',{i18n:'m1.thresholds'}),info('m1.threshold_help'),info('m1.alarm_help'),thresholdAlarmStatus);
async function loadThresholds(){
 if(thresholdCard.hidden||thresholdPending||thresholdLoading)return;
 thresholdLoading=true;thresholdReadAt=Date.now();
 const generation=++thresholdRead;
 try{const config=await command('alarm.get');if(generation===thresholdRead&&!thresholdPending){thresholdConfig=config;renderThresholds();}}
 finally{thresholdLoading=false;}
}
function renderThresholds(){
 const supported=thresholdConfig?.buzzer_supported===true;
 thresholdAlarmStatus.textContent=t(!thresholdConfig?'m1.alarm_loading':!supported?'m1.alarm_upgrade':thresholdConfig.buzzer_confirmed===true?'m1.alarm_confirmed':'m1.alarm_pending');
 for(const [sensor,row] of Object.entries(thresholdRows)){
  const configured=thresholdConfig?.[sensor+'_configured'];
  if(thresholdConfig&&!row.editing){row.low.value=configured?thresholdConfig[sensor+'_yellow']:row.defaults[0];row.high.value=configured?thresholdConfig[sensor+'_red']:row.defaults[1];row.buzzer.checked=thresholdConfig[sensor+'_buzzer_enabled']===true;}
  for(const el of [row.low,row.high,row.save,row.reset])el.disabled=thresholdPending||!thresholdConfig;
  row.buzzer.disabled=thresholdPending||!supported;
  const actual=supported?thresholdConfig?.['mcu_'+sensor+'_buzzer_enabled']:null;
  row.actual.textContent=t(actual===true?'m1.alarm_actual_on':actual===false?'m1.alarm_actual_off':'m1.alarm_actual_unknown');
 }
}
async function saveThresholds(sensor,restore){
 if(thresholdPending)return;
 if(!thresholdConfig)throw Error(t('m1.threshold_unavailable'));
 const row=thresholdRows[sensor],values=restore?row.defaults:[row.low,row.high].map(el=>el.value.trim()===''?NaN:Number(el.value));
 if(!values.every(Number.isInteger)||values[0]<0||values[1]<1||values[1]>65535||values[0]>values[1])throw Error(t('m1.threshold_invalid'));
 thresholdPending=true;thresholdRead++;renderThresholds();
 try{
  const params={sensor,yellow:values[0],red:values[1],revision:thresholdConfig.revision};
  if(!restore&&thresholdConfig.buzzer_supported===true)params.buzzer_enabled=row.buzzer.checked;
  thresholdConfig=await command('alarm.set',params);
  row.editing=false;
 }catch(error){
  // Refresh the shared revision after conflicts, retaining the user's inputs.
  try{thresholdConfig=await command('alarm.get');}catch{}
  throw error;
 }finally{thresholdPending=false;renderThresholds();}
}
for(const [sensor,key,defaults] of [['hcho','m.formaldehyde',[100,300]],['pm25','m.pm25',[75,150]]]){
 const low=h('input',{id:'m1Threshold_'+sensor+'_low',type:'number',min:0,max:65535,step:1,required:true});
 const high=h('input',{id:'m1Threshold_'+sensor+'_high',type:'number',min:1,max:65535,step:1,required:true});
 const buzzer=h('input',{id:'m1Alarm_'+sensor,type:'checkbox',role:'switch'});
 const actual=h('p',{class:'help',id:'m1AlarmActual_'+sensor});
 const save=h('button',{type:'submit',class:'btn primary',i18n:'common.save'});
 const reset=h('button',{type:'button',class:'btn ghost',i18n:'m1.threshold_restore',onclick:()=>run(null,()=>saveThresholds(sensor,true),'toast.accepted')});
 const form=h('form',{class:'stack','data-threshold-sensor':sensor},h('h3',{i18n:key}),
  ...[[low,'m1.threshold_low'],[high,'m1.threshold_high']].map(([input,label])=>h('label',{class:'field'},h('span',{i18n:label}),input)),
  h('label',{class:'switch'},h('span',{class:'text'},h('b',{i18n:'m1.alarm_enabled'})),buzzer),actual,
  h('div',{class:'form-actions'},save,reset));
 thresholdRows[sensor]={low,high,buzzer,actual,save,reset,defaults,editing:false};
 form.addEventListener('input',()=>{thresholdRows[sensor].editing=true;});
 UI.onSubmit(form,()=>saveThresholds(sensor,false),'toast.accepted');thresholdCard.append(form);
}
thresholdCard.append(h('button',{type:'button',class:'btn ghost',i18n:'diag.log_refresh',onclick:()=>run(null,loadThresholds,null)}));
document.querySelector('[data-settings-page="device"]').append(thresholdCard);
/* One persisted RTTTL song resides on the sensor/display MCU, not in Wi-Fi config. */
let musicStatus=null,musicBusy=false,musicEnabled=false;
const musicText=h('textarea',{id:'m1MusicText',rows:5,maxlength:1024,spellcheck:false,placeholder:'Chime:d=8,o=5,b=120:c,e,g,4c6'});
const musicProgress=h('p',{id:'m1MusicStatus',role:'status',class:'help'});
const musicCard=h('section',{class:'card stack',id:'m1Music',hidden:true},h('h2',{i18n:'music.title'}),info('music.help'));
function musicCrc(text){let crc=0xffffffff;for(let i=0;i<text.length;i++){crc^=text.charCodeAt(i);for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');}
function renderMusic(){
 musicCard.hidden=!UI.m1MusicSupported;
 for(const el of musicCard.querySelectorAll('button,input,textarea'))el.disabled=musicBusy||!UI.m1MusicSupported;
 musicPlay.disabled=musicBusy||!musicStatus?.present;
 UI.m1MusicPresent=musicStatus?.present===true&&UI.m1MusicSupported===true;
 window.dispatchEvent(new Event('m1-tone-capability'));
 if(!musicBusy)musicProgress.textContent=musicStatus?.present?t('music.saved',{n:musicStatus.length,s:(musicStatus.duration_ms/1000).toFixed(1)}):t('music.empty');
}
async function loadMusic(){if(!UI.m1MusicSupported||musicBusy)return;musicStatus=await command('music.get');renderMusic();}
async function saveMusic(){
 if(musicBusy)return;
 const text=musicText.value.trim();
 if(!text||text.length>1024||/[^\x09\x0a\x0d\x20-\x7e]/.test(text))throw Error(t('music.invalid'));
 musicBusy=true;renderMusic();let begun=false;
 try{
  await command('music.begin',{length:text.length,crc32:musicCrc(text)});begun=true;
  for(let offset=0;offset<text.length;offset+=4){
   let error;
   for(let attempt=0;attempt<3;attempt++)try{await command('music.chunk',{offset,data:text.slice(offset,offset+4)});error=null;break;}catch(e){error=e;}
   if(error)throw error;
   musicProgress.textContent=t('music.uploading',{n:Math.min(offset+4,text.length),total:text.length});
  }
  await command('music.commit');begun=false;
  musicStatus=await command('music.get');
  if(!musicStatus.present||musicStatus.crc32!==musicCrc(text)||musicStatus.length!==text.length)throw Error(t('music.verify_failed'));
 }finally{if(begun)try{await command('music.cancel');}catch{}musicBusy=false;renderMusic();}
}
async function readMusic(){
 if(musicBusy)return;musicBusy=true;renderMusic();
 try{
  musicStatus=await command('music.get');if(!musicStatus.present)return;
  let text='';for(let offset=0;offset<musicStatus.length;offset+=10){const data=await command('music.read',{offset,length:Math.min(10,musicStatus.length-offset)});text+=data.data;}
  if(text.length!==musicStatus.length||musicCrc(text)!==musicStatus.crc32)throw Error(t('music.verify_failed'));
  musicText.value=text;
 }finally{musicBusy=false;renderMusic();}
}
const musicSave=h('button',{type:'button',class:'btn primary',id:'m1MusicSave',i18n:'music.save',onclick:()=>run(null,saveMusic,'toast.accepted')});
const musicPlay=h('button',{type:'button',class:'btn',id:'m1MusicPlay',i18n:'music.play',onclick:()=>run(null,()=>command('music.play'),null)});
const musicStop=h('button',{type:'button',class:'btn',id:'m1MusicStop',i18n:'wake.stop',onclick:()=>run(null,async()=>{await command('wake_alarm.stop');await command('music.stop');},null)});
const musicFile=h('input',{type:'file',accept:'.rtttl,.txt,text/plain',id:'m1MusicFile'});
musicFile.addEventListener('change',()=>run(null,async()=>{const file=musicFile.files?.[0];if(file){if(file.size>1024)throw Error(t('music.invalid'));musicText.value=await file.text();}},null));
musicCard.append(h('label',{class:'field'},h('span',{i18n:'music.file'}),musicFile),h('label',{class:'field'},h('span',{i18n:'music.text'}),musicText),musicProgress,
 h('div',{class:'form-actions'},musicSave,h('button',{type:'button',class:'btn ghost',id:'m1MusicRead',i18n:'music.read',onclick:()=>run(null,readMusic,null)}),musicPlay,musicStop));
document.querySelector('[data-settings-page="device"]').append(musicCard);
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
 co2Display.hidden=UI.userDisplay.enabled||!(config?.available===true&&config.mcu_supported===true&&config.module_present===true);
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
 const tones=wakeStatus?.tone_supported===true&&wakeStatus.tone_count===4;
 UI.m1MusicSupported=tones&&wakeStatus?.music_supported===true;
 if(musicEnabled!==UI.m1MusicSupported){musicEnabled=UI.m1MusicSupported;renderMusic();if(musicEnabled)run(null,loadMusic,null);}
 const custom=$('wakeAlarmTone').querySelector('[value="5"]');if(custom)custom.hidden=!UI.m1MusicPresent;
 if(UI.m1ToneSupported!==tones){UI.m1ToneSupported=tones;window.dispatchEvent(new Event('m1-tone-capability'));}
 $('wakeAlarmToneField').hidden=!tones;
 const remaining=wakeStatus?.active?Math.max(0,Math.ceil(wakeStatus.remaining_seconds-(Date.now()-wakeReadAt)/1000)):0;
 $('wakeAlarmState').textContent=wakeStatus===null?t('wake.unknown'):remaining?t('wake.ringing',{n:remaining}):t('wake.idle');
 box.classList.toggle('warn',remaining>0);
 $('wakeAlarmStop').disabled=wakePending;
 $('wakeAlarmTone').disabled=wakePending||remaining>0;
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
 const tone=h('select',{id:'wakeAlarmTone'},...[0,1,2,3,4,5].map(id=>h('option',{value:id,i18n:'wake.tone.'+id})));
 const box=h('section',{class:'card stack',id:'wakeAlarmCard'},h('h2',{i18n:'wake.title'}),
  h('p',{id:'wakeAlarmState',role:'status'}),info('wake.home_hint'),
  h('label',{class:'field',id:'wakeAlarmToneField',hidden:true},h('span',{i18n:'wake.tone'}),tone),
  h('div',{class:'form-actions'},h('button',{id:'wakeAlarmStop',type:'button',class:'btn',i18n:'wake.stop',onclick:()=>run(null,async()=>{await control('wake_alarm.stop');if(UI.m1MusicSupported)await command('music.stop');},null)}),
   h('button',{id:'wakeAlarmPreview',type:'button',class:'btn ghost',i18n:'wake.preview',onclick:()=>run(null,()=>{
    const selected=UI.m1ToneSupported?Number(tone.value):0;
    if(selected===5){if(!UI.m1MusicPresent)throw Error(t('wake.tone_unavailable'));return command('music.play');}
    return control('wake_alarm.start',selected?{duration_seconds:1,tone:selected}:{duration_seconds:3});
   },null)})));
 $('metrics').after(box);renderWakeAlarm();pollWakeAlarm(true);
}

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
 capabilities(caps){
  UI.userDisplay.enable(caps);
  particleEnabled=caps.actions?.includes("sensor_details.get")===true;renderParticles();pollParticles();
  if(caps.actions?.includes('alarm.get')&&caps.actions.includes('alarm.set')){thresholdCard.hidden=false;renderThresholds();run(null,loadThresholds,null);}
  if(!UI.userDisplay.enabled&&caps.actions?.includes('co2_source.get')&&caps.actions.includes('co2_source.set')){sourceCard.hidden=false;run(null,loadCo2Source,null);}
  if(caps.actions?.includes("wake_alarm.start")&&caps.actions.includes("wake_alarm.get")&&caps.actions.includes("wake_alarm.stop")){this.nav.schedule="wake.schedules";this.scheduleLead="wake.lead";installWakeAlarm();}
 },
 model:'M1',kindKey:'kind.m1',icon:'air',mqttHostMax:127,factoryReset:true,
 otaName:'phicomm_m1.ota.bin.signed',haHintKey:'mqtt.ha_m1',otaHintKey:'fw.hint_m1',buttonHintKey:'sys.hint_m1',
 scheduleLead:'sch.lead_a1',interval:1000,
 groups:[['grp.network',['network','mqtt']],['grp.device',['device']],['grp.auto',['binding','schedule','night']],['grp.system',['firmware','diagnostics','logs','maintenance']]],
 nav:{network:'nav.wifi',mqtt:'nav.mqtt',device:'nav.general',binding:'nav.permission',schedule:'nav.schedule',night:'nav.sleep',firmware:'nav.firmware',diagnostics:'nav.diagnostics',logs:'nav.logs',maintenance:'nav.maintenance'},
 pages:{device:{show:async()=>{await Promise.all([clock.show(),loadThresholds(),loadMusic(),loadCo2Source(),UI.userDisplay.load()]);},status:clock.status},binding:{show:showBinding}},
 diagGroups:[['diag.g_sensor',['uart_ready','sensor_valid','sensor_received','age_ms','temperature','humidity','formaldehyde','pm25','rx_frames','unknown_frames','uart_errors','discarded_bytes','last_frame']],
  ['diag.g_clock',['timezone_minutes','ntp_host','ntp_status','ntp_server','ntp_synced','ntp_screen_queued','ntp_last_success','ntp_next_seconds']],
  ['diag.g_screen',['brightness_requested']],
  ['diag.g_ota_img',['ota_signature_verified','ota_image_verified','ota_key_id','ota_image_length','ota_release_counter','ota_version']]],
 healthChecks:s=>[['diag.c_sensor',s.uart_ready&&s.sensor_valid?'ok':'bad',s.uart_errors?t('diag.errors',{n:s.uart_errors}):t(s.sensor_valid?'state.ok':'m1.no_data')],
  ['diag.c_clock',s.ntp_synced?'ok':'warn',t('s.'+(s.ntp_status||'syncing'))]],
 onStatus:s=>{renderHome(s);renderWakeAlarm();pollWakeAlarm();UI.userDisplay.poll();if(UI.activePage()==='device'&&Date.now()-thresholdReadAt>=2000)loadThresholds().catch(()=>{});}
});
I18N.onChange(()=>{renderPeers();renderThresholds();const p=document.querySelector('[data-settings-page="binding"]');if(p&&!p.hidden)showBinding();});
// The linked list is small and changes rarely; refresh it with the status.
(async function poll(){try{if(document.hidden||($('homePage').hidden&&UI.activePage()!=='binding'&&UI.activePage()!=='linkage'))return;bindingStatus=await api('/binding/status');renderPeers();}catch{}finally{setTimeout(poll,4000);}})();
renderPeers();
})();
