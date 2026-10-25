(()=>{
'use strict';
const {$,h,run}=UI,{t}=I18N;
const metrics=[['pm25','µg/m³'],['pm10','µg/m³'],['co2','ppm'],['temperature','°C'],['humidity','%'],['tvoc','ppb'],['formaldehyde','mg/m³']];
const optional=key=>key==='formaldehyde'||key==='pm10';
const tiles=Object.fromEntries(metrics.map(([key,unit])=>{const el=SensorUI.tile(key,unit);$('metrics').append(el.card);el.card.hidden=optional(key);return [key,el];}));
const tvocHeading=h('div',{class:'label'});tiles.tvoc.label.before(tvocHeading);
tvocHeading.append(tiles.tvoc.label,h('small',{class:'metric-reference',i18n:'m.tvoc_reference'}));
let snapshot=null,receivedAt=0,status={peers:[]};
function fresh(field,elapsed){return field?.valid===true&&typeof field.value==='number'&&Number.isFinite(field.value)&&typeof field.age_ms==='number'&&field.age_ms+elapsed<20000;}
const lightMetrics=[['co2','ppm',10000],['tvoc','ppb',65535],['pm','µg/m³',10000],['formaldehyde','mg/m³',5]];
const defaultRules=()=>({pm_source:'pm25',...Object.fromEntries([['co2',1000],['tvoc',300],['pm',50],['formaldehyde',.1]].map(([key,threshold])=>[key,[{threshold,op:'gt',mode:'on'}]]))});
function measurementMode(s,key,elapsed){
 const field=s.sensors?.[key];if(!s.indicator_enabled||!fresh(field,elapsed))return 'off';
 const rules=(s.indicator_rules||defaultRules())[['pm25','pm10'].includes(key)?'pm':key]||[];
 const match=rules.filter(r=>({gt:field.value>r.threshold,gte:field.value>=r.threshold,lt:field.value<r.threshold,lte:field.value<=r.threshold})[r.op]).sort((a,b)=>b.threshold-a.threshold)[0];
 return match?.mode||'off';
}
const indicatorViews=[];
function renderIndicators(s,elapsed){
 const voc=s.sensors?.formaldehyde?'formaldehyde':'tvoc';
 const pm=s.indicator_rules?.pm_source||'pm25';
 const rank={off:0,on:1,slow:2,fast:3};
 [['pm',[pm],t('m.'+pm)],['co2',['co2'],'CO₂'],[voc,s.indicator_rules_custom?['tvoc','formaldehyde']:[voc],s.sensors?.formaldehyde?'TVOC / '+t('m.formaldehyde'):'TVOC']].forEach(([key,sources,label],index)=>{
  const valid=sources.some(k=>fresh(s.sensors?.[k],elapsed));
  const mode=sources.map(k=>measurementMode(s,k,elapsed)).reduce((a,b)=>rank[b]>rank[a]?b:a,'off'),active=mode!=='off';
  let view=indicatorViews[index];
  if(!view){
   const dot=h('span',{class:'dot'}),title=h('b'),state=h('span',{class:'indicator-state'}),hint=h('small');
   const root=h('div',{class:'indicator-light'},h('div',{class:'row'},dot,title),state,hint);
   $('indicatorLights').append(root);view=indicatorViews[index]={root,dot,title,state,hint};
  }
  // Retain the dot across polling so slow blinks can complete their cycle.
  view.root.dataset.indicator=key;view.root.dataset.mode=mode;view.root.dataset.active=String(active);
  view.dot.className='dot '+(active?'warn':'');view.title.textContent=label;
  view.state.textContent=t(!s.indicator_enabled?'daikin.light_disabled':!valid?'m1.no_data':'daikin.mode.'+mode);
  view.hint.textContent=sources.map(k=>t('m.'+k)).join(' / ');
 });
 $('indicatorWifi').textContent=s.system_indicator?t('daikin.system.'+s.system_indicator):t(s.wifi_connected?'daikin.wifi_ok':'daikin.wifi_lost');
}
function render(s){
 if(snapshot!==s){snapshot=s;receivedAt=performance.now();}
 const elapsed=Math.max(0,performance.now()-receivedAt),grades={};let count=0;
 for(const [key] of metrics){
  const field=s.sensors?.[key],el=tiles[key];el.card.hidden=optional(key)&&!field;
  const valid=fresh(field,elapsed);
  grades[key]=SensorUI.reading(el,key,field?.value,valid);if(valid)count++;
  if(key==='co2'&&!valid&&s.co2_warmup_seconds_remaining>elapsed/1000)el.badge.textContent=t('daikin.warmup',{n:Math.ceil(s.co2_warmup_seconds_remaining-elapsed/1000)});
 }
 const ranked=['pm25','pm10','formaldehyde','co2','tvoc'].filter(k=>grades[k]),rank={ok:0,warn:1,bad:2};
 const worst=ranked.reduce((a,k)=>!a||rank[grades[k].cls]>rank[grades[a].cls]?k:a,null),level=worst?grades[worst].cls:'';
 $('verdict').dataset.level=level;
 $('overall').textContent=t(!worst?'m1.no_data':level==='bad'?'m1.v_poor':level==='warn'?'m1.v_fair':'m1.v_good');
 const why=Object.keys(grades).filter(k=>grades[k]&&grades[k].cls!=='ok').map(k=>t('m.'+k)+' '+t(grades[k].key));
 $('overallWhy').textContent=t(!count?'m1.stale_hint':'m1.all_ok');if(why.length)$('overallWhy').textContent=why.join(' · ');
 $('freshDot').className='dot '+(count?'ok live':'bad');$('freshText').textContent=t(count?'m1.updated':'m1.stale',{n:Math.floor(elapsed/1000)});
 $('indicator').checked=!!s.indicator_enabled;
 ruleEditor.status(s);
 co2Editor.status(s,elapsed);
 renderIndicators(s,elapsed);
}
function renderPeers(){
 const rows=SensorUI.peers(status),count=(status.peers||[]).filter(p=>p.session_ready).length;
 $('peerCard').replaceChildren(h('div',{class:'card-head'},h('div',{},h('h2',{i18n:'m1.linked'}),h('p',{class:'help',i18n:'m1.linked_desc'})),h('span',{class:'badge'},count+' / '+(status.max_sessions||4))),rows.length?h('div',{class:'list'},rows):h('div',{class:'empty'},t('m1.linked_empty')));
 const page=document.querySelector('[data-settings-page="binding"]');page.replaceChildren(UI.pageHead('nav.permission','m1.perm_lead'),h('section',{class:'card'},...SensorUI.peers(status)),UI.info('m1.perm_hint'));
}
function indicatorSettings(){
 let dirty=false,lastRules='',saving=false,supported=false;
 const groups=new Map(),box=$('indicatorSettings');
 const pmSource=h('select',{id:'indicatorPmSource'},['pm25','pm10'].map(value=>h('option',{value,i18n:'m.'+value})));
 pmSource.onchange=()=>{dirty=true;const title=groups.get('pm').group.querySelector('h3 span');title.dataset.i18n='m.'+pmSource.value;title.textContent=t(title.dataset.i18n);};
 const enabled=UI.switchRow('indicatorSettingsEnabled','daikin.indicator','daikin.indicator_hint');
 enabled.querySelector('input').onchange=e=>run(e.target,()=>UI.control('indicator.set',{enabled:e.target.checked},{indicator_enabled:e.target.checked}));
 const form=h('form',{id:'indicatorRulesForm',class:'stack'}),notice=h('p',{class:'help',i18n:'daikin.rules_upgrade'});
 box.append(h('h2',{i18n:'daikin.rules'}),enabled,h('p',{class:'help',i18n:'daikin.rules_hint'}),h('p',{class:'help',i18n:'daikin.shared_hint'}),notice,form,
  h('div',{},h('h3',{i18n:'daikin.system_light'}),h('p',{class:'help',i18n:'daikin.system_hint'})));
 for(const [key,unit,max] of lightMetrics){
  const list=h('div',{class:'indicator-rule-list'}),empty=h('p',{class:'help',i18n:'daikin.no_rules'});
  const add=h('button',{type:'button',class:'btn',i18n:'daikin.add_rule',onclick:()=>{append({threshold:0,op:'gte',mode:'on'});dirty=true;}});
  const group=h('section',{class:'indicator-rule-group','data-rule-metric':key},h('h3',{},h('span',{i18n:'m.'+(key==='pm'?pmSource.value:key)}),' · '+unit),
   key==='pm'?h('label',{class:'field'},h('span',{i18n:'daikin.pm_source'}),pmSource):null,list,empty,add);
  function update(){add.disabled=!supported||saving||list.children.length>=2;empty.hidden=list.children.length>0;}
  function append(rule){
   if(list.children.length>=2)return;
   const label=(text,input)=>h('label',{class:'field'},h('span',{i18n:text}),input);
   const op=h('select',{'data-rule-op':true},[['gt','>'],['gte','≥'],['lt','<'],['lte','≤']].map(([value,text])=>h('option',{value},text)));op.value=rule.op;
   const threshold=h('input',{type:'number',required:true,min:0,max,step:'any',value:rule.threshold,'data-rule-threshold':true});
   const mode=h('select',{'data-rule-mode':true},['on','off','fast','slow'].map(value=>h('option',{value,i18n:'daikin.mode.'+value})));mode.value=rule.mode;
   const row=h('div',{class:'indicator-rule'},label('daikin.compare',op),label('daikin.threshold',threshold),label('daikin.pattern',mode),
    h('button',{type:'button',class:'btn ghost',i18n:'daikin.remove_rule',onclick:()=>{row.remove();dirty=true;update();}}));
   row.addEventListener('input',()=>{dirty=true;});row.addEventListener('change',()=>{dirty=true;});list.append(row);update();
  }
  groups.set(key,{group,list,append,update});form.append(group);
 }
 const save=h('button',{type:'submit',class:'btn primary',i18n:'common.save',disabled:true});form.append(h('div',{class:'form-actions'},save));
 const comparable=rules=>JSON.stringify([rules.pm_source,...lightMetrics.map(([key])=>(rules[key]||[]).map(({threshold,op,mode})=>({threshold,op,mode})))]);
 UI.onSubmit(form,async()=>{
  if(!supported||saving)return;
  const values={pm_source:pmSource.value};
  for(const [key,,max] of lightMetrics){
   values[key]=[...groups.get(key).list.children].map(row=>({threshold:Number(row.querySelector('[data-rule-threshold]').value),op:row.querySelector('[data-rule-op]').value,mode:row.querySelector('[data-rule-mode]').value}));
   if(values[key].some(r=>!Number.isFinite(r.threshold)||r.threshold<0||r.threshold>max)||values[key].length===2&&values[key][0].threshold===values[key][1].threshold)throw Error(t('daikin.rules_invalid'));
  }
  saving=true;sync(snapshot||{});
  let confirmed;
  try{
   await command('config.set',{section:'indicator_rules',values});
   confirmed=await UI.reload({full:true});
   if(!confirmed?.indicator_rules||comparable(confirmed.indicator_rules)!==comparable(values))throw Error(t('daikin.rules_unconfirmed'));
   dirty=false;lastRules='';
  }finally{saving=false;sync(confirmed||snapshot||{});}
 },'common.saved');
 function sync(s){
  enabled.querySelector('input').checked=!!s.indicator_enabled;
  supported=s.indicator_rules_supported===true&&!!s.indicator_rules;notice.hidden=supported;save.disabled=!supported||saving;
  pmSource.disabled=!supported||saving;
  const rules=s.indicator_rules||{},fingerprint=JSON.stringify(rules);
  if(supported&&!dirty&&fingerprint!==lastRules){
   pmSource.value=rules.pm_source||'pm25';
   const title=groups.get('pm').group.querySelector('h3 span');title.dataset.i18n='m.'+pmSource.value;title.textContent=t(title.dataset.i18n);
   for(const [key] of lightMetrics){const group=groups.get(key);group.list.replaceChildren();for(const rule of rules[key]||[])group.append(rule);group.update();}
   lastRules=fingerprint;
  }
  for(const [key,group] of groups){group.group.hidden=key==='formaldehyde'&&!s.sensors?.formaldehyde;for(const input of group.list.querySelectorAll('input,select,button'))input.disabled=!supported||saving;group.update();}
 }
 return {status:sync};
}
const ruleEditor=indicatorSettings();
function co2Settings(){
 const box=$('co2Settings'),diagnostic=h('p',{class:'help',id:'co2Diagnostic','aria-live':'polite'});
 const result=h('p',{class:'help',id:'co2CalibrationResult','aria-live':'polite'});
 const reference=h('input',{id:'co2Reference',type:'number',min:400,max:1500,step:1,required:true,value:400});
 const stable=h('input',{id:'co2ReferenceStable',type:'checkbox',required:true});
 const button=h('button',{id:'co2Calibrate',type:'submit',class:'btn',i18n:'daikin.co2_calibrate',disabled:true});
 const form=h('form',{class:'stack',id:'co2CalibrationForm'},
  h('label',{class:'field'},h('span',{i18n:'daikin.co2_reference'}),reference),
  h('label',{class:'switch'},h('span',{i18n:'daikin.co2_stable'}),stable),h('div',{class:'form-actions'},button));
 box.append(h('h2',{i18n:'daikin.co2_title'}),diagnostic,h('p',{class:'help',i18n:'daikin.co2_hint'}),form,result);
 let available=false,busy=false;
 function update(){button.disabled=!available||busy||!stable.checked;reference.disabled=busy;stable.disabled=busy;}
 stable.onchange=update;
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!available||busy||!stable.checked||!form.reportValidity())return;
  const ppm=Number(reference.value);if(!Number.isInteger(ppm)||ppm<400||ppm>1500)return;
  busy=true;update();
  try{
   if(!await UI.confirm({title:t('daikin.co2_calibrate'),body:t('daikin.co2_confirm',{n:ppm}),ok:t('daikin.co2_calibrate')}))return;
   // A transport timeout can follow a real sensor write: do not retry here.
   await command('co2.calibrate',{reference_ppm:ppm,reference_stable:true});
   stable.checked=false;available=false;result.textContent=t('daikin.co2_state.queued');
   await UI.reload({full:true});
  }catch(err){stable.checked=false;available=false;result.textContent=t('daikin.co2_request_unknown');UI.toast(err.message||String(err),true);}
  finally{busy=false;update();}
 });
 function sync(s,elapsed){
  const d=s.co2_diagnostics,c=d?.calibration;
  const fresh=d?.fresh===true&&typeof d.age_ms==='number'&&d.age_ms+elapsed<20000;
  available=d?.calibration_available===true&&fresh;
  if(!d)diagnostic.textContent=t('daikin.co2_upgrade');
  else if(!fresh)diagnostic.textContent=t('daikin.co2_stale');
  else {
   const flags=['preheating','sensor_error','over_range','under_range','uncalibrated','light_aging','drift'].filter(k=>d[k]===true).map(k=>t('daikin.co2_flag.'+k));
   diagnostic.textContent=t('daikin.co2_raw',{n:d.raw_ppm,s:d.status_raw})+' · '+(d.status_flags_supported===false?t('daikin.co2_legacy_status'):flags.length?flags.join(' / '):t('daikin.co2_normal'));
  }
  if(c)result.textContent=t('daikin.co2_state.'+(['never','queued','waiting_ack','acknowledged','timeout_unknown'].includes(c.state)?c.state:'never'))+
   (d.cooldown_seconds>0?' · '+t('daikin.co2_cooldown',{n:d.cooldown_seconds}):'');
  update();
 }
 return {status:sync};
}
const co2Editor=co2Settings();
$('indicator').onchange=()=>run($('indicator'),()=>UI.control('indicator.set',{enabled:$('indicator').checked},{indicator_enabled:$('indicator').checked}));
UI.start({model:'DAIKIN BRY88AX151K',kindKey:'daikin.kind',icon:'air',factoryReset:true,mqttHostMax:127,interval:2000,
 otaName:'daikin_BRY88AX151K.ota.bin.signed',haHintKey:'daikin.ha',otaHintKey:'daikin.ota',buttonHintKey:'daikin.button',
 groups:[['grp.network',['network','mqtt']],['grp.device',['device','binding']],['grp.system',['firmware','diagnostics','maintenance']]],
 nav:{network:'nav.wifi',mqtt:'nav.mqtt',device:'nav.general',binding:'nav.permission',firmware:'nav.firmware',diagnostics:'nav.diagnostics',maintenance:'nav.maintenance'},
 pages:{device:{},binding:{show:async()=>{status=await api('/binding/status');renderPeers();}}},
 diagGroups:[['diag.g_sensor',['sensors','co2_diagnostics','formaldehyde_present','pm_sensor','hardware_model']]],onStatus:render});
I18N.onChange(()=>{if(snapshot)render(snapshot);renderPeers();});
setInterval(()=>{if(snapshot)render(snapshot);},1000);
(async function poll(){try{if(!document.hidden){status=await api('/binding/status');renderPeers();}}catch{}finally{setTimeout(poll,4000);}})();
renderPeers();
})();
