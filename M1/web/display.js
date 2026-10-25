/* Two screen positions share one original/user switch, with independent leases. */
(()=>{
'use strict';
const {h,info}=UI,{t}=I18N;
const units={temperature:'°C',humidity:'%',pm25:'µg/m³',formaldehyde:'mg/m³',co2:'ppm',pressure:'Pa',pm10:'µg/m³',tvoc:'ppb',power:'W',energy:'kWh',fan_speed_percent:'%',custom:''};
const localMetrics=['temperature','humidity','pm25','formaldehyde','co2','pressure'];
const remoteMetrics=Object.keys(units).filter(key=>key!=='custom');
const customUnits=['','°C','%','µg/m³','mg/m³','ppm','Pa','W','kWh','ppb'];
const colors=['off','red','green','yellow'];
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const physical=value=>Number.isFinite(value)&&Number.isFinite(Math.fround(value));
// Firmware stores physical values and thresholds as IEEE-754 float32.
const samePhysical=(actual,expected)=>physical(actual)&&physical(expected)&&Math.fround(actual)===Math.fround(expected);
const readingText=value=>String(Number(value.toPrecision(7)));
const field=(key,input)=>h('label',{class:'field'},h('span',{i18n:key}),input);
const select=(id,values,prefix)=>h('select',{id},...values.map(value=>h('option',{value,i18n:prefix+value})));
const number=(id,min,max,step=1)=>h('input',{id,type:'number',min,max,step});
const selected=select('displaySelectedSource',['original','user'],'display.selected.');
const doubleClick=select('displayDoubleClick',['none','switch_display'],'display.double.');
const status=h('p',{id:'displaySourceStatus',class:'help',role:'status'});
const legacy=h('p',{class:'help',i18n:'display.legacy',hidden:true});
let config=null,editing=false,editRevision=null,pending=false,loading=false,generation=0,lastRead=0,candidates=[];
function markEditing(){if(!editing)editRevision=config?.revision;editing=true;}
const rows=[];
const form=h('form',{class:'stack'},field('display.selected',selected),field('display.double',doubleClick));
const lanes=h('div',{class:'grid'});form.append(lanes);
const save=h('button',{type:'submit',class:'btn primary',id:'displaySourceSave',i18n:'common.save'});form.append(save);
const card=h('section',{id:'displaySourceConfig',class:'card stack',hidden:true},h('h2',{i18n:'display.title'}),
 h('p',{class:'help',i18n:'display.help'}),info('display.glass_help'),status,legacy,form);
document.querySelector('[data-settings-page="device"]').append(card);

function metricOptions(source){return source==='none'?['custom']:source==='local'?localMetrics:source==='mqtt'?remoteMetrics:Object.keys(units);}
function readLane(row){
 const source=row.source.value,metric=source==='none'?'custom':row.metric.value;
 if(source==='none')return {slot:row.slot,source,device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}};
 return {slot:row.slot,source,device_id:source==='mqtt'?row.device.value.trim().toLowerCase():'',metric,
  unit:source==='none'?'':metric==='custom'?row.unit.value:units[metric],decimals:Number(row.decimals.value),scale:Number(row.scale.value),ttl_seconds:Number(row.ttl.value),
  color:row.colorMode.value==='fixed'?{mode:'fixed',value:row.color.value}:{mode:'thresholds',low:Number(row.low.value),high:Number(row.high.value)}};
}
function configuration(){return {revision:editing?editRevision:config?.revision,selected_source:selected.value,double_click:doubleClick.value,lanes:rows.map(readLane)};}
function validConfig(value){
 return record(value)&&Number.isInteger(value.revision)&&value.revision>=0&&value.revision<=2147483647&&['original','user'].includes(value.selected_source)&&['none','switch_display'].includes(value.double_click)&&
  Array.isArray(value.lanes)&&value.lanes.length===2&&value.lanes.every((lane,slot)=>record(lane)&&lane.slot===slot&&
   ['none','local','mqtt','api'].includes(lane.source)&&metricOptions(lane.source).includes(lane.metric)&&
   typeof lane.device_id==='string'&&(lane.source==='mqtt'?/^[0-9a-f]{12}$/.test(lane.device_id):lane.device_id==='')&&
   (lane.metric==='custom'?customUnits.includes(lane.unit):lane.unit===units[lane.metric])&&
   (lane.source!=='none'||lane.unit==='')&&Number.isInteger(lane.decimals)&&lane.decimals>=0&&lane.decimals<=2&&[1,1000].includes(lane.scale)&&
   Number.isInteger(lane.ttl_seconds)&&lane.ttl_seconds>=1&&lane.ttl_seconds<=60&&record(lane.color)&&
   (lane.color.mode==='fixed'?colors.includes(lane.color.value):lane.color.mode==='thresholds'&&physical(lane.color.low)&&physical(lane.color.high)&&Math.fround(lane.color.low)<Math.fround(lane.color.high)));
}
function validRead(value){
 if(!validConfig(value)||!record(value.runtime)||!['legacy','dual'].includes(value.runtime.profile)||!['original','user'].includes(value.runtime.selected_source)||
    typeof value.runtime.mcu_supported!=='boolean'||typeof value.runtime.confirmed!=='boolean'||!['mcu_readback','pending_mcu_readback','requires_mcu_upgrade'].includes(value.runtime.confirmation)||!Array.isArray(value.runtime.lanes)||value.runtime.lanes.length!==2||
    !value.runtime.lanes.every((lane,slot)=>record(lane)&&lane.slot===slot&&typeof lane.valid==='boolean'&&typeof lane.effective==='boolean'&&typeof lane.confirmed==='boolean'&&
     (lane.value===null||Number.isFinite(lane.value))&&customUnits.includes(lane.unit)&&
     (lane.age_ms===null||Number.isInteger(lane.age_ms)&&lane.age_ms>=0&&lane.age_ms<=4294967295)&&Number.isInteger(lane.remaining_ttl_seconds)&&lane.remaining_ttl_seconds>=0&&lane.remaining_ttl_seconds<=60&&
     (lane.number===null||Number.isInteger(lane.number)&&lane.number>=0&&lane.number<=999)&&(lane.format===null||[0,1,2,4,5,6].includes(lane.format))&&
     (lane.color===null||colors.includes(lane.color))&&['ok','disabled','missing','stale','offline','invalid','out_of_range','unsupported'].includes(lane.reason)&&
     (!lane.effective||value.runtime.mcu_supported&&lane.valid&&lane.confirmed)&&
     (lane.valid?lane.value!==null&&lane.value>=0&&lane.age_ms!==null&&lane.remaining_ttl_seconds>0&&lane.number!==null&&lane.format!==null&&lane.color!==null&&lane.reason==='ok':
      lane.value===null&&lane.number===null&&lane.format===null&&lane.color===null&&lane.remaining_ttl_seconds===0&&lane.reason!=='ok')))throw Error(t('control.unconfirmed'));
 const runtime=value.runtime,confirmed=runtime.profile==='dual'&&runtime.mcu_supported&&runtime.lanes.every(lane=>lane.confirmed);
 if(runtime.confirmed!==confirmed||runtime.confirmation!==(confirmed?'mcu_readback':runtime.mcu_supported?'pending_mcu_readback':'requires_mcu_upgrade'))throw Error(t('control.unconfirmed'));
 return value;
}
const sameConfig=(actual,expected)=>actual.selected_source===expected.selected_source&&actual.double_click===expected.double_click&&actual.lanes.every((lane,slot)=>{
 const target=expected.lanes[slot];return ['slot','source','device_id','metric','unit','decimals','scale','ttl_seconds'].every(key=>lane[key]===target[key])&&
  lane.color.mode===target.color.mode&&(target.color.mode==='fixed'?lane.color.value===target.color.value:samePhysical(lane.color.low,target.color.low)&&samePhysical(lane.color.high,target.color.high));
});
function setConfig(value,reset){
 config=value;
 if(reset){editing=false;editRevision=value.revision;selected.value=value.selected_source;doubleClick.value=value.double_click;
  for(const row of rows){const lane=value.lanes[row.slot];row.source.value=lane.source;options(row,lane.metric);row.metric.value=lane.metric;row.device.value=lane.device_id;row.unit.value=lane.unit;
   row.decimals.value=String(lane.decimals);row.scale.value=String(lane.scale);row.ttl.value=lane.ttl_seconds;row.colorMode.value=lane.color.mode;
   row.color.value=lane.color.mode==='fixed'?lane.color.value:'off';row.low.value=lane.color.mode==='thresholds'?lane.color.low:'';row.high.value=lane.color.mode==='thresholds'?lane.color.high:'';
  }
 }
 render();
}
function options(row,metric=row.metric.value){
 const values=metricOptions(row.source.value);row.metric.replaceChildren(...values.map(value=>h('option',{value,i18n:'display.metric.'+value})));
 row.metric.value=values.includes(metric)?metric:values.includes(row.slot?'pm25':'formaldehyde')?(row.slot?'pm25':'formaldehyde'):values[0];
 const value=row.metric.value,previous=row.unit.value;
 row.unit.replaceChildren(...(value==='custom'?customUnits:[units[value]]).map(unit=>h('option',{value:unit},unit||t('display.unitless'))));
 row.unit.value=value==='custom'&&customUnits.includes(previous)?previous:units[value];
}
function renderCandidates(row){
 const previous=row.candidate.value;
 row.candidate.replaceChildren(h('option',{value:'',i18n:'display.manual_device'}),...candidates.map((candidate,index)=>h('option',{value:String(index)},
  candidate.name+' · '+t('display.metric.'+candidate.metric)+' · '+candidate.value+' '+candidate.unit)));
 const match=candidates.findIndex(candidate=>candidate.device_id===row.device.value&&candidate.metric===row.metric.value);
 row.candidate.value=match<0?'':String(match);if(!candidates.length&&previous)row.candidate.value='';
}
function render(){
 const runtime=config?.runtime;
 status.textContent=!config?t('display.loading'):t('display.current',{value:t('display.selected.'+runtime.selected_source)})+' · '+
  t(!runtime.mcu_supported?'display.upgrade':runtime.confirmed?'display.confirmed':'display.pending');
 legacy.hidden=runtime?.profile!=='legacy';
 for(const input of form.querySelectorAll('input,select,button'))input.disabled=pending||!config;
 for(const row of rows){
  const lane=runtime?.lanes[row.slot],source=row.source.value,metric=row.metric.value;
  row.settings.hidden=source==='none';row.mqtt.hidden=source!=='mqtt';row.api.hidden=source!=='api';
  row.unit.disabled=pending||!config||metric!=='custom';row.fixed.hidden=row.colorMode.value!=='fixed';row.thresholds.hidden=row.colorMode.value!=='thresholds';
  row.low.required=row.high.required=row.colorMode.value==='thresholds'&&source!=='none';
  row.device.required=source==='mqtt';row.co2Help.hidden=metric!=='co2';row.fanHelp.hidden=metric!=='fan_speed_percent';
  row.write.disabled=row.clear.disabled=pending||editing||!config||config.lanes[row.slot].source!=='api';
  row.writeTTL.max=row.ttl.value||60;
  if(Number(row.writeTTL.value)>Number(row.ttl.value))row.writeTTL.value=row.ttl.value;
  row.live.textContent=!lane?t('display.loading'):t(lane.effective?'display.effective':'display.original_fallback')+' · '+
   (lane.valid?readingText(lane.value)+' '+lane.unit+' · '+t('display.remaining',{seconds:lane.remaining_ttl_seconds}):t('display.reason.'+lane.reason));
  const value=source==='api'&&row.value.value!==''?Number(row.value.value):lane?.valid?lane.value:null;
  const digits=Number(row.decimals.value),scale=Number(row.scale.value),number=value===null?null:Math.round(value/scale*10**digits);
  row.preview.textContent=number!==null&&Number.isFinite(number)?number>=0&&number<=999?t('display.preview',{value:(number/10**digits).toFixed(digits),scale}):t('display.out_of_range'):t('display.preview_empty');
  renderCandidates(row);
  row.example.textContent=JSON.stringify({request_id:'unique-id',action:'display_data.set',params:{revision:config?.revision||0,slot:row.slot,value:row.value.value===''?0:Number(row.value.value),unit:row.unit.value,ttl_seconds:Number(row.writeTTL.value)||20}},null,2);
 }
 save.disabled=pending||!config;
}
async function load(){
 if(!UI.userDisplay.enabled||pending||loading)return;
 loading=true;lastRead=Date.now();const current=++generation;
 try{const data=validRead(await command('display_source.get'));if(current!==generation||pending)return;setConfig(data,!editing);
  if(window.getDeviceSensorSources){const result=await window.getDeviceSensorSources('display');if(current===generation&&!pending){candidates=Array.isArray(result)?result.filter(item=>record(item)&&/^[0-9a-f]{12}$/.test(item.device_id)&&remoteMetrics.includes(item.metric)&&item.unit===units[item.metric]&&Number.isFinite(item.value)):[];render();}}
 }finally{loading=false;}
}
async function saveConfig(){
 if(pending||!config)throw Error(t('display.unavailable'));
 const params=configuration();
 if(!validConfig(params)||rows.some(row=>row.source.value!=='none'&&row.colorMode.value==='thresholds'&&(row.low.value===''||row.high.value==='')))throw Error(t('display.invalid'));
 pending=true;generation++;render();
 try{await command('display_source.set',params);const result=validRead(await command('display_source.get'));
  if(result.revision<=params.revision||result.runtime.profile!=='dual'||!sameConfig(result,params))throw Error(t('control.unconfirmed'));
  setConfig(result,true);
 }catch(error){try{const latest=validRead(await command('display_source.get'));setConfig(latest,false);editRevision=latest.revision;}catch{}throw error;
 }finally{pending=false;render();}
}
async function writeData(row,clear=false){
 if(pending||editing||config?.lanes[row.slot].source!=='api')throw Error(t('display.save_first'));
 const lane=config.lanes[row.slot],ttl=clear?0:Number(row.writeTTL.value),value=Number(row.value.value);
 if(!clear&&(row.value.value===''||!Number.isFinite(value)||!Number.isInteger(ttl)||ttl<1||ttl>lane.ttl_seconds||Math.round(value/lane.scale*10**lane.decimals)<0||Math.round(value/lane.scale*10**lane.decimals)>999))throw Error(t('display.invalid_reading'));
 const params={revision:config.revision,slot:row.slot,...(clear?{}:{value,unit:lane.unit}),ttl_seconds:ttl};
 pending=true;generation++;render();
 const started=performance.now();
 try{await command('display_data.set',params);const result=validRead(await command('display_source.get')),receipt=result.runtime.lanes[row.slot];
  // The independent read must describe this lease, including same-value renewals.
  // Allow clock quantization, while accepting genuine time spent in transit.
  const elapsed=Math.ceil(performance.now()-started)+100;
  if(result.revision!==params.revision||!sameConfig(result,config)||(clear?receipt.valid||receipt.value!==null:
   !receipt.valid||receipt.unit!==lane.unit||!samePhysical(receipt.value,value)||receipt.age_ms>elapsed||
   receipt.remaining_ttl_seconds!==Math.ceil((ttl*1000-receipt.age_ms)/1000)))throw Error(t('control.unconfirmed'));
  setConfig(result,false);
 }finally{pending=false;render();}
}
for(let slot=0;slot<2;slot++){
 const id='display'+slot;
 const row={slot,source:select(id+'Source',['none','local','mqtt','api'],'display.source.'),metric:select(id+'Metric',['custom'],'display.metric.'),
  device:h('input',{id:id+'Device',maxlength:12,pattern:'[0-9a-fA-F]{12}',autocomplete:'off'}),candidate:h('select',{id:id+'Candidate'}),unit:h('select',{id:id+'Unit'}),
  decimals:h('select',{id:id+'Decimals'},...[0,1,2].map(value=>h('option',{value:String(value)},(0).toFixed(value)))),scale:h('select',{id:id+'Scale'},h('option',{value:'1'},'÷1'),h('option',{value:'1000'},'÷1000')),
  ttl:number(id+'TTL',1,60),colorMode:select(id+'ColorMode',['fixed','thresholds'],'display.color.'),color:select(id+'Color',colors,'display.color.'),low:number(id+'Low',null,null,'any'),high:number(id+'High',null,null,'any'),
  value:number(id+'Value',null,null,'any'),writeTTL:number(id+'WriteTTL',1,60),live:h('p',{id:id+'Status',class:'help',role:'status'}),preview:h('p',{id:id+'Preview',class:'help'}),example:h('pre',{class:'help'})};
 row.source.value='none';row.ttl.value=row.writeTTL.value=20;row.color.value='off';
 row.mqtt=h('div',{class:'stack'},field('display.candidates',row.candidate),field('display.device_id',row.device),h('p',{class:'help',i18n:'display.mqtt_help'}));
 row.fixed=field('display.color.value',row.color);row.thresholds=h('div',{class:'grid'},field('display.color.low',row.low),field('display.color.high',row.high));
 row.co2Help=h('p',{id:id+'Co2Help',class:'help',i18n:'display.co2_help',hidden:true});row.fanHelp=h('p',{id:id+'FanHelp',class:'help',i18n:'display.fan_help',hidden:true});
 row.write=h('button',{type:'button',class:'btn',id:id+'Write',i18n:'display.write',onclick:()=>UI.run(row.write,()=>writeData(row),'toast.accepted')});
 row.clear=h('button',{type:'button',class:'btn ghost',id:id+'Clear',i18n:'display.clear',onclick:()=>UI.run(row.clear,()=>writeData(row,true),'toast.accepted')});
 row.api=h('div',{class:'stack'},h('p',{class:'help',i18n:'display.api_help'}),field('display.value',row.value),field('display.write_ttl',row.writeTTL),
  h('div',{class:'form-actions'},row.write,row.clear),h('details',{class:'info'},h('summary',{i18n:'display.api_example'}),h('p',{i18n:'display.api_endpoint'}),row.example));
 row.settings=h('div',{class:'stack'},row.mqtt,field('display.metric',row.metric),field('display.unit',row.unit),field('display.decimals',row.decimals),field('display.scale',row.scale),row.preview,
  row.co2Help,row.fanHelp,field('display.ttl',row.ttl),h('p',{class:'help',i18n:'display.ttl_help'}),field('display.color.mode',row.colorMode),row.fixed,row.thresholds,row.api);
 lanes.append(h('section',{class:'stack','aria-labelledby':id+'Title'},h('h3',{id:id+'Title',i18n:'display.slot'+slot}),field('display.source',row.source),row.live,row.settings));
 row.source.onchange=()=>{options(row);markEditing();render();};row.metric.onchange=()=>{options(row);markEditing();render();};
 row.candidate.onchange=()=>{const candidate=candidates[Number(row.candidate.value)];if(row.candidate.value!==''&&candidate){row.device.value=candidate.device_id;options(row,candidate.metric);}markEditing();render();};
 row.candidate.oninput=event=>event.stopPropagation();
 for(const input of [row.value,row.writeTTL]){input.oninput=event=>{event.stopPropagation();render();};}
 rows.push(row);options(row);
}
form.addEventListener('input',()=>{markEditing();render();});form.addEventListener('change',event=>{if(event.target!==rows[0].value&&event.target!==rows[1].value&&event.target!==rows[0].writeTTL&&event.target!==rows[1].writeTTL){markEditing();render();}});
UI.onSubmit(form,saveConfig,'toast.accepted');
I18N.onChange(()=>{for(const row of rows)options(row);render();});
UI.userDisplay={enabled:false,load,poll:()=>{if(UI.activePage()==='device'&&Date.now()-lastRead>=2000)load().catch(()=>{});},enable(caps){this.enabled=['display_source.get','display_source.set','display_data.set'].every(action=>caps.actions?.includes(action));card.hidden=!this.enabled;if(this.enabled)UI.run(null,load,null);}};
render();
})();
