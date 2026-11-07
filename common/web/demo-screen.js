/* G3 simulator uses the production codecs; every write stays in browser memory. */
(()=>{
const clone=value=>structuredClone(value);
window.ScreenDemo={create(state){
 let scene,staged,transaction,appearance,token=0;
 const settings={display:{luminance:20,data_type:1,power_screen_time:2,battery_screen_time:1}};
 let request={token:'',code:0,state:'confirmed'};
 const policy={supported:true,revision:1,applied_revision:1,ceiling:100,external_minutes:5,battery_minutes:1,idle_brightness:8,idle_page:0,plans:[]};
 const page={supported:true,available:true,current:1,count:6,enabled_mask:63,layout_revision:1,request:0,state:'complete',asleep:false};
 const startup={supported:true,auto_resume:true,delay_ms:3000};
 const recovery={available:true,mode:'normal',session:12345,state:'complete',window_ms:0,request:0};
 const module={supported:true,available:true,set_high:true,remaining_ms:0,state:'complete',request:0};
 let weather={config:{enabled:true,provider:'openmeteo',latitude:23.1291,longitude:113.2644,label:'广州',interval:900,verify_tls:false,key_set:false},provider:'openmeteo',location:'广州',text:'Partly cloudy',temperature:26,humidity:65,valid:true};
 let reminders={timezone:480,wake:0,rules:[],notices:[]},generation=0;
 const bytes=data=>btoa(String.fromCharCode(...data)),unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 function init(){
  if(scene)return;
  const title=['时钟','空气质量','变化趋势','天气','提醒事项','外部数据'];
  const widget=(id,p,type,binding,x,y,w,h,label,unit='',extra={})=>({id,page:p,type,binding,x,y,w,h,title:label,unit,source:0,...extra});
  scene=window.ScreenLayout.encode({schema:3,revision:1,pages:title.map((title,i)=>({id:i+1,enabled:true,title})),items:[
   widget(1,0,0,6,0,0,4,4,'时钟'),widget(2,0,1,3,0,4,2,2,'PM2.5','µg/m³'),widget(3,0,1,2,2,4,2,2,'CO₂','ppm'),
   ...[[3,'PM2.5','µg/m³'],[2,'CO₂','ppm'],[0,'温度','°C'],[1,'湿度','%'],[4,'TVOC','ppb']].map(([b,l,u],i)=>widget(4+i,1,1,b,i%2*2,Math.floor(i/2)*2,2,2,l,u)),
   widget(10,2,3,3,0,0,4,2,'PM2.5','µg/m³',{hours:24,points:128}),widget(11,2,3,2,0,2,4,2,'CO₂','ppm',{hours:24,points:128}),widget(12,2,3,4,0,4,4,2,'TVOC','ppb',{hours:24,points:128}),
   widget(13,3,6,6,0,0,4,6,'天气','',{hide_title:1}),widget(14,4,7,6,0,0,4,6,'提醒事项','',{hide_title:1}),
   widget(15,5,2,6,0,0,4,2,'API','',{source:1,text:'外部 API 数据'}),widget(16,5,4,6,0,2,4,4,'用量统计','kWh',{source:1,chart:4,additive:1,series_count:3})]});
  appearance=window.ScreenAppearance.defaults();
 }
 function status(){
  // The cloud loads its embedded device page lazily; defer codec use until then.
  const revision=scene?new DataView(scene.buffer,scene.byteOffset).getUint32(4,true):1;
  Object.assign(state,{hardware_model:'BRY88BBA15G',free_memory:96000,largest_free_block:44000});
  state.screen={extension_supported:true,capabilities:0x1ffffd,layout_revision:revision,mcu_layout_revision:revision,layout_sync:'applied',storage:'owned',
   settings:clone(settings),settings_request:clone(request),brightness:{supported:true,available:true,requested_percent:settings.display.luminance,target_percent:settings.display.luminance,applied_percent:settings.display.luminance,ceiling_percent:100,asleep:false,age_ms:0},
   display:clone(policy),startup:clone(startup),recovery:clone(recovery),page:clone(page),module:clone(module),
   resources:{available:true,external_font:true,fallback:false,state:'ready',glyphs:6863,bytes:1600000,read_mode:'sfc_quad',load_ms:14000},ota:{state:'empty',installable:true,gate:'ready'}};
 }
 const actions=['settings.get','settings.set','layout.get','layout.begin','layout.chunk','layout.commit','appearance.get','appearance.set','display.get','display.set','startup.get','startup.set','page.get','page.set','recovery.get','recovery.hold','recovery.resume','module.get','module.set','resources.get','reminders.get','reminders.configure','reminders.set','reminders.delete','reminders.push','reminders.ack','weather.get','weather.set','weather.refresh','diagnostics.get','diagnostics.start','diagnostics.read','update.get','update.start','update.cancel'].map(a=>'screen.'+a);
 function command(action,p={}){
  init();let result={};
  if(action==='screen.layout.get')return {revision:new DataView(scene.buffer,scene.byteOffset).getUint32(4,true),offset:p.offset||0,total:scene.length,crc:ScreenLayout.crc(scene),bytes:bytes(scene.slice(p.offset||0,(p.offset||0)+(p.limit||512)))};
  if(action==='screen.layout.begin'){
   if(p.total!==9520||p.revision<=new DataView(scene.buffer,scene.byteOffset).getUint32(4,true))throw Error('invalid_params');
   transaction=clone(p);staged=new Uint8Array(p.total);transaction.received=0;
  }else if(action==='screen.layout.chunk'){
   const data=unbase64(p.bytes);if(!staged||p.offset!==transaction.received||p.offset+data.length>staged.length)throw Error('invalid_params');
   staged.set(data,p.offset);transaction.received+=data.length;
  }else if(action==='screen.layout.commit'){
   if(!transaction||p.revision!==transaction.revision||transaction.received!==staged.length||ScreenLayout.crc(staged)!==transaction.crc)throw Error('invalid_params');
   const decoded=ScreenLayout.decode(staged);scene=staged;staged=null;page.count=decoded.pages.length;page.enabled_mask=decoded.pages.reduce((mask,p,i)=>mask|(p.enabled?1<<i:0),0);page.layout_revision=decoded.revision;
   if(!(page.enabled_mask&(1<<(page.current-1))))page.current=decoded.pages.findIndex(p=>p.enabled)+1;
   result={revision:decoded.revision};
  }else if(action==='screen.settings.get')return {settings:clone(settings),saved_settings:clone(settings),snapshot_age_ms:0,request:clone(request),brightness:clone(state.screen.brightness)};
  else if(action==='screen.settings.set'){Object.assign(settings.display,p.display);request={token:'demo-'+(++token),code:0,state:'confirmed'};result={token:request.token};}
  else if(action==='screen.appearance.get')return {supported:true,revision:appearance.revision,applied_revision:appearance.revision,bytes:bytes(ScreenAppearance.encode(appearance))};
  else if(action==='screen.appearance.set'){appearance=ScreenAppearance.decode(unbase64(p.bytes));result={revision:appearance.revision};}
  else if(action==='screen.display.get')return clone(policy);
  else if(action==='screen.display.set'){Object.assign(policy,clone(p),{revision:policy.revision+1,applied_revision:policy.revision+1});result=clone(policy);}
  else if(action==='screen.startup.get')return clone(startup);
  else if(action==='screen.startup.set')Object.assign(startup,p);
  else if(action==='screen.page.get')return clone(page);
  else if(action==='screen.page.set'){
   const enabled=Array.from({length:page.count},(_,i)=>i+1).filter(i=>page.enabled_mask&(1<<(i-1)));
   const next=p.page??enabled[(enabled.indexOf(page.current)+(p.direction==='previous'?enabled.length-1:1))%enabled.length];
   if(!enabled.includes(next))throw Error('invalid_page');page.current=next;page.request++;result={request:page.request};
  }else if(action==='screen.recovery.get')return clone(recovery);
  else if(action==='screen.recovery.hold'||action==='screen.recovery.resume'){recovery.mode=action.endsWith('hold')?'held':'normal';recovery.request++;result={request:recovery.request,session:recovery.session};}
  else if(action==='screen.module.get')return clone(module);
  else if(action==='screen.module.set'){Object.assign(module,p);module.request++;result={request:module.request};}
  else if(action==='screen.resources.get')return clone(state.screen.resources);
  else if(action==='screen.weather.get')return clone(weather);
  else if(action==='screen.weather.set'){Object.assign(weather.config,p);weather.config.key_set=!!p.key&&!p.clear_key;delete weather.config.key;weather.location=weather.config.label;result={};}
  else if(action==='screen.reminders.get')return {...clone(reminders),rules:clone(reminders.rules.slice(p.offset||0,(p.offset||0)+8)),notices:clone(reminders.notices.slice(p.offset||0,(p.offset||0)+8))};
  else if(action==='screen.reminders.configure'){reminders.timezone=p.timezone;reminders.wake=p.wake;}
  else if(action==='screen.reminders.set'){reminders.rules=reminders.rules.filter(r=>r.id!==p.id);reminders.rules.push(clone(p));}
  else if(action==='screen.reminders.delete')reminders.rules=reminders.rules.filter(r=>r.id!==p.id);
  else if(action==='screen.reminders.push')reminders.notices.push({...clone(p),id:++token,unread:true});
  else if(action==='screen.reminders.ack'){const n=reminders.notices.find(n=>n.id===p.id);if(n)n.unread=false;}
  else if(action==='screen.diagnostics.start'){generation++;result={request:generation};}
  else if(action==='screen.diagnostics.get'||action==='screen.diagnostics.read')return {supported:true,available:true,ready:true,request:generation,generation,status:0,active:false,waiting:false,frame_period_us:20000,flush_count:22,flush_total_us:140000,flush_max_us:8000,elapsed_us:680000,monitor_count:1,monitor_total_ms:680,records:[],total:0};
  else if(action==='screen.update.get')return {ota:clone(state.screen.ota)};
  else if(!actions.includes(action))throw Error('unsupported');
  status();return result;
 }
 status();return {status,command,actions};
}};
})();
