/* BRY88BBA15G screen editor; shared authentication, command owner and UI. */
(()=>{
'use strict';
const {h,fieldRow,run}=UI,{t}=I18N,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const types=['clock','value','text','line','bar','pie','weather','reminders'];
const {encode,decode,crc,txt}=window.ScreenLayout;
const isChart=it=>[3,4,5].includes(it.type),num=v=>Number.isInteger(v),copy=o=>UI.clone(o);
const b64=data=>btoa(String.fromCharCode(...data)),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const root=document.querySelector('#screenEditor');if(!root)return;
const A=window.ScreenAppearance;let appearance=A.defaults(),appearanceDirty=false,appearanceBase=0,appearanceBusy=false,customPreview=null,savedSceneCrc=0,savedAppearanceCrc=crc(A.encode(appearance));
const appearanceSupported=()=>!!(lastStatus?.capabilities&512);
const hasMultiUnits=it=>isChart(it)&&it.binding!==6&&(it.binding===4||([1,2].includes(it.chart)&&new Set([it.binding,it.binding2,...(it.series_count===3?[it.binding3]:[])]).size>1));
let scene=null,page=0,selected=null,lastStatus=null,dirty=false,loading=false,history=[],editing=false,baseRevision=0,deviceKey=location.host;
const info=h('p',{class:'help',id:'screenSync'}),draft=h('p',{class:'help',id:'screenDraft','aria-live':'polite'});
const button=(key,fn,props={})=>h('button',{type:'button',class:'btn',i18n:key,onclick:e=>run(e.currentTarget,fn),...props});
const quietButton=(key,fn,props={})=>button(key,fn,{...props,onclick:e=>run(e.currentTarget,fn,null)});
const input=(value,type='text',props={})=>h('input',{type,value,...props});
const select=(items,value)=>h('select',{},items.map(([v,key])=>h('option',{value:String(v),selected:String(v)===String(value),i18n:key})));
const section=(key,...kids)=>h('details',{class:'card stack'},h('summary',{},h('b',{i18n:key})),...kids);
const displayFields=['luminance','data_type','power_screen_time','battery_screen_time'];
const validDisplay=d=>d&&displayFields.every((k,i)=>num(d[k])&&d[k]>=0&&d[k]<=[100,1,2,2][i]);
let brightnessData=null,brightnessDirty=false,brightnessSaving=false,brightnessLoading=false,brightnessMessage='',brightnessTimer;
const brightnessInput=input(10,'range',{id:'screenBrightness',min:0,max:100,step:1,disabled:true}),brightnessValue=h('output',{id:'screenBrightnessValue',for:'screenBrightness'},'10%'),brightnessReadback=h('p',{class:'help',id:'screenBrightnessReadback','aria-live':'polite'}),brightnessLimit=h('p',{class:'help',id:'screenBrightnessLimit'}),brightnessNotice=h('p',{class:'help',id:'screenBrightnessState',role:'status'});
function renderBrightness(){
 const d=brightnessData?.settings?.display,b=brightnessData?.brightness;
 brightnessInput.disabled=brightnessLoading||!validDisplay(d);brightnessSave.disabled=brightnessInput.disabled||brightnessSaving;
 if(validDisplay(d)&&!brightnessDirty&&!brightnessSaving)brightnessInput.value=d.luminance;
 brightnessValue.textContent=brightnessInput.value+'%';
 brightnessReadback.textContent=b?.available?t('screen.brightness_actual',{requested:b.requested_percent,target:b.target_percent??b.requested_percent,applied:b.applied_percent,state:t(b.asleep?'screen.brightness_asleep':'screen.brightness_awake')}):t('screen.brightness_unreported');
 brightnessLimit.textContent=b?.available?t('screen.brightness_ceiling',{value:b.ceiling_percent}):'';
 const state=brightnessData?.request?.state;
 brightnessNotice.textContent=brightnessMessage?t(brightnessMessage):brightnessDirty?t('screen.unsaved'):['pending','rejected','timeout'].includes(state)?t('screen.brightness_'+state):'';
}
function applyBrightnessData(data){brightnessData=data;renderBrightness();}
async function loadBrightness(){
 if(brightnessLoading||brightnessSaving)return;clearTimeout(brightnessTimer);brightnessLoading=true;renderBrightness();
 try{const data=await command('screen.settings.get');brightnessDirty=false;brightnessMessage='';applyBrightnessData(data);}
 finally{brightnessLoading=false;renderBrightness();}
}
async function saveBrightness(){
 clearTimeout(brightnessTimer);if(brightnessSaving||brightnessLoading||!brightnessDirty)return;
 brightnessSaving=true;let failed=false;brightnessMessage='screen.brightness_pending';renderBrightness();
 try{
  // Coalesce input while a controller acknowledgement is pending.
  do{
   const value=Number(brightnessInput.value);if(!num(value)||value<0||value>100)throw Error(t('screen.invalid'));
   const before=await command('screen.settings.get'),current=before.settings?.display;
   if(!validDisplay(current))throw Error(t('screen.brightness_load_first'));
   const display=Object.fromEntries(displayFields.map(k=>[k,k==='luminance'?value:current[k]]));
   const receipt=await command('screen.settings.set',{display});if(!receipt.token)throw Error(t('screen.brightness_unconfirmed'));
   const until=Date.now()+12000;let confirmed=false;
   while(Date.now()<until){
    const result=await command('screen.settings.get'),request=result.request||{};applyBrightnessData(result);
    if(request.token&&request.token!==receipt.token)throw Error(t('screen.brightness_changed'));
    if(request.state==='rejected'||request.code>0)throw Error(t('screen.brightness_rejected'));
    if(request.state==='timeout')throw Error(t('screen.brightness_timeout'));
    const actual=result.settings?.display,b=result.brightness;
    if(request.code===0&&displayFields.every(k=>actual?.[k]===display[k])&&result.snapshot_age_ms<15000&&(!b?.supported||(b.available&&b.requested_percent===value))){confirmed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,300));
   }
   if(!confirmed)throw Error(t('screen.brightness_timeout'));
   brightnessDirty=Number(brightnessInput.value)!==value;
  }while(brightnessDirty);
  brightnessMessage='screen.brightness_confirmed';
 }catch(error){failed=true;brightnessMessage='screen.brightness_unconfirmed';throw error;}
 finally{brightnessSaving=false;if(failed)clearTimeout(brightnessTimer);renderBrightness();}
}
const brightnessSave=button('common.save',saveBrightness,{id:'screenBrightnessSave',class:'btn primary',disabled:true,onclick:e=>run(e.currentTarget,saveBrightness).finally(renderBrightness)});
const queueBrightness=()=>{brightnessDirty=true;brightnessMessage='';renderBrightness();clearTimeout(brightnessTimer);brightnessTimer=setTimeout(()=>run(null,saveBrightness),350);};
brightnessInput.oninput=queueBrightness;brightnessInput.onchange=()=>run(null,saveBrightness);
const brightness=section('screen.brightness',fieldRow('screen.brightness_level',h('div',{class:'row'},brightnessInput,brightnessValue)),brightnessReadback,brightnessLimit,h('div',{class:'row'},button('screen.load',loadBrightness,{id:'screenBrightnessLoad'}),brightnessSave),brightnessNotice);
brightness.id='screenBrightnessSettings';
I18N.onChange(renderBrightness);
let remotePageData=null,remotePageBusy=false,remotePageChosen=false;
const remotePageSelect=h('select',{id:'screenRemotePage'}),remotePageInfo=h('p',{id:'screenRemotePageInfo',role:'status'});
function renderRemotePage(){
 const d=remotePageData,supported=!!(lastStatus?.capabilities&1048576),ready=supported&&d?.available;
 remotePagePrevious.disabled=remotePageNext.disabled=remotePageGo.disabled=remotePageSelect.disabled=remotePageBusy||!ready;
 remotePageLoad.disabled=remotePageBusy||!supported;
 const mask=ready?d.enabled_mask:0,count=ready?d.count:0,key=mask+':'+count;
 if(remotePageSelect.dataset.pages!==key){
  const chosen=remotePageSelect.value;remotePageSelect.replaceChildren();
  for(let i=1;i<=count;i++)if(mask&(1<<(i-1)))remotePageSelect.append(h('option',{value:String(i)},String(i)));
  remotePageSelect.dataset.pages=key;if(chosen)remotePageSelect.value=chosen;
 }
 if(ready&&(!remotePageChosen||!remotePageSelect.value))remotePageSelect.value=String(d.current);
 remotePageInfo.textContent=remotePageBusy?t('screen.remote_pending'):ready?t('screen.remote_current',{page:d.current}):t(supported?'screen.remote_unavailable':'screen.remote_unsupported');
}
async function loadRemotePage(){remotePageData=await command('screen.page.get');renderRemotePage();}
async function changeRemotePage(params){
 if(remotePageBusy)return;remotePageBusy=true;renderRemotePage();
 try{
  const receipt=await command('screen.page.set',params),until=Date.now()+6000;
  if(!receipt.request)throw Error(t('screen.remote_timeout'));
  while(Date.now()<until){
   await new Promise(resolve=>setTimeout(resolve,150));remotePageData=await command('screen.page.get');
   if(remotePageData.request!==receipt.request)throw Error(t('screen.remote_changed'));
   if(remotePageData.state==='complete'&&remotePageData.available){remotePageChosen=false;return;}
   if(['timeout','invalid_page','mcu_busy'].includes(remotePageData.state))throw Error(t('screen.remote_'+remotePageData.state));
  }
  throw Error(t('screen.remote_timeout'));
 }finally{remotePageBusy=false;renderRemotePage();}
}
remotePageSelect.onchange=()=>remotePageChosen=true;
const remotePagePrevious=quietButton('screen.remote_previous',()=>changeRemotePage({direction:'previous'}),{id:'screenRemotePrevious',disabled:true}),
 remotePageNext=quietButton('screen.remote_next',()=>changeRemotePage({direction:'next'}),{id:'screenRemoteNext',disabled:true}),
 remotePageGo=quietButton('screen.remote_go',()=>changeRemotePage({page:Number(remotePageSelect.value)}),{id:'screenRemoteGo',disabled:true}),
 remotePageLoad=quietButton('screen.load',loadRemotePage,{id:'screenRemoteLoad',disabled:true});
const remotePageSection=section('screen.remote_title',remotePageInfo,h('div',{class:'row'},remotePagePrevious,remotePageNext,remotePageSelect,remotePageGo,remotePageLoad));
I18N.onChange(renderRemotePage);
let moduleData=null,moduleBusy=false;
const moduleSeconds=input(10,'number',{id:'screenModuleSeconds',min:1,max:60,step:1}),moduleReadback=h('p',{class:'help',id:'screenModuleReadback','aria-live':'polite'});
function renderModule(){
 moduleControl.hidden=!moduleData?.supported;
 moduleHigh.disabled=moduleLow.disabled=moduleBusy||!moduleData?.available;
 moduleReadback.textContent=moduleBusy?t('screen.module_pending'):moduleData?.available?t('screen.module_status',{level:t(moduleData.set_high?'screen.module_high':'screen.module_low'),seconds:Math.ceil(moduleData.remaining_ms/1000),frames:moduleData.valid_frames}):t('screen.module_no_report');
}
async function setModule(high){
 const seconds=Number(moduleSeconds.value);if(!num(seconds)||seconds<1||seconds>60)throw Error(t('screen.invalid'));
 moduleBusy=true;renderModule();
 try{
  const receipt=await command('screen.module.set',{set_high:high,duration_ms:high?0:seconds*1000});
  if(!receipt.request)throw Error(t('screen.module_timeout'));
  let confirmed=false;
  for(let i=0;i<12;i++){
   await new Promise(r=>setTimeout(r,300));const data=await command('screen.module.get');moduleData=data;
   if(data.request!==receipt.request)throw Error(t('screen.module_timeout'));
   if(data.state==='complete'&&data.available&&data.set_high===high){confirmed=true;break;}
   if(['timeout','mcu_rejected'].includes(data.state))break;
  }
  if(!confirmed)throw Error(t('screen.module_timeout'));
 }finally{moduleBusy=false;renderModule();}
}
const moduleHigh=button('screen.module_high',()=>setModule(true),{id:'screenModuleHigh',disabled:true}),moduleLow=button('screen.module_low',()=>setModule(false),{id:'screenModuleLow',disabled:true});
const moduleControl=section('screen.module_control',fieldRow('screen.module_duration',moduleSeconds),h('div',{class:'row'},moduleHigh,moduleLow),moduleReadback);
moduleControl.id='screenModuleControl';moduleControl.hidden=true;I18N.onChange(renderModule);
const pageSelect=h('select',{id:'screenPage'}),pageTitle=input('','text',{id:'screenPageTitle',maxLength:31}),pageEnabled=input('','checkbox',{id:'screenPageEnabled'});
const screenBox=(x,y,w,hh)=>`left:${x/480*100}%;top:${y/854*100}%;width:${w/480*100}%;height:${hh/854*100}%`;
// Matched to the current MCU include/ui_layout.h and the LVGL design preview.
const screenGeometry={margin:16,top:66,column:114,row:130,gap:8};
const componentBox=it=>screenBox(screenGeometry.margin+it.x*screenGeometry.column,screenGeometry.top+it.y*screenGeometry.row,it.w*screenGeometry.column-screenGeometry.gap,it.h*screenGeometry.row-screenGeometry.gap);
const grid=h('div',{class:'screen-grid',id:'screenGrid',role:'group','aria-label':t('screen.preview')}),itemForm=h('div',{class:'stack',id:'screenComponent'});
const layoutKey=()=>`iotcloud.screen.layout.v3.${deviceKey}`;
function storeDraft(){try{localStorage.setItem(layoutKey(),JSON.stringify({v:3,base:baseRevision,scene,appearance,appearanceBase,appearanceDirty}));draft.textContent=t(dirty||appearanceDirty?'screen.local_saved':'screen.saved');}catch{draft.textContent=t('screen.storage_error');}}
function localDraft(){try{const raw=localStorage.getItem(layoutKey());if(!raw)return null;const d=JSON.parse(raw);if(d.v!==3||!num(d.base))throw Error();encode(d.scene);if(d.appearance)A.validate(d.appearance);return d;}catch{draft.textContent=t('screen.storage_error');return null;}}
function change(mutator){
 if(!scene||appearanceBusy)return false;const before={scene:copy(scene),appearance:copy(appearance),dirty,appearanceDirty},id=selected?.id;
 try{mutator();encode(scene);A.validate(appearance);}catch(e){scene=before.scene;appearance=before.appearance;selected=scene.items.find(it=>it.id===id)||null;UI.toast(e.message,true);draw();return false;}
 dirty=crc(encode(scene))!==savedSceneCrc;appearanceDirty=appearanceSupported()&&crc(A.encode(appearance))!==savedAppearanceCrc;
 history.push(before);if(history.length>20)history.shift();selected=scene.items.find(it=>it.id===(selected?.id??id))||null;storeDraft();draw();return true;
}
function undo(){if(!history.length||appearanceBusy)return;const before=history.pop();scene=before.scene;appearance=before.appearance;dirty=crc(encode(scene))!==savedSceneCrc;appearanceDirty=appearanceSupported()&&crc(A.encode(appearance))!==savedAppearanceCrc;page=Math.min(page,scene.pages.length-1);selected=null;storeDraft();draw();}
const undoButton=button('screen.undo',undo,{id:'screenUndo'});
const save=button('screen.save_device',async()=>{
 if(!scene||appearanceBusy)return;const candidate=copy(scene);candidate.revision=Math.max(scene.revision,lastStatus?.layout_revision||0)+1;const wire=encode(candidate);
 if(candidate.items.some(it=>it.points)&&!(lastStatus?.capabilities&65536))throw Error(t('screen.points_unsupported'));
 if(candidate.items.some(it=>it.hide_title)&&!(lastStatus?.capabilities&8192))throw Error(t('screen.hide_title_unsupported'));
 if(candidate.items.some(it=>(isChart(it)&&it.h<4)||(it.type===1&&it.h===1))&&!(lastStatus?.capabilities&256))throw Error(t('screen.responsive_unsupported'));
 if(candidate.items.some(hasMultiUnits)&&!(lastStatus?.capabilities&4096))throw Error(t('screen.chart_upgrade'));
 if(candidate.items.some(it=>it.value_mode)&&!(lastStatus?.capabilities&128))throw Error(t('screen.value_mode_unsupported'));
 await command('screen.layout.begin',{revision:candidate.revision,total:wire.length,crc:crc(wire)});
 for(let a=0;a<wire.length;a+=512)await command('screen.layout.chunk',{offset:a,bytes:b64(wire.slice(a,a+512))});
 await command('screen.layout.commit',{revision:candidate.revision});const selectedId=selected?.id;scene=candidate;selected=scene.items.find(it=>it.id===selectedId)||null;baseRevision=candidate.revision;savedSceneCrc=crc(wire);dirty=false;if(appearanceDirty)await saveAppearance();storeDraft();draw();
},{id:'screenSave',class:'btn primary'});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let palette=['#b7dca5','#8ebfcd','#dcb981'];const readings=['23.6','48','628','12','优','--','36'];
const unitNames=['°C','%','ppm','µg/m³','ppb','','W'];
const stockLabels={'时钟':'Clock','空气数据':'Air quality','变化趋势':'Trends','户外天气':'Outdoor weather','提醒事项':'Reminders','外部数据':'External data','外部统计':'External statistics','组合概览':'Overview','温度':'Temperature','湿度':'Humidity','甲醛':'HCHO','优':'Good','良':'Fair','差':'Poor'};
const screenText=s=>appearance.language==='en'?(stockLabels[s]||s):s;
const bindingName=b=>b===6?t('screen.external'):t('m.'+['temperature','humidity','co2','pm25','tvoc','formaldehyde'][b]);
function previewChart(it){
 const pc=A.resolve(appearance),wc=A.widgetColors(appearance,it);palette=[pc.chartA,pc.chartB,pc.chartC];
 const mode=it.chart??0,count=[0,3].includes(mode)?1:Math.max(2,it.series_count||2),w=it.w*screenGeometry.column-screenGeometry.gap,hh=it.h*screenGeometry.row-screenGeometry.gap,compact=it.h<4,x0=compact?119:94,y0=compact?20:it.hide_title?20:72,x1=w-12,y1=compact?hh-48:hh-140;
 const vals=Array.from({length:count},(_,k)=>Array.from({length:it.binding!==6?(it.points||32):12},(_,i)=>Math.round(30+k*18+15*Math.sin(i*.7+k)))),max=[4,5].includes(mode)?220:100;
 const xx=i=>x0+(x1-x0)*i/(vals[0].length-1),yy=v=>y1-(y1-y0)*v/max,base=Array(vals[0].length).fill(0);let shapes='';
 if(mode===6){let a=-90;const total=vals.reduce((s,v)=>s+v.at(-1),0);for(let k=0;k<count;k++){const b=a+vals[k].at(-1)/total*359.999,point=angle=>[(compact?(x0+x1)/2:w/2)+(compact?68:95)*Math.cos(angle*Math.PI/180),(compact?y0+80:y0+105)+(compact?68:95)*Math.sin(angle*Math.PI/180)],p=point(a),q=point(b);shapes+=`<path d="M${p} A${compact?68:95} ${compact?68:95} 0 ${b-a>180?1:0} 1 ${q}" fill="none" stroke="${palette[k]}" stroke-width="${compact?24:38}"/>`;a=b;}}
 else for(let k=0;k<count;k++){
  const v=vals[k],top=v.map((n,i)=>n+base[i]);
  if(mode===3||mode===4){for(let i=0;i<vals[0].length;i++)shapes+=`<rect x="${xx(i)-7}" y="${yy(mode===4?top[i]:v[i])}" width="14" height="${yy(mode===4?base[i]:0)-yy(mode===4?top[i]:v[i])}" fill="${palette[k]}"/>`;}
  else if(mode===5)shapes+=`<polygon points="${top.map((n,i)=>`${xx(i)},${yy(n)}`).join(' ')} ${base.map((n,i)=>`${xx(i)},${yy(n)}`).reverse().join(' ')}" fill="${palette[k]}" fill-opacity=".65"/>`;
  else shapes+=`<polyline points="${v.map((n,i)=>`${xx(i)},${yy(n)}`).join(' ')}" fill="none" stroke="${palette[k]}" stroke-width="4" ${mode===2&&k?'stroke-dasharray="8 6"':''}/>`;
  if([4,5].includes(mode))v.forEach((n,i)=>base[i]+=n);
 }
 const labels=vals.map((v,k)=>[4,5,6].includes(mode)?[t('screen.lighting'),t('screen.cooling'),t('screen.appliances')][k]:bindingName([it.binding,it.binding2??0,it.binding3??0][k]));
 const unit=k=>[4,5,6].includes(mode)?'W':unitNames[[it.binding,it.binding2??0,it.binding3??0][k]];
 const axes=new Set(Array.from({length:count},(_,k)=>unit(k))).size;
 const legendColor=k=>appearance.items[it.id]?.body||palette[k],valueColor=k=>appearance.items[it.id]?.value||palette[k];
 const legend=compact?(count===1?`<text x="12" y="116" font-size="48" fill="${valueColor(0)}">${vals[0].at(-1)}</text><text x="12" y="162" font-size="24" fill="${wc.unit}">${esc(unit(0))}</text>`:vals.map((v,k)=>`<text x="12" y="${70+k*(hh-62)/count}" font-size="20" fill="${legendColor(k)}">${esc(labels[k])}</text><text x="12" y="${96+k*(hh-62)/count}" font-size="20" fill="${wc.value}">${v.at(-1)} ${esc(unit(k))}</text>`).join('')):vals.map((v,k)=>`<text x="12" y="${hh-86+k*32}" font-size="${axes>2?24:28}" fill="${legendColor(k)}">${esc(labels[k])} ${v.at(-1)} ${esc(unit(k))}${axes>2?' [0–'+max+']':''}</text>`).join('');
 return `<svg data-unit-axes="${axes}" viewBox="0 0 ${w} ${hh}" aria-hidden="true" data-chart-layout="${compact?'strip':'full'}"><text x="12" y="38" fill="${wc.title}" font-size="${compact?28:32}">${esc(it.hide_title?'':compact?screenText(it.title).slice(0,12):screenText(it.title))}</text>${mode!==6?`<path d="M${x0} ${y0}V${y1}H${x1}" stroke="${pc.line}" fill="none"/>${compact?'':`<text x="12" y="${y0+20}" font-size="28" fill="${wc.unit}">${max}</text><text x="12" y="${y1}" font-size="28" fill="${wc.unit}">0</text>`}`:''}${shapes}${legend}<text x="${x1}" y="${compact?hh-12:hh-112}" text-anchor="end" font-size="24" fill="${wc.unit}">${it.hours||24}h</text></svg>`;
}
const fontContext=document.createElement('canvas').getContext('2d');
function textWidth(text,size){if(!fontContext)return text.length*size*.65;fontContext.font=`${size}px "DejaVu Sans",sans-serif`;return fontContext.measureText(text).width;}
function numberPreview(it,title,unit,value){
 const ow=it.w*screenGeometry.column-screenGeometry.gap,oh=it.h*screenGeometry.row-screenGeometry.gap,w=ow-24,hh=oh-24,row=it.w>it.h,scale=Math.min(it.w,it.h),ts=row?32:Math.min(64,16*scale),us=row?24:Math.min(48,12*scale);
 const node=h('div',{class:'screen-number-content','data-value-layout':row?'row':'square'});
 const part=(cls,text,x,y,width,height,size,align='left')=>h('span',{class:cls,style:`position:absolute;left:${(x+12)/ow*100}%;top:${(y+12)/oh*100}%;width:${width/ow*100}%;height:${height/oh*100}%;font-size:${size/480*100}cqw;line-height:1.12;text-align:${align};margin:0;letter-spacing:0`},text);
 const fit=(target,width,height)=>{while(target>24&&(textWidth(value,target)>width||target*1.12>height))target-=4;return target;};
 const accent=[2,3,4].includes(it.binding)?' accent':'';
 if(row){const left=it.hide_title?(unit?w/4:0):Math.floor(w*2/5),gap=left?12:0,fs=fit(it.h===1?80:144,w-left-gap,hh);node.append(part('screen-widget-label',title,0,0,left,40,ts),part('screen-widget-unit',unit,0,it.hide_title?(hh-32)/2:48,left,32,us),part('screen-widget-value'+accent,value,left+gap,(hh-fs*1.12)/2,w-left-gap,fs*1.12,fs,'right'));}
 else {const uw=unit?Math.min(w/2,textWidth(unit,us)):0,gap=uw?4*scale:0,header=it.hide_title?(unit?us*1.12:0):ts*1.25,fs=fit(Math.min(192,48*scale),w,hh-header-12);node.append(part('screen-widget-label',title,0,0,w-uw-gap,header,ts),part('screen-widget-unit',unit,w-uw,header-us*1.12,uw,us*1.12,us),part('screen-widget-value'+accent,value,0,header+(hh-header-fs*1.12)/2,w,fs*1.12,fs,'center'));}
 return node;
}
function weatherIcon(){const p=A.resolve(appearance);return `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke-width="4" stroke-linecap="round"><circle cx="30" cy="30" r="19" stroke="${p.chartC}"/><path d="M32 77a20 20 0 1 1 5-39 25 25 0 0 1 48 12 14 14 0 0 1-7 27Z" stroke="${p.value}"/></g></svg>`;}
function weatherPreview(it){
 const full=it.w===4&&it.h===6,icon=h('div',{class:'screen-weather-icon'});icon.innerHTML=weatherIcon();
 const body=h('div',{class:'screen-weather'+(full?' full':'')},h('div',{class:'screen-weather-heading'},h('span',{class:'screen-widget-label'},it.hide_title?'':screenText(it.title)),...(!full?[icon]:[])),...(full?[icon]:[]),h('strong',{class:'screen-weather-temperature'},'26°'),h('span',{class:'screen-weather-condition'},appearance.language==='en'?'Partly cloudy':'晴间多云'));
 if(full){body.append(h('div',{class:'screen-weather-summary'},...[['screen.feels','27°'],['m.humidity','62%'],['screen.wind','2.4']].map(([key,value])=>h('div',{},h('span',{},appearance.language==='en'?({'screen.feels':'Feels like','m.humidity':'Humidity','screen.wind':'Wind'}[key]):({'screen.feels':'体感','m.humidity':'湿度','screen.wind':'风速'}[key])),h('b',{},value)))));for(const [day,value] of [['11-07','23 / 28°'],['11-08','21 / 25°']]){const symbol=h('i',{});symbol.innerHTML=weatherIcon();body.append(h('div',{class:'screen-weather-day'},h('span',{},day),symbol,h('span',{},value)));}}
 else if(it.h>=4)body.append(h('div',{class:'screen-weather-extra'},h('span',{},'11-07'),h('span',{},'23 / 28°')));
 if(it.hide_title){body.classList.add('titleless');const heading=body.querySelector('.screen-weather-heading');if(full)heading?.remove();else heading?.querySelector('.screen-widget-label')?.remove();}
 return body;
}
function preview(it){
 const tvocNumber=it.binding===4&&it.value_mode===1,grade=it.value_mode===2||(it.binding===4&&!tvocNumber),full=it.w===4&&it.h===6,label=h('span',{class:'screen-widget-label'},it.hide_title||(full&&it.title===scene.pages[page].title)?'':screenText(it.title)),value=h('strong',{class:'screen-widget-value'+([2,3,4].includes(it.binding)?' accent':'')},tvocNumber?'375':grade?screenText('优'):readings[it.binding]||'--'),unit=h('span',{class:'screen-widget-unit'},grade?'':tvocNumber?'ppb':it.unit||unitNames[it.binding]||'');
 if(isChart(it)){const svg=h('div',{class:'screen-widget-chart'});svg.innerHTML=previewChart(it);return [svg];}
 if(it.type===0)return [h('strong',{class:'screen-widget-clock'+(it.w<4?' half':'')},'18:42'),h('span',{class:'screen-widget-date'},appearance.language==='en'?'Nov 6 · Fri':'11月6日  周五')];
 if(it.type===1)return [numberPreview(it,it.hide_title?'':screenText(it.title),unit.textContent,value.textContent)];
 if(it.type===2)return [...(it.hide_title?[]:[label]),h('span',{class:'screen-widget-body'},it.text||'--')];
 if(it.type===6)return [weatherPreview(it)];
 return [...(it.hide_title?[]:[label]),h('span',{class:'screen-widget-body'},appearance.language==='en'?'Water the plants':'给植物浇水')];
}
function setGeometry(it,values){const id=it.id;return change(()=>{Object.assign(it,values);selected=scene.items.find(x=>x.id===id);});}
function pointerStart(e,it,resize){
 if(!editing||e.button!==0)return;e.preventDefault();e.stopPropagation();selected=it;
 const el=e.currentTarget.closest('[data-component]'),bounds=grid.getBoundingClientRect(),start={x:it.x,y:it.y,w:it.w,h:it.h},px=e.clientX,py=e.clientY;
 try{el.setPointerCapture(e.pointerId);}catch{}
 el.classList.add('selected');
 const geometry=event=>{const dx=Math.round((event.clientX-px)/bounds.width*480/screenGeometry.column),dy=Math.round((event.clientY-py)/bounds.height*854/screenGeometry.row);return resize?{w:start.w+dx,h:start.h+dy}:{x:start.x+dx,y:start.y+dy};};
 const move=event=>{const candidate={...it,...geometry(event)};el.style.cssText=componentStyle(candidate);};
 const stop=event=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',stop);document.removeEventListener('pointercancel',cancel);setGeometry(it,geometry(event));};
 const cancel=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',stop);document.removeEventListener('pointercancel',cancel);draw();};
 document.addEventListener('pointermove',move);document.addEventListener('pointerup',stop);document.addEventListener('pointercancel',cancel);
}
function draw(){
 if(!scene)return;page=Math.max(0,Math.min(page,scene.pages.length-1));undoButton.disabled=!history.length;
 pageSelect.replaceChildren(...scene.pages.map((p,i)=>h('option',{value:i,selected:i===page},`${i+1} · ${p.title}`)));pageTitle.value=scene.pages[page].title;pageEnabled.checked=scene.pages[page].enabled;editButton.setAttribute('aria-pressed',editing);grid.classList.toggle('editing',editing);
 const clockTop=scene.items.some(it=>it.page===page&&it.type===0&&it.y===0);
 renderAppearance();applyAppearancePreview();
 const enabled=scene.pages.filter(p=>p.enabled).length,railHeight=lastStatus?.capabilities&131072?A.railHeight(appearance):6;
 grid.replaceChildren(h('span',{class:'screen-chrome screen-page-title',style:screenBox(16,Math.max(16,railHeight+2),314,40)},clockTop?'':screenText(scene.pages[page].title)),h('span',{class:'screen-chrome screen-status',style:screenBox(346,16,118,40)},'◔ ▰'));
 let segment=0;scene.pages.forEach((p,i)=>{if(p.enabled){const left=Math.floor(480*segment/enabled),right=Math.floor(480*(++segment)/enabled);grid.append(h('span',{class:'screen-page-dot'+(i===page?' active':''),style:screenBox(left,0,right-left,railHeight)+';opacity:'+(i===page?.9:.2),'aria-hidden':'true'}));}});
 if(editing)for(let i=0;i<24;i++){const cell=h('div',{class:'screen-cell','data-cell':i,style:componentBox({x:i%4,y:Math.floor(i/4),w:1,h:1})});cell.ondragover=e=>e.preventDefault();cell.ondrop=e=>{e.preventDefault();const it=scene.items.find(x=>x.id===Number(e.dataTransfer.getData('text/plain')));if(it)setGeometry(it,{x:i%4,y:Math.floor(i/4)});};grid.append(cell);}
 for(const it of scene.items.filter(it=>it.page===page)){
  const tile=h('div',{role:'button',tabIndex:0,class:'screen-tile'+(it.type===0?' clock-tile':'')+(selected?.id===it.id?' selected':''),draggable:editing,'data-component':it.id,style:componentStyle(it),'aria-label':it.title},...preview(it));
  tile.ondragstart=e=>{if(!editing){e.preventDefault();return;}e.dataTransfer.setData('text/plain',String(it.id));};
  tile.onclick=()=>{selected=it;componentForm();grid.querySelectorAll('.screen-tile').forEach(c=>c.classList.toggle('selected',Number(c.dataset.component)===it.id));};
  tile.onpointerdown=e=>pointerStart(e,it,false);
  tile.onkeydown=e=>{if(!editing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const dx=+(e.key==='ArrowRight')-+(e.key==='ArrowLeft'),dy=+(e.key==='ArrowDown')-+(e.key==='ArrowUp');setGeometry(it,e.shiftKey?{w:it.w+dx,h:it.h+dy}:{x:it.x+dx,y:it.y+dy});grid.querySelector(`[data-component="${it.id}"]`)?.focus();};
  if(editing){const handle=h('span',{class:'screen-resize',role:'img','aria-label':t('screen.resize')},'↘');handle.onpointerdown=e=>pointerStart(e,it,true);tile.append(handle);}grid.append(tile);
 }
 componentForm();renderPolicyPageOptions();
}
function componentForm(){
 itemForm.replaceChildren();if(!selected||selected.page!==page)return;const it=selected;
 const fields={title:input(it.title),unit:input(it.unit),binding:select(['temperature','humidity','co2','pm25','tvoc','formaldehyde'].map((v,i)=>[i,'m.'+v]).concat([[6,'screen.external']]),it.binding)};
 if(it.type!==0){fields.hide_title=input('','checkbox',{checked:!!it.hide_title});}
 if(it.type===1&&[4,6].includes(it.binding))fields.value_mode=select([[0,'screen.mode_auto'],[1,'screen.mode_number'],[2,'screen.mode_grade']],it.value_mode||0);
 for(const k of ['x','y','w','h'])fields[k]=input(it[k],'number',{min:k==='w'?(isChart(it)?4:2):k==='h'?(it.type===1&&it.w===4?1:2):0,max:['x','w'].includes(k)?4:6,step:1});
 if(it.type===2){fields.text=h('textarea',{},it.text||'');}
 if(isChart(it)){
  fields.chart=select(Array.from({length:7},(_,i)=>[i,'screen.chart'+i]),it.chart??0);
  if(it.binding!==6)fields.points=select([0,32,64,128,256].map(n=>[n,n?'screen.points'+n:'screen.points_default']),it.points||0);
  fields.hours=select([1,6,24].map(v=>[v,'screen.hours'+v]),it.hours||24);
  fields.series_count=input(it.series_count||1,'number',{min:1,max:3,step:1});
  fields.binding2=select(['temperature','humidity','co2','pm25','tvoc','formaldehyde'].map((v,i)=>[i,'m.'+v]),it.binding2||0);
  fields.binding3=select(['temperature','humidity','co2','pm25','tvoc','formaldehyde'].map((v,i)=>[i,'m.'+v]),it.binding3||0);
 }
 for(const [key,control] of Object.entries(fields)){
  control.dataset.componentField=key;control.disabled=!editing||(key==='points'&&!(lastStatus?.capabilities&65536))||(key==='hide_title'&&!(lastStatus?.capabilities&8192))||(key==='value_mode'&&!(lastStatus?.capabilities&128));
  control.onchange=()=>change(()=>{it[key]=key==='hide_title'?+control.checked:['title','unit','text'].includes(key)?control.value:Number(control.value);if(key==='binding'&&![4,6].includes(it.binding))it.value_mode=0;if(key==='chart'){it.type=it.chart===3?4:it.chart===6?5:3;if([4,5,6].includes(it.chart)){it.binding=6;it.additive=1;it.series_count=3;it.unit='W';}else{it.additive=0;it.series_count=[1,2].includes(it.chart)?2:1;}}});
  itemForm.append(fieldRow('screen.'+key,control));
 }
 if(it.binding===6)itemForm.append(h('details',{class:'screen-technical'},h('summary',{i18n:'screen.api_details'}),h('p',{class:'help'},t('screen.api_hint',{id:it.id})),isChart(it)?h('p',{class:'help',i18n:'screen.chart_hint'}):''));
 if(appearanceSupported())itemForm.append(componentColors(it));
 itemForm.append(button('common.delete',()=>change(()=>{scene.items=scene.items.filter(x=>x.id!==it.id);delete appearance.items[it.id];selected=null;}),{id:'screenDelete',disabled:!editing}));
}
pageSelect.onchange=()=>{page=Number(pageSelect.value);selected=null;draw();};
pageTitle.onchange=()=>change(()=>{scene.pages[page].title=pageTitle.value;});
pageEnabled.onchange=()=>{const enabled=pageEnabled.checked;if(change(()=>{scene.pages[page].enabled=enabled;}))invalidatePolicyPage(page,false);};
async function loadLayout(){
 if(loading)return;loading=true;try{
  let data=null,revision,expectedCrc;
  for(let a=0;!data||a<data.length;a+=512){const part=await command('screen.layout.get',{offset:a,limit:512});if(!a){if(part.total!==9520)throw Error(t('screen.invalid'));data=new Uint8Array(part.total);revision=part.revision;expectedCrc=part.crc;}
   if(part.revision!==revision||part.total!==data.length||part.crc!==expectedCrc||part.offset!==a)throw Error(t('screen.changed'));const chunk=unb64(part.bytes);if(chunk.length!==Math.min(512,data.length-a))throw Error(t('screen.invalid'));data.set(chunk,a);
  }
  if(crc(data)!==expectedCrc)throw Error(t('screen.invalid'));scene=decode(data);baseRevision=revision;savedSceneCrc=crc(data);
  if(appearanceSupported()){const ap=await command('screen.appearance.get');appearance=A.decode(unb64(ap.bytes));appearanceBase=ap.revision;savedAppearanceCrc=crc(A.encode(appearance));}
  appearanceDirty=false;
  page=0;selected=null;dirty=false;history=[];draft.textContent='';const saved=localDraft();
  if(saved&&saved.base===baseRevision){scene=saved.scene;dirty=crc(encode(scene))!==crc(data);if(appearanceSupported()&&saved.appearance&&saved.appearanceBase===appearanceBase){appearance=saved.appearance;appearanceDirty=crc(A.encode(appearance))!==savedAppearanceCrc;}draft.textContent=t('screen.local_restored');}else if(saved)draft.textContent=t('screen.local_changed');draw();
 }finally{loading=false;}
}
function addItem(type){
 if(!scene||scene.items.length>=32)throw Error(t('screen.overlap'));
 const chart=[3,4,5].includes(type),minimum=2,id=Math.max(0,...scene.items.map(x=>x.id))+1;
 for(let y=0;y<=6-minimum;y++)for(let x=0;x<=4-(chart?4:minimum);x++){
  const it={id,page,type,binding:type===1?2:6,x,y,w:type===0||chart?4:minimum,h:chart&&!(lastStatus?.capabilities&256)?4:minimum,source:0,title:t('screen.type.'+types[type]),unit:type===1?'ppm':'',chart:type===4?3:type===5?6:0,hours:24,series_count:type===5?3:1,binding2:0,binding3:0,additive:type===5?1:0,text:''};
  const next=copy(scene);next.schema=3;next.items.push(it);try{encode(next);}catch{continue;}
  change(()=>{scene=next;selected=scene.items.at(-1);editing=true;});return;
 }throw Error(t('screen.overlap'));
}
const editButton=button('screen.edit_layout',()=>{editing=!editing;draw();},{id:'screenEdit','aria-pressed':'false'}),addType=select([[0,'screen.type.clock'],[1,'screen.type.value'],[2,'screen.type.text'],[3,'screen.type.line'],[6,'screen.type.weather'],[7,'screen.type.reminders']],0);
addType.id='screenAddType';
const addPage=button('screen.add_page',()=>{
 if(!scene||scene.pages.length>=8)throw Error(t('screen.overlap'));change(()=>{scene.schema=3;scene.pages.push({id:Math.max(0,...scene.pages.map(p=>p.id))+1,enabled:true,title:t('screen.new_page')});page=scene.pages.length-1;selected=null;editing=true;});
},{id:'screenAddPage'});
const deletePage=button('screen.delete_page',()=>{if(!scene||scene.pages.length===1)throw Error(t('screen.invalid'));const removed=page;if(change(()=>{const ids=scene.items.filter(it=>it.page===page).map(it=>it.id);ids.forEach(id=>delete appearance.items[id]);scene.pages.splice(page,1);scene.items=scene.items.filter(it=>it.page!==page);scene.items.forEach(it=>{if(it.page>page)it.page--;});page=Math.min(page,scene.pages.length-1);selected=null;}))invalidatePolicyPage(removed,true);},{id:'screenDeletePage'});
const layout=section('screen.layout',h('div',{class:'row screen-toolbar'},button('screen.load',async()=>{if((dirty||appearanceDirty)&&!await UI.confirm({title:t('screen.load'),body:t('screen.discard'),ok:t('screen.load')}))return;await loadLayout();},{id:'screenLoad'}),save,editButton,undoButton),h('div',{class:'screen-workspace'},h('div',{class:'screen-stage'},h('span',{class:'screen-preview-meta',i18n:'screen.preview_size'}),grid),h('div',{class:'screen-inspector stack'},fieldRow('screen.page',pageSelect),h('div',{class:'row'},addPage,deletePage),fieldRow('screen.title',pageTitle),fieldRow('screen.enabled',pageEnabled),h('div',{class:'row'},addType,button('screen.add',()=>addItem(Number(addType.value)),{id:'screenAddItem'})),itemForm)),draft,h('details',{class:'screen-technical'},h('summary',{i18n:'screen.details'}),info,button('screen.local_load',()=>{const saved=localDraft();if(saved)change(()=>{scene=saved.scene;if(saved.appearance&&saved.appearanceBase===appearanceBase)appearance=saved.appearance;selected=null;page=0;});},{id:'screenLocalLoad'})));
layout.open=true;
// Appearance is a separate, capability-negotiated document. Layout bytes stay SCN3.
const appearanceState=h('p',{class:'help',id:'screenAppearanceState',role:'status'}),themeChoices=h('div',{class:'screen-theme-choices'}),paletteFields=h('div',{class:'screen-color-fields'});
const pageRailHeight=select([[6,'screen.rail_thin'],[12,'screen.rail_standard'],[20,'screen.rail_wide']],12);pageRailHeight.id='screenPageRailHeight';
pageRailHeight.onchange=()=>change(()=>{appearance.pageRailHeight=Number(pageRailHeight.value)===12?0:Number(pageRailHeight.value);});
const wallpaperChoice=select(A.wallpapers.map(k=>[k,'screen.wallpaper_'+k]),'none'),cardOpacity=input(80,'range',{min:0,max:100,step:1}),wallpaperDim=input(24,'range',{min:0,max:70,step:1}),opacityValue=h('output'),dimValue=h('output');
wallpaperChoice.id='screenWallpaper';cardOpacity.id='screenCardOpacity';wallpaperDim.id='screenWallpaperDim';
const wallpaperFile=input('','file',{id:'screenWallpaperFile',accept:'.bwp,image/png,image/jpeg,image/webp'}),wallpaperProgress=h('progress',{id:'screenWallpaperProgress',max:204960,value:0,hidden:true});let uploadCancelled=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function componentStyle(it){
 const colors=A.widgetColors(appearance,it),p=A.resolve(appearance),image=appearance.wallpaper!=='none'&&(appearance.wallpaper!=='custom'||customPreview?.crc===appearance.custom_crc),hex=colors.background;
 const alpha=A.surface(appearance,it,image)/100,rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
 return componentBox(it)+';'+Object.entries(colors).map(([k,v])=>`--component-${k}:${v}`).join(';')+`;background:rgba(${rgb},${alpha});border:1px solid ${image?p.line+'66':'transparent'}`;
}
function applyAppearancePreview(){
 const p=A.resolve(appearance);for(const [k,v]of Object.entries(p))grid.style.setProperty('--appearance-'+k,v);
 for(const [k,v]of Object.entries({ink:p.value,muted:p.unit,accent:p.accent,card:p.background,bg:p.canvas}))grid.style.setProperty('--screen-'+k,v);
 if(!customPreview)try{const raw=localStorage.getItem('iotcloud.screen.wallpaper.'+deviceKey);if(raw){const cache=JSON.parse(raw);if(cache.crc===appearance.custom_crc&&/^data:image\/png;base64,/.test(cache.url)&&cache.url.length<2000000)customPreview=cache;}}catch{}
 const image=appearance.wallpaper==='custom'?(customPreview?.crc===appearance.custom_crc?customPreview.url:null):A.presetURL(appearance.wallpaper);
 grid.style.backgroundColor=p.canvas;grid.style.backgroundImage=image?`linear-gradient(rgba(0,0,0,${appearance.wallpaperDim/100}),rgba(0,0,0,${appearance.wallpaperDim/100})),url("${image}")`:'none';grid.style.backgroundSize='100% 100%';
}
function colorRow(key,value,overridden,onSet,onReset){
 const control=input(value,'color',{'aria-label':t('screen.color_'+key)});control.onchange=()=>change(()=>onSet(control.value));
 const reset=button('screen.inherit',()=>change(onReset),{class:'btn small',disabled:!overridden});control.disabled=appearanceBusy;
 return fieldRow('screen.color_'+key,h('div',{class:'row'},control,reset));
}
function componentColors(it){
 const p=A.widgetColors(appearance,it),c=appearance.items[it.id]||{},rows=A.widgetRoles.map(k=>colorRow(k,p[k],!!c[k],v=>{(appearance.items[it.id]??={})[k]=v;},()=>{delete appearance.items[it.id]?.[k];pruneColors(it.id);}));
 const inherit=input('','checkbox',{checked:c.opacity===undefined}),level=input(c.opacity??appearance.cardOpacity,'range',{min:0,max:100,step:1,disabled:c.opacity===undefined||appearanceBusy}),out=h('output',{},level.value+'%');
 inherit.onchange=()=>change(()=>{if(inherit.checked){delete appearance.items[it.id]?.opacity;pruneColors(it.id);}else (appearance.items[it.id]??={}).opacity=Number(level.value);});
 level.oninput=()=>out.textContent=level.value+'%';level.onchange=()=>change(()=>{(appearance.items[it.id]??={}).opacity=Number(level.value);});
 const body=section('screen.component_colors',...rows,fieldRow('screen.opacity',h('div',{class:'row'},level,out)),fieldRow('screen.inherit',inherit),button('screen.reset_colors',()=>change(()=>{delete appearance.items[it.id];})));body.id='screenComponentColors';return body;
}
function pruneColors(id){if(!Object.keys(appearance.items[id]||{}).length)delete appearance.items[id];}
function renderAppearance(){
 const supported=appearanceSupported();appearanceSection.hidden=!supported;
 save.disabled=appearanceBusy||save.getAttribute('aria-busy')==='true';
 screenLanguage.value=appearance.language||'zh-CN';screenLanguage.disabled=languageSave.disabled=!scene||appearanceBusy||!(lastStatus?.capabilities&32768);
 if(!supported)return;const p=A.resolve(appearance);
 pageRailHeight.value=A.railHeight(appearance);pageRailHeight.disabled=appearanceBusy||!(lastStatus?.capabilities&131072);
 themeChoices.replaceChildren(...A.themes.map((name,i)=>button('screen.theme_'+name,()=>change(()=>{appearance.theme=name;appearance.colors={};}),{'data-theme':name,'aria-pressed':appearance.theme===name,class:'screen-theme btn',disabled:appearanceBusy,style:`--swatch-bg:${A.palettes[i].canvas};--swatch-accent:${A.palettes[i].accent}`})));
 paletteFields.replaceChildren(...A.roles.map(k=>colorRow(k,p[k],!!appearance.colors[k],v=>appearance.colors[k]=v,()=>delete appearance.colors[k])));
 wallpaperChoice.value=appearance.wallpaper;cardOpacity.value=appearance.cardOpacity;wallpaperDim.value=appearance.wallpaperDim;opacityValue.textContent=appearance.cardOpacity+'%';dimValue.textContent=appearance.wallpaperDim+'%';
 for(const el of [wallpaperChoice,cardOpacity,wallpaperDim,wallpaperFile,appearanceSave,wallpaperUpload])el.disabled=appearanceBusy;
 if(!appearanceBusy)appearanceState.textContent=t(appearanceDirty?'screen.unsaved':'screen.saved');
}
async function saveAppearance(){
 if(appearance.language==='en'&&!(lastStatus?.capabilities&32768))throw Error(t('screen.language_unsupported'));
 if(appearance.pageRailHeight&&!(lastStatus?.capabilities&131072))throw Error(t('screen.rail_unsupported'));
 if(!appearanceSupported()||!appearanceDirty)return;
 const ownsBusy=!appearanceBusy;if(ownsBusy){appearanceBusy=true;renderAppearance();}try{
 const candidate=copy(appearance),before=await command('screen.appearance.get');candidate.revision=Math.max(before.revision,appearanceBase)+1;
 const receipt=await command('screen.appearance.set',{bytes:b64(A.encode(candidate))});if(receipt.revision!==candidate.revision)throw Error(t('screen.appearance_failed'));
 for(let i=0;i<50;i++){
  const state=await command('screen.appearance.get');if(state.revision!==candidate.revision)throw Error(t('screen.changed'));
  if(state.applied_revision===candidate.revision){appearance=candidate;appearanceBase=candidate.revision;savedAppearanceCrc=crc(A.encode(appearance));appearanceDirty=false;storeDraft();draw();return;}
  if(state.error)throw Error(t('screen.appearance_failed'));await pause(250);
 }throw Error(t('screen.appearance_failed'));
 }finally{if(ownsBusy){appearanceBusy=false;draw();}}
}
async function wallpaperOperation(action,params={}){
 const receipt=await command('screen.wallpaper.'+action,params),until=Date.now()+22000;
 while(Date.now()<until){
  const state=await command('screen.wallpaper.get');if(state.request!==receipt.request)throw Error(t('screen.changed'));
  if(state.state==='complete'&&state.code===0)return state;
  if(['timeout','mcu_rejected'].includes(state.state))throw Error(t('screen.wallpaper_failed'));
  await pause(120);
 }throw Error(t('screen.wallpaper_failed'));
}
async function uploadWallpaper(){
 const f=wallpaperFile.files?.[0];if(!f||f.size>5*1024*1024)throw Error(t('screen.wallpaper_format'));
 if(appearanceBusy)return;appearanceBusy=true;uploadCancelled=false;wallpaperProgress.hidden=false;wallpaperProgress.value=0;renderAppearance();let started=false;
 try{
  const bytes=/\.bwp$/i.test(f.name)?new Uint8Array(await f.arrayBuffer()):await A.convertFile(f),image=A.parseWallpaper(bytes),url=A.imageURL(bytes);
  appearanceState.textContent=t('screen.wallpaper_preparing');await wallpaperOperation('begin',{header:b64(bytes.slice(0,32))});started=true;
  const prepareUntil=Date.now()+65000;
  while(true){const state=await command('screen.wallpaper.get');if(state.state==='complete'&&state.code===0&&state.active&&state.resource_state!==7)break;if(['timeout','mcu_rejected'].includes(state.state)||Date.now()>prepareUntil||(!state.active&&state.state==='complete'))throw Error(t('screen.wallpaper_failed'));await pause(200);}
  appearanceState.textContent=t('screen.wallpaper_uploading');
  for(let offset=0;offset<204960;offset+=512){
   if(uploadCancelled)throw Error(t('screen.wallpaper_cancelled'));
   await wallpaperOperation('chunk',{offset,bytes:b64(bytes.slice(32+offset,32+Math.min(offset+512,204960)))});wallpaperProgress.value=Math.min(offset+512,204960);
  }
  const done=await wallpaperOperation('commit');started=false;if(done.crc!==image.crc)throw Error(t('screen.wallpaper_failed'));
  customPreview={crc:image.crc,url};try{localStorage.setItem('iotcloud.screen.wallpaper.'+deviceKey,JSON.stringify(customPreview));}catch{}
  const before={scene:copy(scene),appearance:copy(appearance),dirty,appearanceDirty};history.push(before);appearance.wallpaper='custom';appearance.custom_crc=image.crc;appearanceDirty=true;storeDraft();await saveAppearance();
 }catch(e){if(started)try{await wallpaperOperation('cancel');}catch{}throw e;}
 finally{appearanceBusy=false;wallpaperProgress.hidden=true;renderAppearance();draw();}
}
const appearanceSave=button('screen.apply_appearance',saveAppearance,{id:'screenAppearanceSave',class:'btn primary'}),wallpaperUpload=button('screen.wallpaper_upload',uploadWallpaper,{id:'screenWallpaperUpload'});
wallpaperChoice.onchange=()=>change(()=>{appearance.wallpaper=wallpaperChoice.value;});
cardOpacity.oninput=()=>opacityValue.textContent=cardOpacity.value+'%';cardOpacity.onchange=()=>change(()=>{appearance.cardOpacity=Number(cardOpacity.value);});
wallpaperDim.oninput=()=>dimValue.textContent=wallpaperDim.value+'%';wallpaperDim.onchange=()=>change(()=>{appearance.wallpaperDim=Number(wallpaperDim.value);});
const appearanceSection=section('screen.appearance',fieldRow('screen.page_rail',pageRailHeight),themeChoices,section('screen.custom_palette',paletteFields,button('screen.reset_colors',()=>change(()=>{appearance.colors={};}))),fieldRow('screen.wallpaper',wallpaperChoice),fieldRow('screen.opacity',h('div',{class:'row'},cardOpacity,opacityValue)),fieldRow('screen.wallpaper_dim',h('div',{class:'row'},wallpaperDim,dimValue)),fieldRow('screen.file',wallpaperFile),h('p',{class:'help',i18n:'screen.wallpaper_format'}),h('div',{class:'row'},wallpaperUpload,button('common.cancel',()=>{uploadCancelled=true;}),h('a',{href:'https://phicomm-io.github.io/tools/screen-wallpaper/',target:'_blank',rel:'noopener',i18n:'screen.wallpaper_converter'})),wallpaperProgress,appearanceSave,appearanceState);
appearanceSection.id='screenAppearance';appearanceSection.hidden=true;I18N.onChange(()=>{if(scene){draw();renderAppearance();}});

// Sleep policy is a separate persistent device configuration, never part of undo.
let policy=null,policyDirty=false,policySupported=false,policyPending=0;
const screenLanguage=select([['zh-CN','screen.language_zh'],['en','screen.language_en']],'zh-CN');screenLanguage.id='screenLanguage';
screenLanguage.disabled=true;screenLanguage.onchange=()=>change(()=>{appearance.language=screenLanguage.value;});
const languageSave=button('common.save',saveAppearance,{id:'screenLanguageSave',disabled:true});
const languageSection=section('screen.language',fieldRow('screen.language',screenLanguage),languageSave);
languageSection.open=true;
const policyState=h('p',{class:'help',id:'screenPolicyState',role:'status'}),planList=h('div',{class:'stack',id:'screenPlans'});
const policyFields={ceiling:input(100,'number',{min:1,max:100,step:1}),external_minutes:input(2,'number',{min:0,max:1440,step:1}),battery_minutes:input(1,'number',{min:0,max:1440,step:1}),idle_brightness:input(0,'number',{min:0,max:100,step:1}),idle_page:h('select')};
function pageOptions(control,value){control.replaceChildren(h('option',{value:255,selected:Number(value)===255,i18n:'screen.keep_page'}),...(scene?.pages||[]).flatMap((p,i)=>p.enabled?[h('option',{value:i,selected:Number(value)===i},`${i+1} · ${p.title}`)]:[]));}
function renderPolicyPageOptions(){if(!policy)return;pageOptions(policyFields.idle_page,policy.idle_page);planList.querySelectorAll('[data-plan-page]').forEach(el=>pageOptions(el,policy.plans[Number(el.dataset.planPage)]?.page??255));}
function policyChanged(){policyDirty=true;policyState.textContent=t('screen.policy_unsaved');}
function invalidatePolicyPage(index,removed){
 if(!policy)return;let changed=false;
 const remap=p=>{if(p===index){changed=true;return 255;}if(removed&&p!==255&&p>index){changed=true;return p-1;}return p;};
 policy.idle_page=remap(policy.idle_page);policy.plans.forEach(p=>p.page=remap(p.page));if(changed){policyChanged();renderPolicy();}
}
function renderPolicy(){
 if(!policy)return;for(const [key,el]of Object.entries(policyFields)){if(key==='idle_page')pageOptions(el,policy[key]);else el.value=policy[key];el.disabled=!policySupported;}
 planList.replaceChildren(...policy.plans.map((p,i)=>{
  const enabled=input('','checkbox',{checked:p.enabled}),name=input(p.name),days=UI.daysPicker('screenPlanDays'+i,p.days),start=input(UI.hhmm(p.start),'time'),end=input(UI.hhmm(p.end),'time'),level=input(p.brightness,'number',{min:0,max:100,step:1}),dest=h('select',{'data-plan-page':i});pageOptions(dest,p.page);
  const update=()=>{Object.assign(p,{enabled:enabled.checked,name:name.value,days:days.mask(),start:UI.toMinutes(start.value),end:UI.toMinutes(end.value),brightness:Number(level.value),page:Number(dest.value)});policyChanged();};
  const row=h('div',{class:'screen-plan stack','data-plan':i},fieldRow('screen.enabled',enabled),fieldRow('screen.title',name),days,fieldRow('screen.start',start),fieldRow('screen.end',end),fieldRow('screen.sleep_brightness',level),fieldRow('screen.sleep_page',dest),h('div',{class:'row'},button('screen.up',()=>{if(i){[policy.plans[i-1],policy.plans[i]]=[p,policy.plans[i-1]];policyChanged();renderPolicy();}},{disabled:!i}),button('screen.down',()=>{if(i<policy.plans.length-1){[policy.plans[i],policy.plans[i+1]]=[policy.plans[i+1],p];policyChanged();renderPolicy();}},{disabled:i===policy.plans.length-1}),button('common.delete',()=>{policy.plans.splice(i,1);policyChanged();renderPolicy();})));
  row.onchange=update;return row;
 }));policySave.disabled=!policySupported;policyAdd.disabled=!policySupported||policy.plans.length>=8;
}
for(const [key,el]of Object.entries(policyFields)){el.id='screenPolicy_'+key;el.onchange=()=>{if(!policy)return;policy[key]=Number(el.value);policyChanged();};}
async function loadPolicy(){const p=await command('screen.display.get');policySupported=!!p.supported;policy={ceiling:p.ceiling,external_minutes:p.external_minutes,battery_minutes:p.battery_minutes,idle_brightness:p.idle_brightness,idle_page:p.idle_page,plans:copy(p.plans||[])};policyDirty=false;policyPending=0;renderPolicy();policyState.textContent=t(policySupported?'screen.policy_loaded':'screen.policy_unsupported');}
function validatePolicy(){
 const p=policy,validPage=n=>n===255||(scene?.pages[n]?.enabled===true);
 if(!p||![p.ceiling,p.external_minutes,p.battery_minutes,p.idle_brightness,p.idle_page].every(num)||p.ceiling<1||p.ceiling>100||p.external_minutes<0||p.external_minutes>1440||p.battery_minutes<0||p.battery_minutes>1440||p.idle_brightness<0||p.idle_brightness>100||!validPage(p.idle_page)||p.plans.length>8)throw Error(t('screen.invalid'));
 for(const r of p.plans){if(![r.days,r.start,r.end,r.brightness,r.page].every(num)||r.days<0||r.days>127||(r.enabled&&!r.days)||r.start<0||r.start>=1440||r.end<0||r.end>=1440||r.start===r.end||r.brightness<0||r.brightness>100||!validPage(r.page)||encoder.encode(r.name).length>31||/[\x00-\x1f\x7f]/.test(r.name))throw Error(t('screen.invalid'));}
}
const policySave=button('screen.save_policy',async()=>{
 validatePolicy();if(dirty)throw Error(t('screen.layout_first'));
 const result=await command('screen.display.set',copy(policy));policyDirty=false;policyPending=result.revision;policyState.textContent=t('screen.policy_pending',{revision:result.revision});
},{id:'screenPolicySave',class:'btn primary',disabled:true});
const policyAdd=button('screen.add_plan',()=>{if(!policy||policy.plans.length>=8)return;policy.plans.push({name:t('screen.night'),enabled:true,days:127,start:23*60,end:7*60,brightness:8,page:255});policyChanged();renderPolicy();},{id:'screenAddPlan',disabled:true});
const displayPolicy=section('screen.display_policy',button('screen.load',loadPolicy,{id:'screenPolicyLoad'}),...Object.entries(policyFields).map(([k,el])=>fieldRow('screen.'+k,el)),planList,h('div',{class:'row'},policyAdd,policySave),policyState);
displayPolicy.id='screenDisplayPolicy';
const rules=h('div',{class:'list',id:'screenRules'}),notices=h('div',{class:'list',id:'screenNotices'});
const kind=select([[0,'screen.once'],[1,'screen.daily'],[2,'screen.weekly']],0),when=input('','datetime-local'),at=input('09:00','time'),week=UI.daysPicker('screenWeek',31),remTitle=input(''),remText=h('textarea',{maxLength:127}),wake=select([[255,'screen.inherit'],[0,'screen.dnd'],[1,'screen.always'],[2,'screen.unread']],255),defaultWake=select([[0,'screen.dnd'],[1,'screen.always'],[2,'screen.unread']],0),ruleEnabled=input('','checkbox',{checked:true}),timezone=input(480,'number',{min:-720,max:840,step:15});
let ruleId=0;
async function loadReminders(){
 const allRules=[],allNotices=[];for(let offset=0;offset<32;offset+=8){const d=await command('screen.reminders.get',{offset});allRules.push(...d.rules);allNotices.push(...d.notices);if(!offset){timezone.value=d.timezone;defaultWake.value=d.wake;}}
 rules.replaceChildren(...allRules.map(r=>h('div',{class:'row'},h('span',{class:'grow'},r.title+' · '+t(['screen.once','screen.daily','screen.weekly'][r.kind])),button('screen.edit',()=>{ruleId=r.id;ruleEnabled.checked=r.enabled;kind.value=r.kind;remTitle.value=r.title;remText.value=r.text;at.value=UI.hhmm(r.minute);wake.value=r.wake;if(r.epoch){const d=new Date((r.epoch+Number(timezone.value)*60)*1000);when.value=d.toISOString().slice(0,16);}week.setMask(r.days);}),button('common.delete',async()=>{await command('screen.reminders.delete',{id:r.id});await loadReminders();}))));
 notices.replaceChildren(...allNotices.filter(r=>r.unread).map(r=>h('div',{class:'row'},h('span',{class:'grow'},r.title+' · '+r.text),button('screen.read',async()=>{await command('screen.reminders.ack',{id:r.id});await loadReminders();}))));
}
Object.entries({screenReminderKind:kind,screenReminderWhen:when,screenReminderAt:at,screenReminderTitle:remTitle,screenReminderText:remText,screenReminderWake:wake,screenTimezone:timezone,screenDefaultWake:defaultWake,screenRuleEnabled:ruleEnabled}).forEach(([id,el])=>el.id=id);
const reminder=section('screen.reminders',button('screen.load',loadReminders),rules,h('details',{class:'screen-technical'},h('summary',{i18n:'screen.advanced'}),fieldRow('screen.timezone',timezone),fieldRow('screen.wake',defaultWake),button('screen.save_timezone',()=>command('screen.reminders.configure',{timezone:Number(timezone.value),wake:Number(defaultWake.value)}))),fieldRow('screen.kind',kind),fieldRow('screen.enabled',ruleEnabled),fieldRow('screen.when',when),fieldRow('screen.at',at),week,fieldRow('screen.title',remTitle),fieldRow('screen.text',remText),fieldRow('screen.wake',wake),h('div',{class:'row'},button('common.save',async()=>{
 const local=new Date(when.value+'Z').getTime()/1000,days=week.mask();
 await command('screen.reminders.set',{id:ruleId||Math.floor(Date.now()/1000)%0x7fffffff||1,kind:Number(kind.value),epoch:Number(kind.value)===0?Math.floor(local-Number(timezone.value)*60):0,minute:UI.toMinutes(at.value),days,wake:Number(wake.value),enabled:ruleEnabled.checked,title:remTitle.value,text:remText.value});ruleId=0;await loadReminders();
}),button('screen.push',async()=>{await command('screen.reminders.push',{title:remTitle.value,text:remText.value,wake:Number(wake.value)===255?0:Number(wake.value)});await loadReminders();})),notices);
const provider=select([['openmeteo','screen.openmeteo'],['qweather','screen.qweather'],['seniverse','screen.seniverse'],['openweather','screen.openweather']],'openmeteo'),weatherEnabled=input('','checkbox'),host=input('','text',{placeholder:'abc.qweatherapi.com'}),key=input('','password',{autoComplete:'new-password',maxLength:256}),clearKey=input('','checkbox'),lat=input(0,'number',{min:-90,max:90,step:.0001}),lon=input(0,'number',{min:-180,max:180,step:.0001}),place=input(''),interval=input(900,'number',{min:300,max:86400,step:1}),weatherState=h('p',{class:'help',id:'screenWeatherState'});
const hostRow=fieldRow('screen.host',host),keyRow=fieldRow('screen.key',key),clearKeyRow=fieldRow('screen.clear_key',clearKey);
function weatherProviderFields(){const free=provider.value==='openmeteo';hostRow.hidden=provider.value!=='qweather';keyRow.hidden=clearKeyRow.hidden=free;host.disabled=hostRow.hidden;key.disabled=clearKey.disabled=free;}
provider.addEventListener('change',weatherProviderFields);weatherProviderFields();
const verifyTls=input('','checkbox',{id:'screenWeatherVerifyTls'});
async function loadWeather(){const r=await command('screen.weather.get'),c=r.config||{};provider.value=c.provider||'openmeteo';weatherEnabled.checked=!!c.enabled;verifyTls.checked=c.verify_tls===true;host.value=c.host||'';key.value='';key.placeholder=c.key_set?t('screen.key_saved'):'';clearKey.checked=false;lat.value=c.latitude??0;lon.value=c.longitude??0;place.value=c.label||'';interval.value=c.interval||900;weatherProviderFields();weatherState.textContent=[r.provider,r.location,r.text,r.temperature==null?'':r.temperature+' °C',r.error].filter(Boolean).join(' · ');}
Object.entries({screenWeatherProvider:provider,screenWeatherEnabled:weatherEnabled,screenWeatherHost:host,screenWeatherKey:key,screenWeatherClear:clearKey,screenWeatherLat:lat,screenWeatherLon:lon,screenWeatherPlace:place,screenWeatherInterval:interval}).forEach(([id,el])=>el.id=id);
const weather=section('screen.weather',button('screen.load',loadWeather),fieldRow('screen.enabled',weatherEnabled),fieldRow('screen.provider',provider),hostRow,keyRow,clearKeyRow,fieldRow('screen.latitude',lat),fieldRow('screen.longitude',lon),fieldRow('screen.location',place),fieldRow('screen.interval',interval),fieldRow('screen.verify_tls',verifyTls),h('div',{class:'row'},button('common.save',async()=>{const free=provider.value==='openmeteo',c={enabled:weatherEnabled.checked,provider:provider.value,latitude:Number(lat.value),longitude:Number(lon.value),label:place.value,interval:Number(interval.value),verify_tls:verifyTls.checked,clear_key:free||clearKey.checked};if(provider.value==='qweather')c.host=host.value;if(!free&&key.value)c.key=key.value;await command('screen.weather.set',c);await loadWeather();}),button('screen.refresh',async()=>{await command('screen.weather.refresh');await loadWeather();})),weatherState,h('p',{class:'help'},h('a',{href:'https://open-meteo.com/',target:'_blank',rel:'noopener'},'Open-Meteo · CC BY 4.0'),' · ',h('a',{href:'https://www.qweather.com/',target:'_blank',rel:'noopener'},'QWeather'),' · ',h('a',{href:'https://www.seniverse.com/',target:'_blank',rel:'noopener'},'Seniverse'),' · ',h('a',{href:'https://openweathermap.org/',target:'_blank',rel:'noopener'},'OpenWeather')));
const file=input('','file',{accept:'.bin'}),otaState=h('p',{class:'help',id:'screenOtaState'});
const uploadHash=h('p',{class:'help',id:'screenUploadHash'});
let recoveryBusy=false,recoveryData=null;
const recoveryState=h('p',{class:'help',id:'screenRecoveryState',role:'status'});
function renderRecovery(r){
 if(r)recoveryData=r;const d=recoveryData||{},mode=d.available?d.mode:'unavailable';
 recoveryResume.disabled=recoveryHold.disabled=recoveryBusy||!['window','held'].includes(mode)||!!lastStatus?.ota?.active;
 recoveryState.textContent=t('screen.recovery_'+(['normal','window','held','fault_recovery'].includes(mode)?mode:'unavailable'),{seconds:Math.ceil((d.window_ms||0)/1000)});
}
async function recoveryAction(action){
 if(recoveryBusy)return;recoveryBusy=true;renderRecovery();
 try{const r=await command('screen.recovery.get');renderRecovery(r);if(!r.available||!['window','held'].includes(r.mode))throw Error(t('screen.recovery_unavailable'));
  const receipt=await command('screen.recovery.'+action),until=Date.now()+22000;
  while(Date.now()<until){const s=await command('screen.recovery.get');renderRecovery(s);
   if(s.session!==receipt.session||s.request!==receipt.request)throw Error(t('screen.recovery_changed'));
   if(['timeout','mcu_rejected','invalid_response'].includes(s.state))throw Error(t('screen.recovery_failed'));
   if(s.state==='complete'&&s.result===0&&s.mode===(action==='resume'?'normal':'held'))return;
   await pause(150);
  }throw Error(t('screen.recovery_failed'));
 }finally{recoveryBusy=false;renderRecovery();}
}
function recoveryButton(action,id,key){return button(key,null,{id,disabled:true,onclick:async e=>{await run(e.currentTarget,()=>recoveryAction(action));renderRecovery();}});}
const recoveryResume=recoveryButton('resume','screenRecoveryResume','screen.recovery_resume'),recoveryHold=recoveryButton('hold','screenRecoveryHold','screen.recovery_hold');
let startupData=null,startupDirty=false,startupBusy=false;
const startupAuto=input('','checkbox',{id:'screenStartupAuto',disabled:true}),startupState=h('p',{class:'help',id:'screenStartupState',role:'status'});
function renderStartup(data){
 if(data&&typeof data.auto_resume==='boolean')startupData=data;
 startupAuto.disabled=startupBusy||!startupData;
 startupSave.disabled=startupBusy||!startupData||!startupDirty;
 if(!startupDirty&&startupData)startupAuto.checked=startupData.auto_resume;
 if(startupData&&!startupDirty)startupState.textContent=t('screen.startup_'+(startupData.auto_resume?'fast':'full'));
}
startupAuto.onchange=()=>{startupDirty=true;startupState.textContent='';renderStartup();};
async function loadStartup(){renderStartup(await command('screen.startup.get'));}
async function saveStartup(){
 if(startupBusy||!startupDirty||!startupData)return;
 const auto_resume=startupAuto.checked;startupBusy=true;renderStartup();
 try{await command('screen.startup.set',{auto_resume});const saved=await command('screen.startup.get');
  if(saved.auto_resume!==auto_resume)throw Error(t('screen.startup_failed'));
  startupDirty=false;renderStartup(saved);
 }finally{startupBusy=false;renderStartup();}
}
const startupSave=button('common.save',null,{id:'screenStartupSave',disabled:true,onclick:async e=>{await run(e.currentTarget,saveStartup);renderStartup();}});
const recoverySection=section('screen.recovery',button('screen.refresh',async()=>{renderRecovery(await command('screen.recovery.get'));await loadStartup();}),fieldRow('screen.startup_auto',startupAuto),startupSave,startupState,h('div',{class:'row'},recoveryResume,recoveryHold),recoveryState);
const ota=section('screen.ota',fieldRow('screen.file',file),button('screen.upload',async()=>{
 const f=file.files?.[0];if(!f||f.size!==421888)throw Error(t('screen.invalid'));
 const response=await deviceFetch('/api/v1/screen/ota/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-IotCloud-Target':'BRY88BBA15G-screen'},body:f});const reply=await DeviceAuth.decodeResponse(response);if(!response.ok||reply.code!=='ok')throw Error(reply.code||String(response.status));uploadHash.textContent=reply.data.sha256;
}),button('screen.stage',()=>command('screen.update.start',{mode:'stage'})),otaState,uploadHash);
const fontFile=input('','file',{accept:'.iotfnt',id:'screenFontFile'}),fontProgress=h('progress',{max:1,value:0,id:'screenFontProgress',hidden:true}),fontState=h('p',{class:'help',id:'screenFontState',role:'status'});
async function fontOperation(action,params={}){
 const receipt=await command('screen.font.'+action,params),until=Date.now()+22000;
 while(Date.now()<until){const state=await command('screen.font.get');if(state.request!==receipt.request)throw Error(t('screen.changed'));
  if(state.state==='complete'&&state.code===0)return state;if(['timeout','mcu_rejected'].includes(state.state))throw Error(t('screen.font_failed'));await pause(120);}
 throw Error(t('screen.font_failed'));
}
async function uploadFont(f=fontFile.files?.[0]){
 if(!f||f.size<32||f.size>0x1fe000||!(lastStatus?.capabilities&16384))throw Error(t('screen.invalid'));
 if(appearanceBusy)return;
 const data=new Uint8Array(await f.arrayBuffer()),v=new DataView(data.buffer);
 if(txt(data,0,8)!=='IOTFNT02'||v.getUint32(8,true)!==data.length||crc(data.slice(32))!==v.getUint32(12,true)||crc(data.slice(0,28))!==v.getUint32(28,true))throw Error(t('screen.invalid'));
 appearanceBusy=true;fontUpload.disabled=true;fontProgress.hidden=false;fontProgress.max=data.length;let started=false;
 try{await fontOperation('begin',{header:b64(data.slice(0,32))});started=true;const until=Date.now()+315000;
  while(true){const r=await command('screen.font.get');if(r.state==='complete'&&r.active&&r.resource_state===6)break;if(['timeout','mcu_rejected'].includes(r.state)||(r.state==='complete'&&!r.active)||Date.now()>until)throw Error(t('screen.font_failed'));await pause(250);}
  for(let offset=0;offset<data.length;offset+=512){await fontOperation('chunk',{offset,bytes:b64(data.slice(offset,offset+512))});fontProgress.value=Math.min(offset+512,data.length);}
  const r=await fontOperation('commit');started=false;if(r.crc!==crc(data))throw Error(t('screen.font_failed'));fontState.textContent=t('screen.font_ready');
 }catch(e){if(started)try{await fontOperation('cancel');}catch{}throw e;}
 finally{appearanceBusy=false;fontUpload.disabled=!(lastStatus?.capabilities&16384);fontProgress.hidden=true;renderAppearance();}
}
const fontUpload=button('screen.font_upload',uploadFont,{id:'screenFontUpload',disabled:true});
const fontSection=section('screen.font',fontFile,fontUpload,fontProgress,fontState);fontSection.open=true;
let onlineRelease=null;
const onlineState=h('p',{id:'screenOnlineState',class:'help',role:'status'});
const releaseOrigin='https://phicomm-io.github.io';
function releaseRank(v){const m=/^(\d+)\.(\d+)\.(\d+)(?:-rc(?:\.(\d+))?)?$/.exec(v);return m?[+m[1],+m[2],+m[3],v.includes('-rc')?0:1,+(m[4]||0)]:[];}
async function checkScreenOnline(){
 onlineRelease=null;onlineFirmware.disabled=onlineFont.disabled=true;
 const catalogs=await Promise.allSettled(['index','candidates'].map(async kind=>{const r=await fetch(releaseOrigin+'/releases/'+kind+'.json',{cache:'no-store'});if(!r.ok)throw Error('unavailable');return r.json();}));
 const releases=catalogs.flatMap(r=>r.status==='fulfilled'?(r.value.releases||[]):[]).filter(r=>r.screen?.target==='BRY88BBA15G-screen'&&releaseRank(r.version).length);
 releases.sort((a,b)=>{const x=releaseRank(a.version),y=releaseRank(b.version);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;});
 onlineRelease=releases[0]?.screen||null;if(!onlineRelease)throw Error(t('screen.online_none'));
 onlineState.textContent=onlineRelease.version;onlineFirmware.disabled=false;onlineFont.disabled=!onlineRelease.font;
}
async function onlineAsset(kind){
 const asset=onlineRelease?.[kind];if(!asset||!/^\/releases\/v\d+\.\d+\.\d+(?:-rc(?:\.\d+)?)?\/[A-Za-z0-9_.-]+$/.test(asset.path)||!Number.isInteger(asset.size)||asset.size<32||asset.size>(kind==='firmware'?421888:0x1fe000)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error(t('screen.invalid'));
 const r=await fetch(releaseOrigin+asset.path,{cache:'no-store'});if(!r.ok||Number(r.headers.get('Content-Length'))!==asset.size)throw Error(t('screen.invalid'));
 const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==asset.size)throw Error(t('screen.invalid'));return {bytes,asset};
}
const onlineFirmware=button('screen.online_firmware',async()=>{
 if(!await UI.confirm({title:t('screen.ota'),body:t('screen.online_confirm'),ok:t('screen.online_firmware')}))return;
 const {bytes,asset}=await onlineAsset('firmware');
 const response=await deviceFetch('/api/v1/screen/ota/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-IotCloud-Target':'BRY88BBA15G-screen'},body:bytes});
 const reply=await DeviceAuth.decodeResponse(response);if(!response.ok||reply.code!=='ok'||reply.data.sha256!==asset.sha256)throw Error(t('screen.invalid'));
 uploadHash.textContent=asset.sha256;await command('screen.update.start',{mode:'stage'});
 const until=Date.now()+300000;
 while(Date.now()<until){const r=await command('screen.update.get'),s=r.ota||r.screen?.ota;
  if(s?.state==='staged_verified'){await command('screen.update.install',{sha256:asset.sha256});onlineState.textContent=t('screen.online_installing');return;}
  if(s&&['failed','timeout','cancelled','upload_failed'].includes(s.state))throw Error(s.state);await pause(1000);
 }throw Error(t('screen.online_timeout'));
},{id:'screenOnlineFirmware',disabled:true});
const onlineFont=button('screen.online_font',async()=>{const {bytes,asset}=await onlineAsset('font');if(crc(bytes)!==asset.crc32)throw Error(t('screen.invalid'));await uploadFont(new File([bytes],'screen-zh32.iotfnt'));},{id:'screenOnlineFont',disabled:true});
const onlineSection=section('screen.online',button('screen.online_check',checkScreenOnline,{id:'screenOnlineCheck'}),onlineState,h('div',{class:'row'},onlineFirmware,onlineFont),h('p',{class:'help',i18n:'screen.online_local'}));

// Diagnostic trace is paged over the existing negotiated UART extension.
let diagBusy=false,diagReport=null,diagWaiting=false;
const diagMode=select([['current','screen.diag_current'],['next','screen.diag_next'],['page','screen.diag_page']],'current'),
 diagPage=input(1,'number',{id:'screenDiagPage',min:1,max:8,step:1}),
 diagInfo=h('p',{class:'help',id:'screenDiagInfo',role:'status'}),diagBody=h('tbody',{id:'screenDiagRows'});
diagMode.id='screenDiagMode';diagPage.hidden=true;diagMode.onchange=()=>diagPage.hidden=diagMode.value!=='page';
const diagTable=h('table',{},h('thead',{},h('tr',{},...['screen.diag_kind','screen.diag_area','screen.diag_at','screen.diag_duration','screen.diag_gap'].map(key=>h('th',{i18n:key})))),diagBody);
function renderDiag(r){
 diagWaiting=false;
 diagInfo.textContent=t('screen.diag_summary',{period:(r.frame_period_us/1000).toFixed(2),fps:r.frame_period_us?(1e6/r.frame_period_us).toFixed(1):'—',count:r.flush_count,flush:(r.flush_total_us/1000).toFixed(2),elapsed:(r.elapsed_us/1000).toFixed(2),rounds:r.monitor_count,render:r.monitor_total_ms});
 diagBody.replaceChildren();let end=0;
 for(const v of r.records){const gap=v.kind===1?Math.max(0,v.at_us-end):null;if(v.kind===1)end=v.at_us+v.duration_us;
  diagBody.append(h('tr',{},...[(v.kind===1?'flush':'monitor')+(v.last?' *':''),v.kind===1?v.area.join(', '):v.pixels+' px',(v.at_us/1000).toFixed(3),(v.duration_us/1000).toFixed(3),gap===null?'—':(gap/1000).toFixed(3)].map(value=>h('td',{},value))));
 }
 diagExport.disabled=false;
}
async function diagRequest(action,params={}){
 const receipt=await command(action,params),until=Date.now()+6500;
 while(Date.now()<until){
  const r=await command('screen.diagnostics.get');
  if(r.timeout)throw Error(t('screen.diag_timeout'));
  if(r.available&&!r.pending&&r.reply_request===receipt.request){
   if(r.status)throw Error(t('screen.diag_unavailable'));return r;
  }
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw Error(t('screen.diag_timeout'));
}
async function loadDiag(){
 let r=await diagRequest('screen.diagnostics.read');
 if(r.waiting){diagWaiting=true;diagInfo.textContent=t('screen.diag_wait');return;}
 const until=Date.now()+5000;
 while(r.active&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,200));r=await diagRequest('screen.diagnostics.read');}
 if(r.active)throw Error(t('screen.diag_timeout'));
 const records=[],generation=r.generation;
 for(let offset=0;offset<r.stored;offset+=8){
  const page=await diagRequest('screen.diagnostics.read',{offset,limit:8});
  if(page.generation!==generation)throw Error(t('screen.diag_changed'));
  records.push(...page.records);
 }
 diagReport={...r,records,scan_source:'lcd_frame_end_irq'};renderDiag(diagReport);
}
async function diagRun(action){
 if(diagBusy)return;diagBusy=true;diagStart.disabled=diagRead.disabled=true;
 try{await action();}finally{diagBusy=false;diagStart.disabled=diagRead.disabled=!(lastStatus?.capabilities&524288);}
}
const diagStart=quietButton('screen.diag_capture',()=>diagRun(async()=>{
 const mode=diagMode.value,params={mode};if(mode==='page')params.page=Number(diagPage.value);
 diagReport=null;diagWaiting=false;diagBody.replaceChildren();diagInfo.textContent='';diagExport.disabled=true;
 await diagRequest('screen.diagnostics.start',params);
 if(mode==='next'){diagWaiting=true;diagInfo.textContent=t('screen.diag_wait');return;}
 await new Promise(resolve=>setTimeout(resolve,250));await loadDiag();
}),{id:'screenDiagStart',disabled:true}),
 diagRead=quietButton('screen.diag_read',()=>diagRun(loadDiag),{id:'screenDiagRead',disabled:true}),
 diagExport=quietButton('screen.diag_export',()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(diagReport,null,2)],{type:'application/json'})),link=h('a',{href:url,download:'bry88-screen-diagnostics.json'});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 },{id:'screenDiagExport',disabled:true});
I18N.onChange(()=>{if(diagWaiting)diagInfo.textContent=t('screen.diag_wait');else if(diagReport)renderDiag(diagReport);});
const diagnosticSection=section('screen.diag_title',h('div',{class:'row'},diagMode,diagPage,diagStart,diagRead,diagExport),diagInfo,h('p',{class:'help',i18n:'screen.diag_source'}),h('div',{style:'overflow:auto'},diagTable));
layout.id='screenLayout';reminder.id='screenReminders';weather.id='screenWeather';ota.id='screenOta';
const tabBar=h('div',{class:'screen-tabs',role:'tablist','aria-label':t('screen.title_main')}),tabPanels=h('div',{class:'screen-tab-panels'});
const screenTabs={layout:[layout],appearance:[appearanceSection],display:[remotePageSection,languageSection,brightness,displayPolicy],services:[weather,reminder],resources:[onlineSection,recoverySection,fontSection,ota],advanced:[moduleControl],diagnostics:[diagnosticSection]};
function showScreenTab(key,focus=false){
 for(const [k]of Object.entries(screenTabs)){const active=k===key,button=document.querySelector('#screenTab_'+k),panel=document.querySelector('#screenPanel_'+k);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;panel.hidden=!active;if(active&&focus)button.focus();}
}
for(const [key,sections]of Object.entries(screenTabs)){
 const panel=h('section',{class:'stack',id:'screenPanel_'+key,role:'tabpanel','aria-labelledby':'screenTab_'+key,hidden:key!=='layout'},...sections);
 tabPanels.append(panel);sections[0].open=true;
 const b=h('button',{type:'button',class:'btn',id:'screenTab_'+key,role:'tab','aria-controls':panel.id,'aria-selected':String(key==='layout'),tabIndex:key==='layout'?0:-1,i18n:'screen.tab_'+key});
 b.onclick=()=>showScreenTab(key);b.onkeydown=e=>{const keys=Object.keys(screenTabs),i=keys.indexOf(key);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();showScreenTab(keys[e.key==='Home'?0:e.key==='End'?keys.length-1:(i+(e.key==='ArrowRight'?1:keys.length-1))%keys.length],true);}};tabBar.append(b);
}
root.append(h('h2',{i18n:'screen.title_main'}),tabBar,tabPanels);
window.ScreenUI={status(s){root.hidden=s.hardware_model!=='BRY88BBA15G';if(root.hidden)return;deviceKey=s.device_id||s.id||deviceKey;const capsBefore=lastStatus?.capabilities;lastStatus=s.screen||{};if(!remotePageBusy)remotePageData=lastStatus.page;renderRemotePage();if(!diagBusy)diagStart.disabled=diagRead.disabled=!(lastStatus.capabilities&524288);if(capsBefore!==lastStatus.capabilities){componentForm();renderAppearance();}fontUpload.disabled=appearanceBusy||!(lastStatus.capabilities&16384);if(appearanceSection.hidden===appearanceSupported())renderAppearance();moduleData=lastStatus.module;renderModule();if(policyPending&&!policyDirty&&lastStatus.display?.applied_revision===policyPending){policyState.textContent=t('screen.policy_applied',{revision:policyPending});policyPending=0;}info.textContent=t(lastStatus.extension_supported?'screen.extension':'screen.factory')+' · '+t('screen.revisions',{saved:lastStatus.layout_revision||0,applied:lastStatus.mcu_layout_revision||0});otaState.textContent=lastStatus.ota?.state||'';renderRecovery(lastStatus.recovery);renderStartup(lastStatus.startup);applyBrightnessData({settings:lastStatus.settings,request:lastStatus.settings_request,brightness:lastStatus.brightness});},load:loadLayout,enter:async()=>{if(!scene&&!loading)await loadLayout();},loadBrightness,loadPolicy,loadStartup,undo};
})();
