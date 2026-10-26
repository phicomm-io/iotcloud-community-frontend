/* V3 presentation is additive. Devices advertising only v2 keep the old form. */
(()=>{
'use strict';
const legacy=UI.userDisplay,{h,info}=UI,{t}=I18N;
const {colors,units,customUnits,modes,record,exact,physical,samePhysical,deviceID,validLamps,uniformLamps,validDisplay,metricValid,encode}=M1DisplayFormat;
const actions=['display_profile.get','display_profile.set','display_value.set'];
const localMetrics=['temperature','humidity','pm25','formaldehyde','co2','pressure'];
const remoteMetrics=Object.keys(units).filter(key=>key!=='custom');
const positions=['left','middle','right'];
const field=(key,input)=>h('label',{class:'field'},h('span',{i18n:key}),input);
const select=(id,values,prefix)=>h('select',{id},...values.map(value=>h('option',{value,i18n:prefix+value})));
const number=(id,min,max,step=1)=>h('input',{id,type:'number',min,max,step});
const checkbox=(id,key)=>h('label',{class:'row'},h('input',{id,type:'checkbox'}),h('span',{i18n:key}));
const selected=select('displaySelectedSource',['original','user'],'display.selected.');
const doubleClick=select('displayDoubleClick',['none','switch_display'],'display.double.');
const status=h('p',{id:'displaySourceStatus',class:'help',role:'status'});
const projected=h('p',{class:'help',i18n:'display.profile.projected',hidden:true});
// Raw frame inputs are independent from the persisted profile and validate on Write.
const form=h('form',{class:'stack',noValidate:true},field('display.selected',selected),field('display.double',doubleClick));
const lanes=h('div',{class:'grid'});form.append(lanes);
const save=h('button',{type:'submit',class:'btn primary',id:'displaySourceSave',i18n:'common.save'});form.append(save);
const card=h('section',{id:'displaySourceConfig',class:'card stack',hidden:true},h('h2',{i18n:'display.title'}),
 h('p',{class:'help',i18n:'display.profile.help'}),info('display.profile.glass'),status,projected,form);
let config=null,editing=false,editRevision=null,pending=false,loading=false,generation=0,lastRead=0,candidates=[];
const rows=[];
const metricOptions=source=>source==='none'?['custom']:source==='local'?localMetrics:source==='mqtt'?remoteMetrics:Object.keys(units);
const emptyLane=slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',display:{mode:'integer',show_label:false,show_unit:false},ttl_seconds:20,color:{mode:'fixed',lamps:uniformLamps('off')}});
function markEditing(){if(!editing)editRevision=config?.revision;editing=true;}
function validLane(lane,slot){
 return exact(lane,['slot','source','device_id','metric','unit','display','ttl_seconds','color'])&&lane.slot===slot&&
  ['none','local','mqtt','api'].includes(lane.source)&&metricOptions(lane.source).includes(lane.metric)&&
  typeof lane.device_id==='string'&&(lane.source==='mqtt'?/^[0-9a-f]{12}$/.test(lane.device_id):lane.device_id==='')&&
  (lane.metric==='custom'?customUnits.includes(lane.unit):lane.unit===units[lane.metric])&&(lane.source!=='none'||lane.unit==='')&&
  validDisplay(lane.display,slot)&&Number.isInteger(lane.ttl_seconds)&&lane.ttl_seconds>=1&&lane.ttl_seconds<=60&&
  (lane.color?.mode==='fixed'?exact(lane.color,['mode','lamps'])&&validLamps(lane.color.lamps):lane.color?.mode==='thresholds'&&
   exact(lane.color,['mode','low','high'])&&physical(lane.color.low)&&physical(lane.color.high)&&Math.fround(lane.color.low)<Math.fround(lane.color.high));
}
function validConfig(value){
 return record(value)&&Number.isInteger(value.revision)&&value.revision>=0&&value.revision<=2147483647&&
  ['original','user'].includes(value.selected_source)&&['none','switch_display'].includes(value.double_click)&&
  Array.isArray(value.lanes)&&value.lanes.length===2&&value.lanes.every(validLane);
}
function validRead(value){
 const bad=()=>{throw Error(t('control.unconfirmed'));};
 if(!exact(value,['schema','revision','selected_source','double_click','lanes','runtime'])||value.schema!==3||!validConfig(value))bad();
 const runtime=value.runtime;
 if(!exact(runtime,['profile','selected_source','mcu_supported','confirmed','confirmation','lanes'])||
    !['legacy','dual','formatted'].includes(runtime.profile)||!['original','user'].includes(runtime.selected_source)||
    typeof runtime.mcu_supported!=='boolean'||typeof runtime.confirmed!=='boolean'||!Array.isArray(runtime.lanes)||runtime.lanes.length!==2||
    !runtime.lanes.every((lane,slot)=>{
     if(!exact(lane,['slot','valid','value','unit','age_ms','remaining_ttl_seconds','effective','reason','number','format','lamps','confirmed'])||lane.slot!==slot||
        typeof lane.valid!=='boolean'||typeof lane.effective!=='boolean'||typeof lane.confirmed!=='boolean'||!customUnits.includes(lane.unit)||
        !Number.isInteger(lane.remaining_ttl_seconds)||lane.remaining_ttl_seconds<0||lane.remaining_ttl_seconds>60||
        !(lane.age_ms===null||Number.isInteger(lane.age_ms)&&lane.age_ms>=0&&lane.age_ms<=4294967295)||
        !['ok','disabled','missing','stale','offline','invalid','out_of_range','unsupported'].includes(lane.reason))return false;
     if(runtime.profile!=='formatted'&&(lane.confirmed||lane.effective))return false;
     if(lane.effective&&(!runtime.mcu_supported||!lane.valid||!lane.confirmed||runtime.selected_source!=='user'))return false;
     return lane.valid?physical(lane.value)&&lane.value>=0&&Number.isInteger(lane.age_ms)&&lane.age_ms>=0&&lane.age_ms<=4294967295&&
      lane.remaining_ttl_seconds>0&&Number.isInteger(lane.number)&&lane.number>=0&&lane.number<=999&&
      Number.isInteger(lane.format)&&lane.format>=0&&lane.format<=7&&(!slot||!(lane.format&1))&&validLamps(lane.lamps)&&lane.reason==='ok':
      lane.value===null&&lane.number===null&&lane.format===null&&lane.lamps===null&&lane.remaining_ttl_seconds===0&&lane.reason!=='ok';
    }))bad();
 const confirmed=runtime.profile==='formatted'&&runtime.mcu_supported&&runtime.lanes.every(lane=>lane.confirmed);
 if(runtime.confirmed!==confirmed||runtime.confirmation!==(confirmed?'mcu_readback':runtime.mcu_supported?'pending_mcu_readback':'requires_mcu_upgrade'))bad();
 return value;
}
const sameLamps=(actual,expected)=>actual.every((lamp,i)=>colors.every(color=>lamp[color]===expected[i][color]));
const sameConfig=(actual,expected)=>actual.selected_source===expected.selected_source&&actual.double_click===expected.double_click&&actual.lanes.every((lane,slot)=>{
 const target=expected.lanes[slot];return ['slot','source','device_id','metric','unit','ttl_seconds'].every(key=>lane[key]===target[key])&&
  ['mode','show_label','show_unit'].every(key=>lane.display[key]===target.display[key])&&lane.color.mode===target.color.mode&&
  (target.color.mode==='fixed'?sameLamps(lane.color.lamps,target.color.lamps):samePhysical(lane.color.low,target.color.low)&&samePhysical(lane.color.high,target.color.high));
});
function readLane(row){
 const source=row.source.value,metric=source==='none'?'custom':row.metric.value;
 if(source==='none')return emptyLane(row.slot);
 if(source==='api'){
  const previous=config?.lanes[row.slot],base=previous?.source==='api'?previous:emptyLane(row.slot);
  return {...base,slot:row.slot,source:'api',device_id:'',ttl_seconds:Number(row.ttl.value)};
 }
 return {slot:row.slot,source,device_id:source==='mqtt'?deviceID(row.device.value):'',metric,
  unit:metric==='custom'?row.unit.value:units[metric],display:{mode:row.mode.value,show_label:row.label.checked,show_unit:row.glyph.checked},ttl_seconds:Number(row.ttl.value),
  color:row.colorMode.value==='fixed'?{mode:'fixed',lamps:row.lamps.map(lamp=>Object.fromEntries(colors.map(color=>[color,lamp[color].checked])))}:
   {mode:'thresholds',low:Number(row.low.value),high:Number(row.high.value)}};
}
const configuration=()=>({revision:editing?editRevision:config?.revision,selected_source:selected.value,double_click:doubleClick.value,lanes:rows.map(readLane)});
function options(row,metric=row.metric.value){
 const values=metricOptions(row.source.value);row.metric.replaceChildren(...values.map(value=>h('option',{value,i18n:'display.metric.'+value})));
 row.metric.value=values.includes(metric)?metric:values.includes(row.slot?'pm25':'formaldehyde')?(row.slot?'pm25':'formaldehyde'):values[0];
 const value=row.metric.value,previous=row.unit.value;
 row.unit.replaceChildren(...(value==='custom'?customUnits:[units[value]]).map(unit=>h('option',{value:unit},unit||t('display.unitless'))));
 row.unit.value=value==='custom'&&customUnits.includes(previous)?previous:units[value];
}
function setConfig(value,reset){
 config=value;
 if(reset){editing=false;editRevision=value.revision;selected.value=value.selected_source;doubleClick.value=value.double_click;
  for(const row of rows){const lane=value.lanes[row.slot];row.source.value=lane.source;options(row,lane.metric);row.device.value=lane.device_id;row.unit.value=lane.unit;
   row.mode.value=lane.display.mode;row.label.checked=lane.display.show_label;row.glyph.checked=lane.display.show_unit;row.ttl.value=lane.ttl_seconds;row.colorMode.value=lane.color.mode;
   row.lamps.forEach((lamp,i)=>colors.forEach(color=>lamp[color].checked=lane.color.mode==='fixed'&&lane.color.lamps[i][color]));
   row.low.value=lane.color.mode==='thresholds'?lane.color.low:'';row.high.value=lane.color.mode==='thresholds'?lane.color.high:'';
   const reading=value.runtime.lanes[row.slot];
   if(lane.source==='api'&&reading.valid&&!row.rawEdited){row.value.value=reading.number;row.rawDecimal.checked=!!(reading.format&1);row.rawLabel.checked=!!(reading.format&2);row.rawGlyph.checked=!!(reading.format&4);
    row.rawLamps.forEach((lamp,i)=>colors.forEach(color=>lamp[color].checked=reading.lamps[i][color]));}
  }
 }
 render();
}
function render(){
 const runtime=config?.runtime;
 status.textContent=!runtime?t('display.loading'):t('display.current',{value:t('display.selected.'+runtime.selected_source)})+' · '+
  t(!runtime.mcu_supported?'display.profile.upgrade':runtime.confirmed?'display.confirmed':'display.pending');
 projected.hidden=!runtime||runtime.profile==='formatted';
 for(const input of form.querySelectorAll('input,select,button'))input.disabled=pending||!config;
 for(const row of rows){
  const lane=runtime?.lanes[row.slot],source=row.source.value,metric=row.metric.value;
  row.settings.hidden=source==='none';row.mqtt.hidden=source!=='mqtt';row.api.hidden=source!=='api';row.presentation.hidden=source==='api';
  row.unit.disabled=pending||!config||metric!=='custom';row.mode.disabled=pending||!config||row.slot===1;
  row.fixed.hidden=row.colorMode.value!=='fixed';row.thresholds.hidden=row.colorMode.value!=='thresholds';
  row.low.required=row.high.required=row.colorMode.value==='thresholds'&&source!=='none'&&source!=='api';row.device.required=source==='mqtt';row.fanHelp.hidden=source==='api'||metric!=='fan_speed_percent';
  row.rawDecimal.disabled=pending||!config||row.slot===1;
  row.modeHelp.textContent=t('display.mode_help.'+row.mode.value);
  row.write.disabled=row.clear.disabled=pending||editing||!config||runtime.profile!=='formatted'||config.lanes[row.slot].source!=='api';
  row.writeTTL.max=row.ttl.value||60;if(Number(row.writeTTL.value)>Number(row.ttl.value))row.writeTTL.value=row.ttl.value;
  row.live.textContent=!lane?t('display.loading'):t(lane.effective?'display.effective':'display.original_fallback')+' · '+
   (lane.valid?String(Number(lane.value.toPrecision(7)))+' '+lane.unit+' · '+t('display.remaining',{seconds:lane.remaining_ttl_seconds}):t('display.reason.'+lane.reason));
  const value=lane?.valid?lane.value:null;
  const preview=value===null?null:metricValid(metric,value)?encode({mode:row.mode.value,show_label:row.label.checked,show_unit:row.glyph.checked},row.slot,value):null;
  row.preview.textContent=value===null?t('display.preview_empty'):preview?t('display.profile.preview',{value:preview.text})+
   (row.label.checked?' · '+t('display.label'+row.slot):'')+(row.glyph.checked?' · '+(row.slot?'µg/m³':'mg/m³'):''):t('display.profile.invalid_value');
  for(const lamps of [row.lamps,row.rawLamps])lamps.forEach((lamp,i)=>colors.forEach(color=>lamp[color].setAttribute('aria-label',t('display.lamp_label',{position:t('display.position.'+positions[i]),color:t('display.color.'+color)}))));
  row.candidate.replaceChildren(h('option',{value:'',i18n:'display.manual_device'}),...candidates.map((candidate,index)=>h('option',{value:String(index)},candidate.name+' · '+t('display.metric.'+candidate.metric)+' · '+candidate.value+' '+candidate.unit)));
  const match=candidates.findIndex(candidate=>candidate.device_id===deviceID(row.device.value)&&candidate.metric===metric);row.candidate.value=match<0?'':String(match);
  const frame=rawFrame(row),digits=frame.number.toString().padStart(3,'0');
  row.rawPreview.textContent=row.value.value===''?t('display.preview_empty'):validFrame(row,frame)?t('display.profile.preview',{value:frame.decimal?digits[0]+'.'+digits.slice(1):String(frame.number)})+
   (frame.show_label?' · '+t('display.label'+row.slot):'')+(frame.show_unit?' · '+(row.slot?'µg/m³':'mg/m³'):''):t('display.raw_invalid');
  row.example.textContent=JSON.stringify({request_id:'unique-id',action:'display_value.set',params:{revision:config?.revision||0,slot:row.slot,...frame,ttl_seconds:Number(row.writeTTL.value)||20}},null,2);
 }
 save.disabled=pending||!config;
}
async function load(){
 if(!formatted.enabled||pending||loading)return;
 loading=true;lastRead=Date.now();const current=++generation;
 try{const value=validRead(await command('display_profile.get'));if(current!==generation||pending)return;setConfig(value,!editing);
  if(window.getDeviceSensorSources){const result=await window.getDeviceSensorSources('display');if(current===generation&&!pending){candidates=Array.isArray(result)?result.filter(item=>record(item)&&deviceID(item.device_id)&&remoteMetrics.includes(item.metric)&&item.unit===units[item.metric]&&metricValid(item.metric,item.value)).map(item=>({...item,device_id:deviceID(item.device_id)})):[];render();}}
 }finally{loading=false;}
}
async function saveConfig(){
 if(pending||!config)throw Error(t('display.unavailable'));
 const params=configuration();
 if(!validConfig(params)||rows.some(row=>!['none','api'].includes(row.source.value)&&row.colorMode.value==='thresholds'&&(row.low.value===''||row.high.value==='')))throw Error(t('display.invalid'));
 pending=true;generation++;render();
 try{await command('display_profile.set',params);const value=validRead(await command('display_profile.get'));
  if(value.revision<=params.revision||value.runtime.profile!=='formatted'||!sameConfig(value,params))throw Error(t('control.unconfirmed'));setConfig(value,true);
 }catch(error){try{const latest=validRead(await command('display_profile.get'));setConfig(latest,false);editRevision=latest.revision;}catch{}throw error;
 }finally{pending=false;render();}
}
async function writeData(row,clear=false){
 if(pending||editing||config?.runtime.profile!=='formatted'||config?.lanes[row.slot].source!=='api')throw Error(t('display.save_first'));
 const lane=config.lanes[row.slot],ttl=clear?0:Number(row.writeTTL.value),frame=rawFrame(row);
 if(!clear&&(row.value.value===''||!validFrame(row,frame)||!Number.isInteger(ttl)||ttl<1||ttl>lane.ttl_seconds))throw Error(t('display.raw_invalid'));
 const params={revision:config.revision,slot:row.slot,...(clear?{}:frame),ttl_seconds:ttl};
 pending=true;generation++;render();const started=performance.now();
 try{await command('display_value.set',params);const result=validRead(await command('display_profile.get')),receipt=result.runtime.lanes[row.slot];
  const elapsed=Math.ceil(performance.now()-started)+100,format=Number(frame.decimal)|(frame.show_label?2:0)|(frame.show_unit?4:0),unit=frame.show_unit?(row.slot?'µg/m³':'mg/m³'):'';
  if(result.revision!==params.revision||result.runtime.profile!=='formatted'||!sameConfig(result,config)||(clear?receipt.valid||receipt.value!==null:
   !receipt.valid||receipt.number!==frame.number||receipt.format!==format||!sameLamps(receipt.lamps,frame.lamps)||receipt.unit!==unit||!samePhysical(receipt.value,frame.decimal?frame.number/100:frame.number)||receipt.age_ms>elapsed||
   receipt.remaining_ttl_seconds!==Math.ceil((ttl*1000-receipt.age_ms)/1000)))throw Error(t('control.unconfirmed'));setConfig(result,false);
 }finally{pending=false;render();}
}
function rawFrame(row){return {number:Number(row.value.value),decimal:row.rawDecimal.checked,show_label:row.rawLabel.checked,show_unit:row.rawGlyph.checked,
 lamps:row.rawLamps.map(lamp=>Object.fromEntries(colors.map(color=>[color,lamp[color].checked])))};}
function validFrame(row,frame){return Number.isInteger(frame.number)&&frame.number>=0&&frame.number<=999&&(!row.slot||!frame.decimal)&&validLamps(frame.lamps);}
function lampTable(lamps){return h('fieldset',{class:'bare'},h('legend',{i18n:'display.lamps'}),h('p',{class:'help',i18n:'display.lamps_help'}),
 h('table',{class:'table'},h('thead',{},h('tr',{},h('th',{scope:'col',i18n:'display.color.value'}),...positions.map(position=>h('th',{scope:'col',i18n:'display.position.'+position})))),
  h('tbody',{},...colors.map(color=>h('tr',{},h('th',{scope:'row',i18n:'display.color.'+color}),...lamps.map(lamp=>h('td',{},h('label',{class:'row'},lamp[color]))))))));}
for(let slot=0;slot<2;slot++){
 const id='display'+slot;
 const row={slot,source:select(id+'Source',['none','local','mqtt','api'],'display.source.'),metric:select(id+'Metric',['custom'],'display.metric.'),
  device:h('input',{id:id+'Device',maxlength:17,pattern:'[0-9a-fA-F]{12}|[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}',autocomplete:'off'}),candidate:h('select',{id:id+'Candidate'}),unit:h('select',{id:id+'Unit'}),
  mode:select(id+'Mode',slot?['integer']:modes,'display.mode.'),ttl:number(id+'TTL',1,60),colorMode:select(id+'ColorMode',['fixed','thresholds'],'display.color.'),
  low:number(id+'Low',null,null,'any'),high:number(id+'High',null,null,'any'),value:number(id+'Value',0,999),writeTTL:number(id+'WriteTTL',1,60),rawEdited:false,
  live:h('p',{id:id+'Status',class:'help',role:'status'}),preview:h('p',{id:id+'Preview',class:'help',role:'status'}),modeHelp:h('p',{class:'help'}),example:h('pre',{class:'help'})};
 row.source.value='none';row.ttl.value=row.writeTTL.value=20;
 row.mqtt=h('div',{class:'stack'},field('display.candidates',row.candidate),field('display.device_mac',row.device),h('p',{class:'help',i18n:'display.mqtt_help'}));
 row.lamps=positions.map((position,i)=>Object.fromEntries(colors.map(color=>[color,h('input',{type:'checkbox',id:id+'Lamp'+i+color})])));
 row.fixed=lampTable(row.lamps);
 row.rawLamps=positions.map((position,i)=>Object.fromEntries(colors.map(color=>[color,h('input',{type:'checkbox',id:id+'WriteLamp'+i+color})])));
 const rawDecimal=checkbox(id+'Decimal','display.raw_decimal'),rawLabel=checkbox(id+'WriteLabel','display.show_label'+slot),rawGlyph=checkbox(id+'WriteGlyph','display.show_unit'+slot);
 rawDecimal.hidden=!!slot;row.rawDecimal=rawDecimal.querySelector('input');row.rawLabel=rawLabel.querySelector('input');row.rawGlyph=rawGlyph.querySelector('input');row.rawPreview=h('p',{id:id+'WritePreview',class:'help',role:'status'});
 row.thresholds=h('div',{class:'grid'},field('display.color.low',row.low),field('display.color.high',row.high));
 row.fanHelp=h('p',{id:id+'FanHelp',class:'help',i18n:'display.fan_help',hidden:true});
 const label=checkbox(id+'Label','display.show_label'+slot),glyph=checkbox(id+'Glyph','display.show_unit'+slot);row.label=label.querySelector('input');row.glyph=glyph.querySelector('input');
 row.write=h('button',{type:'button',class:'btn',id:id+'Write',i18n:'display.write',onclick:()=>UI.run(row.write,()=>writeData(row),'toast.accepted')});
 row.clear=h('button',{type:'button',class:'btn ghost',id:id+'Clear',i18n:'display.clear',onclick:()=>UI.run(row.clear,()=>writeData(row,true),'toast.accepted')});
 row.api=h('div',{class:'stack'},h('p',{class:'help',i18n:'display.raw_help'}),field('display.raw_number',row.value),rawDecimal,rawLabel,rawGlyph,row.rawPreview,lampTable(row.rawLamps),field('display.write_ttl',row.writeTTL),
  h('div',{class:'form-actions'},row.write,row.clear),h('details',{class:'info'},h('summary',{i18n:'display.api_example'}),h('p',{i18n:'display.api_endpoint'}),row.example));
 row.presentation=h('div',{class:'stack'},row.mqtt,field('display.metric',row.metric),field('display.unit',row.unit),field('display.mode',row.mode),row.modeHelp,row.preview,
  label,glyph,row.fanHelp,field('display.color.mode',row.colorMode),row.fixed,row.thresholds);
 row.settings=h('div',{class:'stack'},row.presentation,field('display.ttl',row.ttl),h('p',{class:'help',i18n:'display.ttl_help'}),row.api);
 lanes.append(h('section',{class:'stack','aria-labelledby':id+'Title'},h('h3',{id:id+'Title',i18n:'display.slot'+slot}),field('display.source',row.source),row.live,row.settings));
 row.source.onchange=()=>{options(row);markEditing();render();};row.metric.onchange=()=>{options(row);markEditing();render();};
 row.candidate.onchange=()=>{const candidate=candidates[Number(row.candidate.value)];if(row.candidate.value!==''&&candidate){row.device.value=candidate.device_id;options(row,candidate.metric);}markEditing();render();};
 row.candidate.oninput=event=>event.stopPropagation();
 row.rawInputs=[row.value,row.writeTTL,row.rawDecimal,row.rawLabel,row.rawGlyph,...row.rawLamps.flatMap(lamp=>colors.map(color=>lamp[color]))];
 for(const input of row.rawInputs)input.oninput=event=>{event.stopPropagation();row.rawEdited=true;render();};
 rows.push(row);options(row);
}
form.addEventListener('input',markEditing);
form.addEventListener('change',event=>{if(!rows.some(row=>row.rawInputs.includes(event.target)))markEditing();render();});
UI.onSubmit(form,saveConfig,'toast.accepted');
I18N.onChange(()=>{for(const row of rows)options(row);render();});
const formatted={enabled:false,load,poll(){if(UI.activePage()==='device'&&Date.now()-lastRead>=2000)load().catch(()=>{});},
 enable(){this.enabled=true;card.hidden=false;document.querySelector('[data-settings-page="device"]').append(card);UI.run(null,load,null);},
 unmount(){this.enabled=false;generation++;card.remove();}};
let active=legacy;
UI.userDisplay={get enabled(){return active.enabled;},load:()=>active.load(),poll:()=>active.poll(),enable(caps){
 if(actions.every(action=>caps.actions?.includes(action))){legacy.unmount();active=formatted;formatted.enable();}
 else{formatted.unmount();active=legacy;legacy.enable(caps);}
}};
render();
})();
