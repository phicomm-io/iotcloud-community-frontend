/* A1 air purifier page. Product-specific pages: light effects, M1 binding and
 * automatic control. Shared pages come from ui.js and automation.js. */
(()=>{
'use strict';
const {t}=I18N;
const {$,h,fieldRow,icon,toast,run,onSubmit,confirm,switchRow,seg,summary,card,info,pageHead,saveBar,num,flag,slider,hhmm,toMinutes,normalizeMac,prettyMac,clone}=UI;

let advanced={effect:0,segments:3,segment:[]},bindingStatus={peers:[],members:[],linkage_status:'disabled'},bindingPending=false;
const refresh=()=>UI.reload();

/* ---------- Home: fan ---------- */
const power=$('power');power.append(icon('power'));
const speed=$('speed');let dragging=false;
const presets=seg([[20,()=>t('a1.p_quiet')+' 20%'],[40,()=>t('a1.p_low')+' 40%'],[60,()=>t('a1.p_mid')+' 60%'],[100,()=>t('a1.p_max')+' 100%']],v=>setSpeed(v),{full:true});
$('presets').replaceWith(presets);
const fanModes=seg([['manual','auto.manual'],['auto','auto.auto']],mode=>run(null,()=>UI.control('fan.mode.set',{mode},{fan_mode:mode}),null),{full:true});
$('fanMode').append(fanModes);
function setSpeed(v){speed.value=v;$('speedValue').textContent=v+'%';return run(null,()=>UI.control('fan.set',{speed:Number(v)},{[UI.state.fan_mode==='auto'?'auto_max_speed':'requested_speed']:Number(v)}),null);}
speed.addEventListener('input',()=>{dragging=true;$('speedValue').textContent=speed.value+'%';presets.set(Number(speed.value));});
speed.addEventListener('change',()=>{dragging=false;setSpeed(speed.value);});
power.onclick=()=>{const on=!UI.state.fan_on;power.setAttribute('aria-pressed',String(on));run(power,()=>UI.control('fan.set',{on},{fan_on:on}),null);};
for(const id of ['childLock','childLockDevice'])$(id).onchange=e=>run(null,()=>UI.control('child_lock.set',{enabled:e.target.checked},{child_lock:e.target.checked}),e.target.checked?'a1.lock_on':'a1.lock_off');
function renderFan(s){
 const locked=s.ota_active||s.reboot_pending||UI.controlBusy;
 power.setAttribute('aria-pressed',String(s.fan_on));power.disabled=locked;speed.disabled=locked;
 presets.querySelectorAll('button').forEach(b=>b.disabled=locked);
 const auto=s.fan_mode==='auto';
 $('fanMode').hidden=!UI.caps?.actions?.includes('fan.mode.set');fanModes.set(s.fan_mode||'manual');
 fanModes.querySelectorAll('button').forEach(b=>b.disabled=locked);
 $('speedLabel').textContent=t(auto?'auto.maximum':'a1.speed');
 $('fanState').textContent=s.fan_on?t(s.fan_state==='idle'?'auto.idle':'a1.running'):t('a1.off');
 $('fanSub').textContent=locked?t('a1.locked_ota'):s.fan_on?t(auto?'a1.sub_auto':'a1.sub_manual',{p:s.percentage}):t('a1.sub_off',{p:s.requested_speed});
 const previewSpeed=$('previewSpeed');
 if(previewSpeed&&document.activeElement!==previewSpeed){const value=auto?s.auto_max_speed:s.requested_speed;previewSpeed.value=value;$('previewSpeedValue').textContent=value+'%';}
 if(!dragging&&document.activeElement!==speed){const v=auto?s.auto_max_speed:s.requested_speed;speed.value=v;$('speedValue').textContent=v+'%';presets.set(v);}
 $('outBar').style.width=s.applied_speed+'%';$('targetBar').style.width=s.percentage+'%';$('targetBar').hidden=!s.percentage;
 $('outText').textContent=!s.fan_on&&!s.applied_speed?t('a1.out_stopped'):s.applied_speed!==s.percentage?t('a1.out_ramp',{a:s.applied_speed,p:s.percentage}):t('a1.out_steady',{a:s.applied_speed});
 for(const [id,badge] of [['panelBadge',$('panelBadge')],['panelBadge2',$('panelBadge2')]]){badge.className='badge '+(s.panel_ready?'ok':'bad');badge.textContent=t(s.panel_ready?'a1.panel_ok':'a1.panel_bad');}
 for(const id of ['childLock','childLockDevice'])$(id).checked=s.child_lock;
}

/* Filter usage is owned by the device, including across browser sessions. */
let filterBusy=false,filterDirty=false,filterModelDirty=false;
function renderFilter(s){
 const f=s.filter,card=$('filterCard');card.hidden=!f||!Number.isFinite(f.remaining_percent);
 if(card.hidden)return;
 const remaining=Math.max(0,Math.min(100,f.remaining_percent));
 $('filterRemaining').textContent=remaining+'%';
 $('filterUsage').textContent=t('filter.usage',{used:(f.used_seconds/3600).toFixed(1),total:f.lifetime_hours});
 $('filterBar').style.width=remaining+'%';$('filterProgress').setAttribute('aria-valuenow',String(remaining));
 const badge=$('filterBadge');badge.className='badge '+(f.replacement_due?'warn':'ok');
 badge.textContent=t(remaining===0?'filter.expired':f.replacement_due?'filter.due':'filter.normal');
 if(!filterDirty&&document.activeElement!==$('filterLifetime'))$('filterLifetime').value=f.lifetime_hours;
 const extended=Number.isFinite(f.weighted_remaining_percent)&&Number.isFinite(f.air_volume_m3_estimate);
 $('filterEstimates').hidden=!extended;
 $('filterHint').textContent=t(extended?'filter.dual_hint':'filter.hint');
 if(extended){
  $('filterEstimateValues').replaceChildren(summary([
   ['filter.current_model',t(f.model==='weighted_estimate'?'filter.weighted':'filter.runtime')],
   ['filter.time_remaining',f.time_remaining_percent+'%'],['filter.weighted_remaining',f.weighted_remaining_percent+'%'],
   ['filter.volume',f.air_volume_m3_estimate.toLocaleString(I18N.lang,{maximumFractionDigits:3})+' m³']]));
  if(!filterModelDirty)$('filterModel').value=f.model;
 }
 const locked=filterBusy||UI.controlBusy||s.ota_active||s.reboot_pending||s.wifi_trial_active;
 const canModel=UI.caps?.actions?.includes('filter.model.set');
 $('filterModelForm').hidden=!canModel;
 $('filterForm').hidden=UI.caps?.hub_remote===true&&!UI.caps.actions?.includes('filter.set');
 $('filterReset').hidden=UI.caps?.hub_remote===true&&!UI.caps.actions?.includes('filter.reset');
 for(const id of ['filterModel','filterModelSave'])$(id).disabled=!!locked;
 for(const id of ['filterSave','filterReset','filterLifetime'])$(id).disabled=!!locked;
}
$('filterLifetime').oninput=()=>{filterDirty=true;};
$('filterModel').onchange=()=>{filterModelDirty=true;};
async function changeFilter(action,params){
 if(filterBusy)return;filterBusy=true;if(UI.state)renderFilter(UI.state);
 try{const saved=await command(action,params);if(action==='filter.set')filterDirty=false;if(action==='filter.model.set')filterModelDirty=false;UI.state.filter=saved;renderFilter(UI.state);await refresh();}
 finally{filterBusy=false;if(UI.state)renderFilter(UI.state);}
}
onSubmit($('filterModelForm'),()=>changeFilter('filter.model.set',{weighted:$('filterModel').value==='weighted_estimate'}));
onSubmit($('filterForm'),()=>changeFilter('filter.set',{lifetime_hours:Number($('filterLifetime').value)}));
$('filterReset').onclick=()=>run(null,async()=>{
 if(!await confirm({title:t('filter.reset'),body:t('filter.confirm'),ok:t('filter.reset'),danger:true}))return;
 await changeFilter('filter.reset',{});toast(t('filter.reset_done'));
},null);

/* ---------- Home: automatic control summary ---------- */
function renderAuto(){
 const c=$('autoCard'),st=bindingStatus.linkage_status,peers=bindingStatus.peers||[];
 c.hidden=UI.caps?.hub_remote===true&&!UI.caps.actions?.includes('binding.status.get');
 const head=h('div',{class:'card-head'},h('div',{},h('h2',{},h('a',{href:'#settings/linkage',i18n:'a1.auto'})),h('p',{class:'help',i18n:'a1.auto_lead'})),
  h('div',{class:'row'},h('span',{class:'badge '+(st==='active'?'ok':st==='sensor_failed'?'warn':'')},t(['disabled','active','sensor_failed'].includes(st)?'s.link_'+st:'s.unknown')),
   h('a',{class:'btn',href:'#settings/linkage'},h('span',{},t('auto.settings')))));
 if(!peers.length){c.replaceChildren(head,h('div',{class:'empty'},h('p',{},t(UI.state?.fan_mode==='auto'?'auto.no_sensor':'a1.auto_empty')),
  h('a',{class:'btn',href:'#settings/binding',style:'margin-top:12px'},icon('link'),h('span',{},t('a1.auto_link')))));return;}
 const fresh=peers.filter(p=>p.fresh).length;
 const meta=h('p',{class:'help'},t('a1.auto_peers',{n:peers.length,f:fresh})+' · '+peers.map(p=>String(p.transport||'mqtt').toUpperCase()).join('/'));
 const avg=bindingStatus.average||{};
 const readings=h('div',{class:'fields'},...[["temperature","°C"],["humidity","%"],["pm25","µg/m³"],["formaldehyde","mg/m³"],...(avg.co2_supported?[["co2","ppm"]]:[])].filter(([key])=>avg.fields?avg.fields[key]:key==='co2'?avg.co2_valid:avg.valid).map(([key,unit])=>h('div',{class:'field'},h('span',{},t('average.'+key)),h('b',{},(key==='co2'?avg.co2_valid:avg.valid)&&Number.isFinite(avg[key])?Number(avg[key]).toFixed(key==='co2'?0:key==='formaldehyde'?3:1)+' '+unit:'—'))));
 if(st==='disabled'){c.replaceChildren(head,meta,readings,h('a',{class:'btn',href:'#settings/linkage',style:'margin-top:12px'},h('span',{},t('a1.auto_enable'))));return;}
 // replaceChildren() stringifies null, so build the list explicitly.
 const rows=[head,readings];
 if(st==='sensor_failed')rows.push(h('div',{class:'banner warn'},icon('alert'),h('span',{},t('a1.auto_failed'))));
 rows.push(h('div',{class:'row between'},meta,h('span',{class:'badge info'},t('a1.auto_speed',{p:Number.isFinite(bindingStatus.automatic_speed)?bindingStatus.automatic_speed:'—'}))));
 c.replaceChildren(...rows);
}

/* ---------- Home: light ring ---------- */
const SWATCHES=[[217,80,0],[255,255,255],[255,170,60],[0,90,255],[0,200,120],[170,60,255],[255,30,60]];
let lightDirty=false,lightTimer=null,ringAnimationTimer=null,previewTarget=null,color=[0,0,255];
const hex=c=>'#'+c.map(n=>n.toString(16).padStart(2,'0')).join('');
const custom=h('input',{type:'color','aria-label':'custom'});
$('swatches').append(...SWATCHES.map(c=>h('button',{type:'button',class:'swatch',style:'--c:'+hex(c),'aria-label':hex(c),onclick:()=>{color=c;lightChanged();}})),custom);
custom.oninput=()=>{const v=custom.value;color=[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));lightChanged();};
for(const id of ['ledEnabled','ledAlways'])$(id).onchange=lightChanged;
$('bright').oninput=lightChanged;
function lightChanged(){
 lightDirty=true;renderLightControls();if(UI.state)renderRing(UI.state);
 $('lightSave').textContent=t('common.saving');clearTimeout(lightTimer);
 // Debounced auto-save replaces the old "Apply" button.
 lightTimer=setTimeout(async()=>{try{
  await api('/light/config',{enabled:$('ledEnabled').checked,always_on:$('ledAlways').checked,brightness:Number($('bright').value),color:{r:color[0],g:color[1],b:color[2]}});
  $('lightSave').textContent=t('common.saved');lightDirty=false;}catch(e){$('lightSave').textContent='';toast(e.message,true);}},600);
}
function renderLightControls(){
 const on=$('ledEnabled').checked;
 $('brightValue').textContent=Math.round($('bright').value/255*100)+'%';
 document.querySelectorAll('.swatch').forEach((b,i)=>b.setAttribute('aria-pressed',String(hex(SWATCHES[i])===hex(color))));
 custom.value=hex(color);
 for(const el of [$('ledAlways'),$('bright'),custom,...document.querySelectorAll('.swatch')])el.disabled=!on;
}
function renderRing(s){
 if(!s)return;const N=31,svgs=document.querySelectorAll('.ring-preview-svg'),enabled=$('ledEnabled').checked&&!!s.fan_on,brightness=Number($('bright').value)/255;
 const touching=previewTarget!==null||!!s.touch_active,eff=touching?0:advanced.effect,now=performance.now(),speed=Number(s.percentage??s.speed??s.requested_speed??0),sources=Array.from({length:N},()=>[0,0,0]);
 const feedbackSpeed=Math.max(0,Math.min(100,Number(touching?(previewTarget??s.requested_speed??s.speed??0):(s.applied_speed??0))));
 const followSpeed=s.fan_on?speed:0;
 // Physical LEDs 1..31 occupy output slots 18..31,1..17; slot 0 is not on the ring.
 const slotForLed=index=>((index+17)%N)+1;
 const slotColors=Array.from({length:32},()=>[0,0,0]);
 const clip=v=>Math.max(0,Math.min(1,v));
 if(enabled&&brightness&&eff===0){
  for(let i=0;i<N;i++){
   const delta=Math.abs(i-9),distance=Math.min(delta,N-delta);
   const x=Math.max(0,Math.min(200,16*feedbackSpeed-100*(distance-1)));
   const level=!feedbackSpeed?0:!distance?255:Math.floor((255*x*x*(600-2*x)+4000000)/8000000);
   sources[i]=color.map(v=>Math.floor(Math.floor(v*brightness)*level/255)/255*(advanced.follow_fan&&!touching?followSpeed/100:1));
  }
 }else if(enabled&&brightness&&eff===4){
  const cfg=advanced,n=Math.max(1,Math.min(4,Number(cfg.segments)||1)),avg=bindingStatus.average||{};let at=0;
  for(let part=0;part<n;part++){
   const length=Math.floor(32/n)+(part<32%n?1:0),lit=length-(n>1?1:0),segment=cfg.segment?.[part];
   if(segment){
    let value=0,valid=true;
    if(segment.source<4){const key=['temperature','humidity','pm25','formaldehyde'][segment.source];value=Number(avg[key]??s[key]??0);valid=avg.valid===true||s.sensor_valid===true;}
    else if(segment.source===5)value=followSpeed;
    else{valid=avg.valid===true||s.sensor_valid===true;value=Math.max((Number(avg.pm25??s.pm25??0)/Math.max(Number(cfg.quality_pm)||1,0.01)),(Number(avg.formaldehyde??s.formaldehyde??0)/Math.max(Number(cfg.quality_hcho)||1,0.001)));}
    if(valid){
     let colorIndex=value<segment.suitable_low?0:value>segment.suitable_high?2:1;if(segment.display===0)colorIndex=1;
     const range=Number(segment.maximum)-Number(segment.minimum),level=segment.display===1?1:range>0?clip((value-Number(segment.minimum))/range):0;
     const levelBrightness=brightness*level*(cfg.follow_fan?followSpeed/100:1),rgb=(segment.colors?.[colorIndex]||[0,0,0]).map(v=>Number(v)*levelBrightness/255);
     for(let i=0;i<lit;i++)slotColors[at+i]=rgb;
    }
   }
   at+=length;
  }
  for(let i=0;i<N;i++)sources[i]=slotColors[slotForLed(i)];
 }else if(enabled&&brightness){
  let level=brightness*(advanced.follow_fan?followSpeed/100:1);
  const animationMs=now*(advanced.speed||5)/5;
  if(eff===2||eff===5)level*=((1+Math.sin(animationMs/2000))/2);
  for(let i=0;i<N;i++){
   let rgb=color;
   if(eff===3||eff===5){const p=((eff===3?Math.floor(slotForLed(i)*768/32):0)+Math.floor(animationMs/30))%768;rgb=[p<256?255-p:p>512?p-512:0,p<256?p:p<512?511-p:0,p<256?0:p<512?p-256:767-p];}
   sources[i]=rgb.map(v=>v/255*level);
  }
 }
 const step=Math.PI*2/N,base=Math.PI/2-9*step,radius=77,samples=24,parts=[
  '<circle class="ring-guide" cx="100" cy="100" r="77"></circle>',
  '<circle class="ring-edge" cx="100" cy="100" r="85"></circle>',
  '<circle class="ring-edge" cx="100" cy="100" r="69"></circle>',
  '<text class="ring-anchor" x="100" y="198" text-anchor="middle">10</text>'
 ];
 // Wendland C2 gives a smooth, compact light spread that reaches zero at two LED pitches.
 const falloff=d=>{const r=d/2;if(r>=1)return 0;const q=1-r;return q*q*q*q*(4*r+1);};
 const point=a=>[100+radius*Math.cos(a),100+radius*Math.sin(a)];
 for(let sample=0;sample<N*samples;sample++){
  const position=(sample+0.5)/samples,a0=base+sample/samples*step,a1=base+(sample+1)/samples*step,[x0,y0]=point(a0),[x1,y1]=point(a1),mix=[0,0,0];
  for(let i=0;i<N;i++){
   if(!sources[i].some(v=>v>0))continue;
   const raw=Math.abs(position-i),distance=Math.min(raw,N-raw),weight=falloff(distance);
   if(!weight)continue;
   for(let c=0;c<3;c++)mix[c]=Math.min(1,mix[c]+sources[i][c]*weight);
  }
  const strength=Math.max(...mix);
  if(strength>0.00001){
   const rgb=mix.map(v=>Math.round(v/strength*255));
   parts.push('<path class="ring-light-segment" d="M'+x0.toFixed(3)+' '+y0.toFixed(3)+' A'+radius+' '+radius+' 0 0 1 '+x1.toFixed(3)+' '+y1.toFixed(3)+'" stroke="rgb('+rgb.join(',')+')" stroke-opacity="'+strength.toFixed(4)+'"></path>');
  }
 }
 for(const svg of svgs){
  svg.dataset.feedbackSpeed=String(feedbackSpeed);svg.dataset.feedbackSource=touching?'target':'pwm';
  svg.setAttribute('role','img');svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',t('a1.ring_aria'));
  svg.innerHTML=parts.join('')+'<text x="100" y="98" text-anchor="middle" class="ring-v">'+(enabled?(eff===0?feedbackSpeed:Math.round(brightness*100))+'%':t('state.off'))+'</text><text x="100" y="122" text-anchor="middle" class="ring-l">'+(eff===0?t(touching?'a1.feedback_target':'a1.feedback_pwm'):effectLabel(eff))+'</text>';
 }
}
// Animation uses accepted state; network feedback belongs to the shared owner.
function ringVisible(){const page=document.querySelector('[data-settings-page="light"]');return !document.hidden&&(!$('homePage').hidden||page&&!page.hidden);}
window.addEventListener('pagehide',()=>{clearInterval(ringAnimationTimer);ringAnimationTimer=null;});
window.addEventListener('pageshow',()=>{if(ringAnimationTimer===null)updateRingAnimation();});
function updateRingAnimation(){
 clearInterval(ringAnimationTimer);
 ringAnimationTimer=setInterval(()=>{
  if(!UI.state||!ringVisible())return;
  if(advanced.effect===2||advanced.effect===3||advanced.effect===5||previewTarget!==null)renderRing(UI.state);
 },50);
}
function effectLabel(effect){return t([0,1,2,3,4,5].includes(effect)?'a1.effect.'+effect:'s.unknown');}
function renderLight(s){
 if(!lightDirty){$('ledEnabled').checked=s.led_enabled;$('ledAlways').checked=s.led_always_on;$('bright').value=s.brightness;color=[s.red,s.green,s.blue];renderLightControls();}
 $('effectNote').hidden=UI.caps?.hub_remote===true;
 $('effectNote').replaceChildren(...(UI.caps?.hub_remote?[]:[t('a1.effect_note',{e:effectLabel(advanced.effect)})+' ',h('a',{href:'#settings/light'},t('a1.effect_change'))]));
 renderRing(s);
}

/* ---------- Settings: light effects ---------- */
const EFFECTS=[0,1,2,3,4,5];
async function showLight(options={}){
 const page=document.querySelector('[data-settings-page="light"]');
 let nextBinding=bindingStatus;try{nextBinding=await api('/binding/status',undefined,options);}catch(e){if(e.name==='AbortError')throw e;}
 const fields=nextBinding.average?.fields;
 const sourceAvailable=v=>!fields||v===5||(v===4?(fields.pm25||fields.formaldehyde):fields[['temperature','humidity','pm25','formaldehyde'][v]]);
 const config=await api('/light/advanced',undefined,options);if(options.current&&!options.current())return;
 bindingStatus=nextBinding;const m=clone(advanced=config),hasSpeed=Number.isInteger(m.speed);updateRingAnimation();
 const refreshDraft=()=>{advanced=clone(m);updateRingAnimation();if(UI.state)renderRing(UI.state);};
 page.oninput=refreshDraft;page.onchange=refreshDraft;
 const draw=()=>{
  const opts=h('div',{class:'options',role:'radiogroup'},EFFECTS.map(e=>h('label',{class:'option'},h('input',{type:'radio',name:'effect',value:e,checked:m.effect===e,onchange:()=>{m.effect=e;refreshDraft();draw();}}),
   h('b',{},t('a1.effect.'+e)),h('span',{},t('a1.effect_desc.'+e)))));
  const segs=m.effect===4?h('div',{class:'stack'},
   h('div',{class:'row between'},h('span',{class:'label',i18n:'fx.count'}),seg([1,2,3,4].map(n=>[n,String(n)]),n=>{m.segments=n;draw();})),
   ...m.segment.slice(0,m.segments).map((sg,i)=>h('div',{class:'subcard stack'},h('h3',{},t('fx.segment',{n:i+1})),
    h('div',{class:'fields'},
     fieldRow('fx.source',h('select',{onchange:e=>sg.source=+e.target.value},[0,1,2,3,4,5].filter(sourceAvailable).map(v=>h('option',{value:v,selected:sg.source===v},t('fx.src.'+v))))),
     fieldRow('fx.display',h('select',{onchange:e=>sg.display=+e.target.value},[0,1,2].map(v=>h('option',{value:v,selected:sg.display===v},t('fx.disp.'+v)))))),
    h('div',{class:'sentence',style:'margin-top:12px'},t('fx.range'),num(sg,'minimum'),'–',num(sg,'maximum'),h('span',{class:'help'},t('fx.comfort')),num(sg,'suitable_low'),'–',num(sg,'suitable_high')),
    h('div',{class:'row',style:'margin-top:12px'},['fx.low','fx.ok','fx.high'].map((k,j)=>h('label',{class:'row small'},h('input',{type:'color',value:hex(sg.colors[j]),oninput:e=>{const v=e.target.value;sg.colors[j]=[1,3,5].map(x=>parseInt(v.slice(x,x+2),16));}}),t(k)))))))
   :null;
  if(segs)segs.querySelector('.seg').set(m.segments);
  const speedControls=[];
  if(hasSpeed&&[2,3,5].includes(m.effect)){const [out,range]=slider(m,'speed',{min:1,max:10,fmt:v=>(v/5).toFixed(1)+'×'});range.setAttribute('aria-label',t('fx.speed'));speedControls.push(h('div',{class:'stack',style:'margin-top:16px'},h('div',{class:'row between'},h('span',{class:'label',i18n:'fx.speed'}),out),range,h('div',{class:'row between help'},t('fx.slow'),t('fx.fast'))));}
  const previewSpeed=h('input',{id:'previewSpeed',type:'range',min:1,max:100,step:1,value:UI.state?.fan_on?UI.state.percentage:UI.state?.requested_speed||60,'aria-label':t('a1.speed'),
   oninput:e=>{previewTarget=Number(e.target.value);$('previewSpeedValue').textContent=e.target.value+'%';renderRing(UI.state);},
   onchange:()=>{previewTarget=null;renderRing(UI.state);return run(previewSpeed,()=>setSpeed(previewSpeed.value),null);},
   onblur:()=>{previewTarget=null;if(UI.state)renderRing(UI.state);}});
  const previewRing=document.createElementNS('http://www.w3.org/2000/svg','svg');
  previewRing.setAttribute('class','ring ring-preview-svg');previewRing.setAttribute('viewBox','0 0 200 200');
  page.replaceChildren(pageHead('nav.light','fx.lead'),
   h('div',{class:'ring-effect-preview'},previewRing,
    h('div',{class:'ring-preview-controls'},h('div',{class:'row between'},h('span',{class:'label',i18n:'a1.speed'}),h('b',{class:'num',id:'previewSpeedValue'},previewSpeed.value+'%')),previewSpeed)),
   h('section',{class:'card'},h('div',{class:'card-head'},h('h2',{i18n:'fx.effect'})),opts,...speedControls,
    h('div',{style:'margin-top:16px'},flag(m,'follow_fan','fx.follow','fx.follow_desc')),segs,
    h('details',{class:'more'},h('summary',{i18n:'common.advanced'}),h('p',{class:'help',i18n:'fx.quality_hint'}),
     h('div',{class:'fields'},(!fields||fields.pm25)?fieldRow('fx.quality_pm',num(m,'quality_pm',{unit:'µg/m³',step:0.01})):null,
      (!fields||fields.formaldehyde)?fieldRow('fx.quality_hcho',num(m,'quality_hcho',{unit:'mg/m³',step:0.001})):null)),
   saveBar(async()=>{const saved=await api('/light/advanced',m);m.revision=saved.revision;advanced=clone(m);updateRingAnimation();if(UI.state)renderLight(UI.state);})));
  if(UI.state)renderRing(UI.state);
 };
 draw();
}

/* ---------- Settings: M1 binding ---------- */
async function showBinding(options={}){
 const nextBinding=await api('/binding/status',undefined,options).catch(e=>{if(e.name==='AbortError')throw e;return bindingStatus;});
 const m=await api('/binding/config',undefined,options);if(options.current&&!options.current())return;bindingStatus=nextBinding;const page=document.querySelector('[data-settings-page="binding"]');
 const capacity=Number(m.max_peers)||4;
 const save=()=>api('/binding/config',m).then(showBinding);
 const st=mac=>(bindingStatus.peers||[]).find(p=>p.mac===mac)||{};
 const peerItems=m.peers.map((p,i)=>{const s=st(p.mac);
  const probe=h('button',{type:'button',class:'btn ghost icon',title:t('bind.probe'),'aria-label':t('bind.probe')},icon('auto'));
  probe.onclick=()=>run(probe,()=>api('/binding/probe',{mac:p.mac}),'bind.probe_sent');
  const del=h('button',{type:'button',class:'btn ghost icon','aria-label':t('common.delete')},icon('trash'));
  del.onclick=async()=>{if(await confirm({title:t('bind.remove_q'),body:t('bind.remove_body',{m:prettyMac(p.mac)}),ok:t('common.delete'),danger:true})){m.peers.splice(i,1);run(del,save);}};
  return h('div',{class:'item binding-peer'},icon('air'),h('div',{class:'grow'},h('b',{class:'num'},t('bind.sensor')+' · '+prettyMac(p.mac)),h('span',{},s.ip||p.ip||t('bind.ip_auto'))),
   h('span',{class:'badge'},String(s.transport||'offline').toUpperCase()),
   h('span',{class:'badge '+(s.pending?'warn':s.fresh?'ok':'bad')},t(s.pending?'bind.pending':s.fresh?'bind.fresh':'bind.stale')),probe,del);});
 const mac=h('input',{placeholder:'B0:F8:93:28:64:B6',maxLength:17,required:true,autocomplete:'off'});
 const ip=h('input',{placeholder:t('bind.ip_ph'),maxLength:15});
 const opts={force_mqtt:false,recovery:true,timeout_ms:1000,recovery_seconds:60};
 const add=h('form',{class:'subcard stack'},h('h3',{i18n:'bind.add'}),
  h('div',{class:'fields'},fieldRow('bind.mac',mac),fieldRow('bind.ip',ip)),
  h('details',{class:'more'},h('summary',{i18n:'common.advanced'}),flag(opts,'recovery','bind.recovery','bind.recovery_desc'),
   h('div',{class:'fields'},fieldRow('bind.timeout',num(opts,'timeout_ms',{unit:'ms',min:100})),
    fieldRow('bind.recovery_s',num(opts,'recovery_seconds',{unit:t('unit.s'),min:5})))),
  h('div',{class:'form-actions'},h('button',{class:'btn primary',type:'submit',disabled:m.peers.length>=capacity},icon('plus'),h('span',{},t('bind.add_btn')))));
 onSubmit(add,()=>{const id=normalizeMac(mac.value);if(!id)throw Error(t('bind.bad_mac'));
  if(m.peers.some(p=>p.mac===id))throw Error(t('bind.dup'));if(m.peers.length>=capacity)throw Error(t('common.max',{n:capacity}));
  m.peers.push({mac:id,ip:ip.value.trim(),kind:1,...opts});return save();},'bind.added');
 // Purifier group stays collapsed: it is only used with several A1 units.
 const members=h('div',{class:'list'},m.members.map((mb,i)=>h('div',{class:'item'},icon('fan'),
  h('div',{class:'grow'},h('b',{class:'num'},'A1 · '+prettyMac(mb.mac)),h('span',{},mb.ip||t('bind.ip_auto'))),
  h('button',{type:'button',class:'btn ghost icon','aria-label':t('common.delete'),onclick:()=>{m.members.splice(i,1);save();}},icon('trash')))));
 const gmac=h('input',{placeholder:'B0:F8:93:30:31:34',maxLength:17});
 const group=h('details',{class:'card more'},h('summary',{i18n:'bind.group'}),h('p',{class:'help',i18n:'bind.group_lead'}),
  fieldRow('bind.group_name',h('input',{value:m.group,maxLength:32,placeholder:t('bind.group_ph'),oninput:e=>m.group=e.target.value})),
  members,h('div',{class:'row'},h('div',{class:'grow'},gmac),
   h('button',{type:'button',class:'btn',onclick:()=>{const id=normalizeMac(gmac.value);if(!id){toast(t('bind.bad_mac'),true);return;}m.members.push({mac:id,ip:''});save();}},icon('plus'),h('span',{},t('bind.member_add')))),
  flag(m,'group_force_mqtt','bind.force','bind.force_desc'),flag(m,'group_recovery','bind.recovery','bind.recovery_desc'),
  h('div',{class:'fields'},fieldRow('bind.timeout',num(m,'group_timeout_ms',{unit:'ms'})),
   fieldRow('bind.recovery_s',num(m,'group_recovery_seconds',{unit:t('unit.s')}))),
  saveBar(save));
 page.replaceChildren(pageHead('nav.binding','bind.lead'),
  h('section',{class:'card'},h('div',{class:'card-head'},h('h2',{i18n:'bind.sensors'}),h('span',{class:'badge'},m.peers.length+' / '+capacity)),
   peerItems.length?h('div',{class:'list'},peerItems):h('div',{class:'empty'},t('bind.empty')),add,info('bind.hint')),group);
}

/* ---------- Settings: automatic control rules ---------- */
let linkageDraws=[];
async function showLinkage(options={}){
 const page=document.querySelector('[data-settings-page="linkage"]');
 let nextBinding=bindingStatus;try{nextBinding=await api('/binding/status',undefined,options);}catch(e){if(e.name==='AbortError')throw e;}
 const staged=h('div'),draws=[];
 for(const fresh of UI.caps?.fresh_air?[false,true]:[false]){
  const section=h('section',{class:'stack','data-auto-fan':fresh?'fresh':'primary'});staged.append(section);
  draws.push(await showFanRules(fresh,section,options,nextBinding));
 }
 if(options.current&&!options.current())return;
 bindingStatus=nextBinding;linkageDraws=draws;page.replaceChildren(...staged.childNodes);
}
async function showFanRules(fresh,page,options={},binding=bindingStatus){
 const m=await (fresh?command('fresh_air.linkage.get',{},options):api('/linkage/config',undefined,options));
 const modern=UI.caps?.actions?.includes('fan.mode.set');
 const supportsMetric=bit=>{const current=page.isConnected?bindingStatus:binding,available=current.average?.fields;return available?!!available[({1:'pm25',2:'formaldehyde',4:'co2'})[bit]]:bit===4?!!current.average?.co2_valid:!!current.average?.valid;};
 const draw=()=>{
  const supportsCO2=Object.hasOwn(m,'target_co2')&&supportsMetric(4);
  const availableMask=[1,2,...(supportsCO2?[4]:[])].reduce((mask,bit)=>supportsMetric(bit)?mask|bit:mask,0);
  const choose=h('div',{class:'fields'},[[1,'PM2.5'],[2,t('m.formaldehyde')],...(supportsCO2?[[4,'CO₂']]:[])].filter(([bit])=>supportsMetric(bit)).map(([bit,label])=>h('label',{class:'row'},h('input',{type:'checkbox',checked:!!(m.metrics&bit),onchange:e=>{const next=e.target.checked?m.metrics|bit:m.metrics&~bit;if(!next){e.target.checked=true;return;}m.metrics=next;draw();}}),label)));
  const modes=seg([[0,'link.mode.0'],[1,'link.mode.1'],[2,'link.mode.2']],v=>{m.mode=v;draw();});modes.set(m.mode);
  const detail=[],gate=[];
  const supportsGate=Object.hasOwn(m,'hysteresis_enabled');
  const field=(key,label,options={})=>h('label',{class:'field'},h('span',{},t(label)),num(m,key,options));
  if(m.mode===0)detail.push(field('fixed_speed','link.fixed',{min:1,max:100,unit:'%'}));
  if(m.mode===1){
   if((m.metrics&1)&&supportsMetric(1))detail.push(field('low_pm','auto.low_pm',{min:0,unit:'µg/m³'}),field('high_pm','auto.high_pm',{min:0,unit:'µg/m³'}));
   if((m.metrics&2)&&supportsMetric(2))detail.push(field('low_hcho','auto.low_hcho',{min:0,step:.001,unit:'mg/m³'}),field('high_hcho','auto.high_hcho',{min:0,step:.001,unit:'mg/m³'}));
  }
  if(m.mode===1&&(m.metrics&4)&&supportsMetric(4))detail.push(field('low_co2','auto.low_co2',{min:0,max:65535,unit:'ppm'}),field('high_co2','auto.high_co2',{min:1,max:65535,unit:'ppm'}));
  if(supportsCO2)detail.push(info('link.co2_help'));
  if(supportsGate){
   const toggle=flag(m,'hysteresis_enabled','auto.hysteresis','auto.hysteresis_help');
   toggle.querySelector('input').addEventListener('change',draw);
   gate.push(toggle);
   if(m.hysteresis_enabled){
    if((m.metrics&1)&&supportsMetric(1))gate.push(field('target_pm','auto.target_pm',{min:.01,max:5000,unit:'µg/m³'}),field('on_pm','auto.start_pm',{min:0,max:5000,unit:'µg/m³'}));
    if((m.metrics&2)&&supportsMetric(2))gate.push(field('target_hcho','auto.target_hcho',{min:.001,max:10,step:.001,unit:'mg/m³'}),field('on_hcho','auto.start_hcho',{min:0,max:10,step:.001,unit:'mg/m³'}));
    if((m.metrics&4)&&supportsMetric(4))gate.push(field('target_co2','auto.target_co2',{min:1,max:65535,unit:'ppm'}),field('on_co2','auto.start_co2',{min:1,max:65535,unit:'ppm'}));
    gate.push(info('auto.hysteresis_detail'));
   }
  }
  if(m.mode===2){
   if(!m.hysteresis_enabled&&(m.metrics&1)&&supportsMetric(1))detail.push(field('target_pm','link.pid_pm',{min:.01,unit:'µg/m³'}));
   if(!m.hysteresis_enabled&&(m.metrics&2)&&supportsMetric(2))detail.push(field('target_hcho','link.pid_hcho',{min:.001,step:.001,unit:'mg/m³'}));
   if(!m.hysteresis_enabled&&(m.metrics&4)&&supportsMetric(4))detail.push(field('target_co2','auto.target_co2',{min:1,max:65535,unit:'ppm'}));
   detail.push(h('details',{class:'more'},h('summary',{i18n:'link.pid_tune'}),h('div',{class:'fields'},['kp','ki','kd'].map(k=>h('label',{class:'field'},h('span',{},k.toUpperCase()),num(m,k,{min:0,step:.01}))))));
  }
  const range=[field('min_speed','auto.minimum',{min:modern?0:1,max:100,unit:'%'}),field('max_speed','auto.maximum',{min:1,max:100,unit:'%'})];
  if(modern)range.push(field('fallback_speed','auto.fallback',{min:0,max:100,unit:'%'}));
  page.replaceChildren(pageHead(fresh?'fresh.auto':'nav.linkage',fresh?'fresh.auto_help':modern?'auto.help':'link.lead'),
   h('section',{class:'card stack'},fresh?h('a',{class:'btn',href:'#'},t('auto.mode')+' · '+t(UI.state?.fresh_air_mode==='auto'?'auto.auto':'auto.manual')):flag(m,'enabled','link.enable','auto.mode_help'),
    h('div',{class:'fields'},range),modern?info(fresh?'fresh.range_help':'auto.range_help'):null),
   h('section',{class:'card stack'},h('h2',{i18n:'link.speed'}),choose.childElementCount?choose:h('p',{class:'help'},t('auto.no_data_options')),
    availableMask&&(m.metrics&availableMask)!==m.metrics?h('button',{type:'button',class:'btn ghost',onclick:()=>{m.metrics=(m.metrics&availableMask)||availableMask;draw();}},t('auto.available_only')):null,modes,h('div',{class:'fields'},detail)),
   supportsGate?h('section',{class:'card stack'},h('h2',{i18n:'auto.hysteresis_title'}),h('div',{class:'fields'},gate)):null,
   h('section',{class:'card stack'},h('h2',{i18n:'common.advanced'}),
    fieldRow('link.statistic',h('select',{onchange:e=>m.statistic=+e.target.value},[0,1,2,3,4,5].map(v=>h('option',{value:v,selected:m.statistic===v},t('link.stat.'+v))))),
    h('div',{class:'fields'},field('debounce_seconds','link.debounce',{min:0,max:3600,unit:t('unit.s')}),field('min_switch_seconds','link.min_switch',{min:0,max:3600,unit:t('unit.s')}))),
   saveBar(()=>{
    if(m.enabled&&[1,2,4].some(bit=>(m.metrics&bit)&&!supportsMetric(bit)))throw Error(t('auto.unavailable_metric'));
    if(m.min_speed>m.max_speed||((m.metrics&1)&&m.low_pm>=m.high_pm)||((m.metrics&2)&&m.low_hcho>=m.high_hcho)||((m.metrics&4)&&m.low_co2>=m.high_co2))throw Error(t('auto.range_invalid'));
    if(m.hysteresis_enabled&&(((m.metrics&1)&&m.on_pm<=m.target_pm)||((m.metrics&2)&&m.on_hcho<=m.target_hcho)||((m.metrics&4)&&m.on_co2<=m.target_co2)))throw new Error(t('auto.hysteresis_invalid'));
    return (fresh?command('fresh_air.linkage.set',m):api('/linkage/config',m)).then(saved=>{m.revision=saved.revision;return refresh();});
   }));
 };
 draw();return draw;
}

/* Accessory controls are admitted by the device capability, including cloud embeds. */
let freshCard;
function renderFresh(s){
 if(!UI.caps?.fresh_air)return;
 if(!freshCard){freshCard=h('section',{class:'card stack',id:'freshAirCard'});$('autoCard').before(freshCard);}
 const busy=UI.controlBusy||s.ota_active||s.reboot_pending;
 const control=(params,patch)=>run(null,()=>UI.control('fresh_air.set',params,patch),null);
 const on=h('input',{type:'checkbox',checked:s.fresh_air_requested_on,disabled:busy,onchange:e=>control({on:e.target.checked},{fresh_air_requested_on:e.target.checked})});
 const mode=seg([['manual','auto.manual'],['auto','auto.auto']],v=>control({mode:v},{fresh_air_mode:v}),{full:true});mode.set(s.fresh_air_mode);
 mode.querySelectorAll('button').forEach(b=>b.disabled=busy);
 const input=h('input',{type:'range',min:0,max:100,value:s.fresh_air_requested_speed,disabled:busy||s.fresh_air_mode==='auto','aria-label':t('fresh.speed')});
 const value=h('b',{},s.fresh_air_requested_speed+'%');input.oninput=()=>value.textContent=input.value+'%';
 input.onchange=()=>control({speed:+input.value},{fresh_air_requested_speed:+input.value});
 // Do not replace a slider while the user is dragging it.
 if(freshCard.contains(document.activeElement)&&document.activeElement.type==='range')return;
 freshCard.replaceChildren(h('div',{class:'card-head'},h('h2',{i18n:'fresh.title'}),h('label',{class:'row'},h('span',{i18n:'fresh.enable'}),on)),mode,
  fieldRow('fresh.speed',input,value),
  h('p',{class:'help'},t('fresh.status',{target:s.fresh_air_target,applied:s.fresh_air_speed,duty:(s.fresh_air_pwm_milli/1000).toFixed(1),rpm:s.fresh_air_rpm})),
  h('p',{class:'help'},t('fresh.reason.'+(s.fresh_air_limit_reason||0))+(s.fresh_air_fallback?' · '+t('auto.no_sensor'):'')),
  ...(!UI.caps?.hub_remote?[h('div',{class:'row'},h('a',{class:'btn',href:'#settings/freshair'},t('fresh.settings')),h('a',{class:'btn',href:'#settings/linkage'},t('fresh.auto')))]:[]));
}
async function showFresh(options={}){
 const m=await command('fresh_air.config.get',{},options);if(options.current&&!options.current())return;const page=document.querySelector('[data-settings-page="freshair"]');
 const draw=()=>{
  const field=(key,label,options={})=>h('label',{class:'field'},h('span',{},t(label)),num(m,key,options));
  const coupling=seg([[2,'fresh.independent'],[0,'fresh.cap'],[1,'fresh.boost']],v=>{m.coupling=v;draw();});coupling.set(m.coupling);
  const presets=seg([[0,'fresh.high'],[1,'fresh.low']],v=>{m.active_low=!!v;m.a=v?-1:1;m.b=v?100:0;draw();});
  const preview=h('p',{class:'help'});
  const update=()=>preview.textContent=t('fresh.preview')+' '+[0,25,50,75,100].map(v=>v+'% → '+(v?Math.max(m.pwm_min,Math.min(m.pwm_max,m.a*v+m.b)):m.active_low?100:0).toFixed(1)+'%').join(' · ');
  const fields=h('div',{class:'fields'},field('a','fresh.a',{step:'any'}),field('b','fresh.b',{step:'any'}),field('pwm_min','fresh.min',{min:0,max:100,step:'any'}),field('pwm_max','fresh.max',{min:0,max:100,step:'any'}));
  fields.addEventListener('input',update);
  page.replaceChildren(pageHead('fresh.settings','fresh.help'),h('section',{class:'card stack'},coupling,
   m.coupling===2?null:field(m.coupling?'boost_ratio':'cap_ratio',m.coupling?'fresh.boost_ratio':'fresh.cap_ratio',{min:m.coupling?1:0,max:m.coupling?500:100,unit:'%'}),info('fresh.coupling_help')),
   h('section',{class:'card stack'},h('h2',{i18n:'fresh.mapping'}),presets,flag(m,'active_low','fresh.off_high','fresh.off_help'),fields,preview,info('fresh.mapping_help')),
   h('section',{class:'card'},field('pulses_per_rev','fresh.ppr',{min:1,max:255,step:1})),
   saveBar(async()=>{if(!Number.isInteger(m.pulses_per_rev)||m.pulses_per_rev<1||m.pulses_per_rev>255||![m.a,m.b,m.pwm_min,m.pwm_max].every(Number.isFinite)||m.pwm_min<0||m.pwm_min>m.pwm_max||m.pwm_max>100)throw Error(t('fresh.invalid'));
    const {revision,coupling,cap_ratio,boost_ratio,active_low,a,b,pwm_min,pwm_max,pulses_per_rev}=m;
    const saved=await command('fresh_air.config.set',{revision,coupling,cap_ratio,boost_ratio,active_low:!!active_low,a,b,pwm_min,pwm_max,pulses_per_rev});m.revision=saved.revision;await refresh();}));
  page.addEventListener('change',update,{once:true});update();
 };draw();
}

/* ---------- Boot ---------- */
const clock=UI.clockCard({
 load:options=>api('/time/config',undefined,options),
 save:v=>api('/time/config',v),
 status:s=>[['clock.synced',t((bindingStatus&&bindingStatus.clock_valid)?'s.synced':'s.syncing'),(bindingStatus&&bindingStatus.clock_valid)?'ok':'warn'],
  ['clock.uptime',UI.duration(s.uptime_seconds||0)],['clock.memory',(Math.round((s.free_memory||0)/1024))+' KB']]});
$('clockCard').replaceWith(clock.el);

UI.start({
 capabilities(caps){
  if(caps.fresh_air){this.groups[1][1].push('freshair');this.nav.freshair='fresh.settings';this.pages.freshair={show:showFresh};}
  if(caps.actions?.includes('light_effect.get'))api('/light/advanced').then(a=>{advanced=a;updateRingAnimation();if(UI.state)renderLight(UI.state);}).catch(e=>toast(e.message,true));
  renderAuto();pollBinding();
 },
 model:'A1',kindKey:'kind.a1',icon:'fan',mqttHostMax:127,factoryReset:true,
 otaName:'phicomm_a1.ota.bin.signed',haHintKey:'mqtt.ha_a1',otaHintKey:'fw.hint_a1',buttonHintKey:'sys.hint_a1',
 scheduleLead:'sch.lead_a1',hasButtons:true,
 groups:[['grp.network',['network','mqtt']],['grp.device',['device','light']],['grp.auto',['binding','linkage','schedule','buttons','night']],['grp.system',['firmware','diagnostics','logs','maintenance']]],
 nav:{network:'nav.wifi',mqtt:'nav.mqtt',device:'nav.general',light:'nav.light',binding:'nav.binding',linkage:'nav.linkage',schedule:'nav.schedule',buttons:'nav.buttons',night:'nav.sleep',firmware:'nav.firmware',diagnostics:'nav.diagnostics',logs:'nav.logs',maintenance:'nav.maintenance'},
 pages:{device:{show:clock.show,status:clock.status},light:{show:showLight},binding:{show:showBinding},linkage:{show:showLinkage}},
 diagGroups:[['diag.g_fan',['fan_on','requested_fan_on','requested_speed','speed','percentage','applied_speed','fan_ready','child_lock','panel_ready','panel_errors','hardware_errors','panel_raw']],
  ['diag.g_light',['led_enabled','led_visible','led_always_on','brightness','red','green','blue','config_dirty','save_error']],
  ['diag.g_ota_img',['ota_signature_verified','ota_image_verified','ota_key_id','ota_image_length','ota_release_counter','ota_version']]],
 healthChecks:s=>[['diag.c_panel',s.panel_ready?'ok':'bad',s.panel_ready?t('state.ok'):t('diag.errors',{n:s.panel_errors})],
  ['diag.c_fan',s.fan_ready&&!s.hardware_errors?'ok':'bad',s.hardware_errors?t('diag.errors',{n:s.hardware_errors}):t('state.ok')],
  ['diag.c_storage',s.save_error?'bad':'ok',s.save_error||t('state.ok')]],
 chips:s=>s.child_lock?[h('span',{class:'chip'},icon('lock'),h('b',{},t('a1.child_lock')))]:[],
 onStatus:s=>{renderFan(s);renderLight(s);renderFilter(s);renderFresh(s);}
});
I18N.onChange(()=>{if(UI.state){renderAuto();UI.showRoute();}});
// Keep the automatic-control summary fresh even while the home page is idle.
async function pollBinding(){
 if(bindingPending||!UI.caps?.actions?.includes('binding.status.get')||document.hidden||($('homePage').hidden&&UI.activePage()!=='binding'&&UI.activePage()!=='linkage'))return;
 bindingPending=true;
 try{const previous=JSON.stringify([bindingStatus.average?.fields,bindingStatus.average?.valid,bindingStatus.average?.co2_valid]);bindingStatus=await api('/binding/status');if(previous!==JSON.stringify([bindingStatus.average?.fields,bindingStatus.average?.valid,bindingStatus.average?.co2_valid])&&UI.activePage()==='linkage'&&!document.querySelector('[data-settings-page="linkage"] [data-dirty="1"], [data-settings-page="linkage"][data-dirty="1"]'))linkageDraws.forEach(draw=>draw());if(UI.state)renderFan(UI.state);renderAuto();}catch{}finally{bindingPending=false;}
}
(async function poll(){try{await pollBinding();}finally{setTimeout(poll,5000);}})();
})();
