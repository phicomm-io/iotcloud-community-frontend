/* Entirely in-memory simulator. Never forwards requests to a real device. */
(()=>{
window.deviceParentTransport=true;
const messages={
 'demo.deviceBanner':['Interactive demo · Simulated data · No real device connection · Refresh to reset','交互演示 · 模拟数据 · 不连接真实设备 · 刷新重置'],
 'demo.deviceName':['Demo device','演示设备'],'demo.version':['Demo','演示'],
 'demo.networkBlocked':['Real network requests are disabled in the demo','演示禁止真实网络请求'],
 'demo.releaseNotes':['Demo release notes','演示更新说明'],
 'demo.socket.0':['Desk lamp','台灯'],'demo.socket.1':['Monitor','显示器'],'demo.socket.2':['Speakers','音箱'],
 'demo.socket.3':['Charger','充电器'],'demo.socket.4':['Fan','风扇'],'demo.socket.5':['Spare','备用']
};
let language='en',banner;
const localize=[];
const t=key=>messages[key][language==='zh-CN'?1:0];
function setLanguage(value){language=value==='zh-CN'?'zh-CN':'en';for(const update of localize)update();if(banner)banner.textContent=t('demo.deviceBanner');}
const create=model=>{
 const state={name:t('demo.deviceName'),model,device_id:{tc1:'aabbccddee01',m1:'aabbccddee02',a1:'aabbccddee03',daikin:'aabbccddee04'}[model],version:t('demo.version'),ip:'192.0.2.10',ssid:'Demo Wi-Fi',wifi_connected:true,mqtt_connected:true,mqtt_status:'ready',mqtt_host:'demo.invalid',mqtt_user:'demo',mqtt_port:1883,mqtt_topic_mode:'tmcp',mqtt_protocol:'tmcp',brightness_requested:3,brightness:192,red:80,green:200,blue:120,speed:60,percentage:60,applied_speed:60,requested_speed:60,fan_on:true,fan_mode:'manual',fan_state:'running',auto_max_speed:100,fan_ready:true,panel_ready:true,light_on:true,sensor_received:true,sensor_valid:true,age_ms:200,temperature:25,humidity:48,formaldehyde:.025,pm25:18,time_synced:true,timezone_minutes:480,ntp_host:'pool.ntp.org',ntp_status:'synced',ntp_synced:true,ota_progress:0,ota_state:'idle',socket_names:Array.from({length:6},(_,i)=>t('demo.socket.'+i)),socket_states:[true,true,false,true,false,false],report_seconds:5,powerCoefficientX100:1710,free_memory:48000,uptime_seconds:3600,power_watts:36,energy_kwh:.28,led_enabled:true};
 let defaults={name:state.name,version:state.version,names:[...state.socket_names]},customName=false;
 const customSockets=new Set();
 localize.push(()=>{
  const next={name:t('demo.deviceName'),version:t('demo.version'),names:Array.from({length:6},(_,i)=>t('demo.socket.'+i))};
  if(!customName&&state.name===defaults.name)state.name=next.name;
  if(state.version===defaults.version)state.version=next.version;
  state.socket_names=state.socket_names.map((name,i)=>!customSockets.has(i)&&name===defaults.names[i]?next.names[i]:name);
  defaults=next;
 });
 if(model==='daikin')Object.assign(state,{hardware_model:'BRY88AX151K',indicator_enabled:true,sensors:Object.fromEntries([['pm25',18],['pm10',28],['co2',650],['temperature',25],['humidity',48],['tvoc',50]].map(([key,value])=>[key,{valid:true,value,age_ms:200}]))});
 if(model==='daikin')Object.assign(state,{indicator_rules_supported:true,indicator_rules_custom:false,system_indicator:'ready',indicator_rules:{pm_source:'pm25',...Object.fromEntries([['co2',1000],['tvoc',300],['pm',50],['formaldehyde',.1]].map(([key,threshold])=>[key,[{threshold,op:'gt',mode:'on'}]]))}});
 const actions=['status.get','capabilities.get','config.get','config.set','logs.get','ota.start','schedules.get','schedules.put','schedules.delete','schedules.enable','night.get','night.set','time.get','time.set','ota.sources.get','ota.check','ota.check.get','ota.status.get','ota.install','ota.notes','ota.notes.get',...(model==='tc1'?['outlet.set','indicator.set','child_lock.set','buttons.get','buttons.set']:model==='daikin'?['indicator.set','binding.status.get']:model==='m1'?['display.set','display_source.get','display_source.set','display_data.set','display_profile.get','display_profile.set','display_value.set','binding.get','binding.status.get']:['light_effect.next','light_effect.select','light_always.set','filter.get','filter.set','filter.reset','fan.set','fan.panel','fan.mode.set','fan.mode.toggle','light.set','child_lock.set','buttons.get','buttons.set','binding.get','binding.set','binding.status.get','binding.probe','linkage.get','linkage.set','light_effect.get','light_effect.set'])].filter(action=>model!=='daikin'||!action.startsWith('ota.'));
 const fixtures={'night.get':{windows:[],revision:1},'buttons.get':{items:[],capacity:model==='a1'?102:68},'schedules.get':{items:[],capacity:8,count:0,next:0},'time.get':{timezone_minutes:480},'logs.get':{records:[{sequence:1,event:'demo_boot',level:'info',module:'system',uptime_ms:1000}],next:1,latest:1},'power.get':{power_watts:36,energy_kwh:.28,powers:[30,35,36]},'binding.get':{sensor_transport:'lan',session_protocol:2,max_peers:4,peers:[],members:[],group:'',revision:1},'binding.status.get':{average:{valid:true,sample_count:1,configured_count:1,temperature:25,humidity:48,pm25:18,formaldehyde:.025},peers:[],members:[],linkage_status:'disabled',clock_valid:true,available:0,automatic_on:false,automatic_speed:0},'linkage.get':{hysteresis_enabled:0,fallback_speed:30,enabled:0,mode:1,metrics:1,on_metrics:1,off_metrics:1,statistic:0,on_enabled:0,off_enabled:0,on_all:0,off_all:1,fixed_speed:60,min_speed:20,max_speed:100,debounce_seconds:15,min_switch_seconds:60,on_pm:50,off_pm:35,on_hcho:.1,off_hcho:.08,target_pm:35,target_hcho:.08,low_pm:35,high_pm:150,low_hcho:.08,high_hcho:.3,kp:20,ki:.02,kd:0,revision:1},'light_effect.get':{effect:0,speed:5,segments:1,follow_fan:0,quality_pm:35,quality_hcho:.08,segment:[{source:0,display:2,minimum:-10,maximum:50,suitable_low:18,suitable_high:26,colors:[[0,0,255],[0,255,0],[255,0,0]]}],revision:1},'wifi.scan.get':{scanning:false,networks:[{ssid:'Demo Wi-Fi',rssi:-40,security:3}]},'ota.sources.get':{sources:['github','cn','global']},'ota.check.get':{state:'idle',available:false}};
 let nextScheduleId=1;
 let display={revision:1,selected_source:'original',double_click:'none',lanes:[0,1].map(slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}}))};
 const leases={};
 let presentation=null,displayProfile='dual';
 const formattedLeases={};
 function profileRead(){
  const f=window.M1DisplayFormat;
  const config=displayProfile==='formatted'?presentation:{revision:display.revision,selected_source:display.selected_source,double_click:display.double_click,
   lanes:display.lanes.map(lane=>{const glyph=lane.scale===1&&(lane.slot===0&&lane.metric==='formaldehyde'||lane.slot===1&&lane.metric==='pm25');
    return {slot:lane.slot,source:lane.source,device_id:lane.device_id,metric:lane.metric,unit:lane.unit,ttl_seconds:lane.ttl_seconds,
     display:{mode:lane.slot?'integer':lane.scale===1000?'milli':lane.decimals===1?'decimal_1':lane.decimals===2?'decimal_2':'integer',show_label:glyph,show_unit:glyph},
     color:lane.color.mode==='fixed'?{mode:'fixed',lamps:f.uniformLamps(lane.color.value)}:structuredClone(lane.color)};})};
  return {schema:4,...structuredClone(config),runtime:{profile:displayProfile,selected_source:config.selected_source,mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:config.lanes.map(lane=>{
   const lease=(displayProfile==='formatted'?formattedLeases:leases)[lane.slot],age=lease?Math.max(0,performance.now()-lease.started):0,expired=lease&&age>=lease.ttl_seconds*1000;
   if(displayProfile==='formatted'&&lane.source==='api'){
    const valid=!!lease&&!expired,format=valid?Number(lease.decimal)|(lease.show_label?2:0)|(lease.show_unit?4:0):null;
    return {slot:lane.slot,valid,value:valid?Math.fround(lease.decimal?lease.number/100:lease.number):null,unit:valid&&lease.show_unit?(lane.slot?'µg/m³':'mg/m³'):'',
     age_ms:lease?Math.floor(age):null,remaining_ttl_seconds:valid?Math.max(0,Math.ceil(lease.ttl_seconds-age/1000)):0,effective:false,reason:expired?'stale':valid?'ok':'missing',
     number:valid?lease.number:null,format,lamps:valid?structuredClone(lease.lamps):null,confirmed:false};
   }
   let value=lane.source==='api'&&!expired?lease?.value:lane.source==='local'?state[lane.metric]:null;
   if(!Number.isFinite(value))value=null;else value=Math.fround(value);
   const encoded=value!==null&&f.metricValid(lane.metric,value)?f.encode(lane.display,lane.slot,value):null,valid=!!encoded;
   const lamps=!valid?null:lease?.lamps|| (lane.color.mode==='fixed'?lane.color.lamps:f.uniformLamps(value<lane.color.low?'green':value<lane.color.high?'yellow':'red'));
   return {slot:lane.slot,valid,value:valid?value:null,unit:lane.unit,age_ms:lease?Math.floor(age):valid?0:null,
    remaining_ttl_seconds:valid?(lane.source==='api'?Math.max(0,Math.ceil(lease.ttl_seconds-age/1000)):lane.ttl_seconds):0,
    effective:false,reason:lane.source==='none'?'disabled':expired?'stale':valid?'ok':value===null?'missing':'invalid',
    number:valid?encoded.number:null,format:valid?encoded.format:null,lamps:lamps&&structuredClone(lamps),confirmed:false};
  })}};
 }
 function screenRead(){
  if(displayProfile==='formatted')return {revision:display.revision,selected_source:'original',double_click:'none',lanes:[0,1].map(slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}})),
   runtime:{profile:'legacy',selected_source:'original',mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:[0,1].map(slot=>({slot,valid:false,value:null,unit:'',age_ms:null,remaining_ttl_seconds:0,effective:false,reason:'disabled',number:null,format:null,color:null,confirmed:false}))}};
  const units={temperature:'°C',humidity:'%',pm25:'µg/m³',formaldehyde:'mg/m³',co2:'ppm',pressure:'Pa'};
  return {...structuredClone(display),runtime:{profile:'dual',selected_source:display.selected_source,mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:display.lanes.map(lane=>{
   const lease=leases[lane.slot],age=lease?Math.max(0,performance.now()-lease.started):0;
   const expired=lease&&age>=lease.ttl_seconds*1000;
   let value=lane.source==='api'&&!expired?lease?.value:lane.source==='local'&&units[lane.metric]===lane.unit?state[lane.metric]:null;
   if(!Number.isFinite(value))value=null;
   const number=value===null?null:Math.round(value/lane.scale*10**lane.decimals),out=number!==null&&(number<0||number>999),valid=value!==null&&!out;
   const color=!valid?null:lane.color.mode==='fixed'?lane.color.value:value<lane.color.low?'green':value<lane.color.high?'yellow':'red';
   return {slot:lane.slot,valid,value:valid?value:null,unit:lane.unit,age_ms:valid?Math.floor(age):null,
    remaining_ttl_seconds:valid?(lane.source==='api'?Math.max(0,Math.ceil(lease.ttl_seconds-age/1000)):lane.ttl_seconds):0,
    effective:false,reason:lane.source==='none'?'disabled':out?'out_of_range':expired?'stale':valid?'ok':'missing',
    number:valid?number:null,format:valid?lane.decimals:null,color,confirmed:false};
  })}};
 }
 function command(action,p={}){
  const schedule=fixtures['schedules.get'];
  for(const x of schedule.items)if(x.trigger==='countdown'&&x.enabled){x.remaining_seconds=Math.max(0,x.seconds-Math.floor((performance.now()-x.started)/1000));if(!x.remaining_seconds){x.enabled=false;x.state='executed';state.fan_on=false;state.applied_speed=state.percentage=0;state.fan_state='off';}}

  if(model==='a1'&&!state.filter)state.filter={used_seconds:864000,lifetime_hours:4320,remaining_percent:95,replacement_due:false};
  if(model==='a1'&&action.startsWith('filter.')){
   if(action==='filter.reset')state.filter.used_seconds=0;
   if(action==='filter.set')state.filter.lifetime_hours=p.lifetime_hours;
   const f=state.filter;f.remaining_percent=Math.max(0,Math.ceil((1-f.used_seconds/(f.lifetime_hours*3600))*100));f.replacement_due=f.remaining_percent<=10;
   return structuredClone(f);
  }
  if(action==='status.get')return structuredClone(state);
  if(model==='m1'&&action==='display_source.get')return screenRead();
  if(model==='m1'&&action==='display_source.set'){
   if(p.revision!==display.revision)throw Error('busy');
   display={...structuredClone(p),revision:display.revision+1};displayProfile='dual';delete leases[0];delete leases[1];return null;
  }
  if(model==='m1'&&action==='display_data.set'){
   const lane=display.lanes[p.slot];
   if(displayProfile==='formatted'||p.revision!==display.revision||lane?.source!=='api'||p.ttl_seconds>lane.ttl_seconds)throw Error('invalid_params');
   if(p.ttl_seconds===0)delete leases[p.slot];else leases[p.slot]={...structuredClone(p),started:performance.now()};return null;
  }
  if(model==='m1'&&action==='display_profile.get')return profileRead();
  if(model==='m1'&&action==='display_profile.set'){
   if(p.revision!==display.revision)throw Error('busy');
   display.revision++;presentation={...structuredClone(p),revision:display.revision};displayProfile='formatted';
   presentation.lanes.forEach(lane=>{if(lane.color.mode==='thresholds'){lane.color.low=Math.fround(lane.color.low);lane.color.high=Math.fround(lane.color.high);}});
   delete formattedLeases[0];delete formattedLeases[1];return profileRead();
  }
  if(model==='m1'&&action==='display_value.set'){
   const lane=presentation?.lanes[p.slot],f=window.M1DisplayFormat;
   if(displayProfile!=='formatted'||p.revision!==display.revision||lane?.source!=='api'||!Number.isInteger(p.ttl_seconds)||p.ttl_seconds<0||p.ttl_seconds>lane.ttl_seconds||
      !f.exact(p,p.ttl_seconds===0?['revision','slot','ttl_seconds']:['revision','slot','ttl_seconds','number','decimal','show_label','show_unit','lamps'])||
      p.ttl_seconds&&(!Number.isInteger(p.number)||p.number<0||p.number>999||typeof p.decimal!=='boolean'||p.slot===1&&p.decimal||
       typeof p.show_label!=='boolean'||typeof p.show_unit!=='boolean'||!f.validLamps(p.lamps)))throw Error('invalid_params');
   if(p.ttl_seconds===0)delete formattedLeases[p.slot];else formattedLeases[p.slot]={...structuredClone(p),started:performance.now()};
   return profileRead();
  }
  if(action==='capabilities.get')return {model,actions,...(model==='a1'?{button_keys:['power','wifi','combination'],schedule_countdown:true}:model==='daikin'?{indicator_rules_supported:true}:{})};
  if(action==='config.get')return structuredClone(state);
  if(action==='config.set'){
   if(Object.hasOwn(p.values||{},'name'))customName=true;
   const names=p.values?.names||p.values?.socket_names;
   if(Array.isArray(names))names.forEach((name,i)=>{if(name!==state.socket_names[i])customSockets.add(i);});
   if(model==='daikin'&&p.section==='indicator_rules'){state.indicator_rules=structuredClone(p.values);state.indicator_rules_custom=true;}
   else Object.assign(state,p.values||{});
   if(p.values?.names)state.socket_names=p.values.names;
  }
  if(action==='outlet.set'){state.socket_states[p.index]=p.toggle?!state.socket_states[p.index]:!!p.on;}
  if(action==='display.set')state.brightness_requested=Math.round(p.brightness/25);
  if(action==='fan.mode.set'||action==='fan.mode.toggle'){
   state.fan_mode=action==='fan.mode.toggle'?(state.fan_mode==='auto'?'manual':'auto'):p.mode;
   fixtures['linkage.get'].enabled=Number(state.fan_mode==='auto');
  }
  if(action==='fan.set'){
   if(p.mode)state.fan_mode=p.mode;
   if(p.speed!=null){state.fan_on=p.speed>0;if(p.speed>0){if(state.fan_mode==='auto')state.auto_max_speed=p.speed;else state.requested_speed=p.speed;}}
   if(p.on!=null)state.fan_on=p.on;
  }
  if(action==='linkage.set'){
   Object.assign(fixtures['linkage.get'],p);state.fan_mode=p.enabled?'auto':'manual';state.auto_max_speed=p.max_speed;
  }
  if(action.startsWith('fan.')||action==='linkage.set'){
   state.speed=state.requested_speed;
   state.percentage=state.applied_speed=state.fan_on?(state.fan_mode==='auto'?Math.max(fixtures['linkage.get'].min_speed,Math.min(state.auto_max_speed,fixtures['linkage.get'].fallback_speed)):state.requested_speed):0;
   state.fan_state=state.fan_on?(state.percentage?'running':'idle'):'off';
  }
  if(action==='light.set'){Object.assign(state,p);if(p.toggle)state.light_on=!state.light_on;}
  if(action==='child_lock.set')state.child_lock=p.toggle?!state.child_lock:!!p.on;
  if(action==='indicator.set'){if(model==='daikin')state.indicator_enabled=!!p.enabled;else state.led_enabled=p.toggle?!state.led_enabled:!!p.on;}
  if(action==='schedules.put'){const item={...p,id:p.id||nextScheduleId++,state:'waiting',remaining_seconds:p.seconds||0,started:performance.now()},i=schedule.items.findIndex(x=>x.id===p.id);if(i>=0)schedule.items[i]=item;else schedule.items.push(item);}
  if(action==='schedules.delete')fixtures['schedules.get'].items=fixtures['schedules.get'].items.filter(x=>x.id!==p.id);
  if(action==='schedules.enable'){const item=fixtures['schedules.get'].items.find(x=>x.id===p.id);if(item){item.enabled=p.enabled;item.state='waiting';item.started=performance.now();item.remaining_seconds=item.seconds||0;}}
  schedule.count=schedule.items.length;
  if(action==='buttons.set'){const list=fixtures['buttons.get'].items;const i=list.findIndex(x=>x.key===p.key&&x.clicks===p.clicks&&x.seconds===p.seconds);if(i>=0)list.splice(i,1);if(p.action!=='none')list.push({...p});}
  if(action.endsWith('.set')&&fixtures[action.replace(/\.set$/,'.get')])fixtures[action.replace(/\.set$/,'.get')]={...fixtures[action.replace(/\.set$/,'.get')],...p};
  if(action==='ota.notes'){const text=t('demo.releaseNotes');fixtures['ota.notes.get']={state:'ready',text,offset:0,next:text.length,total:text.length,busy:false};}
  if(action==='ota.check')fixtures['ota.check.get']={state:'up_to_date',version:state.version,source:p.source,available:false};
  if(action.startsWith('ota.')&&['ota.start','ota.install'].includes(action))state.ota_state='idle';
  return structuredClone(fixtures[action]||{});
 }
 return {state,command};
};
window.PhicommDemo={create,setLanguage};
const model='__MODEL__';if(!['tc1','m1','a1','daikin'].includes(model))return;
const demo=create(model);
window.fetch=async(url,options={})=>{
 if(url!=='/api/v1/command')throw Error(t('demo.networkBlocked'));
 const req=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({code:req.action.endsWith('.get')?'ok':'accepted',data:demo.command(req.action,req.params)})};
};
window.XMLHttpRequest=class{constructor(){this.upload={};}open(){}setRequestHeader(){}send(){this.status=202;this.upload.onprogress?.({lengthComputable:true,loaded:1,total:1});this.onload?.();this.onloadend?.();}};
document.addEventListener('DOMContentLoaded',()=>{
 banner=document.createElement('div');banner.dataset.i18n='demo.deviceBanner';banner.style='padding:8px;text-align:center;background:#c7ed70;color:#1b3028;font-size:12px';document.body.prepend(banner);
 if(window.I18N){I18N.extend(messages);setLanguage(I18N.lang);I18N.onChange(()=>{setLanguage(I18N.lang);window.UI?.reload?.();});}
 else setLanguage(language);
});
})();
