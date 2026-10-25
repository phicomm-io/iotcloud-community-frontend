<script setup>
import {t} from '../i18n.js';

import {computed} from 'vue';
import {socketStates,pressureReading} from '../devicePresentation';
import AppIcon from './AppIcon.vue';
const props=defineProps({device:Object,state:Object,name:String,connected:Boolean,now:Number});
const live=computed(()=>(props.connected||props.state?.lan_connected)&&props.state?.available!==false);
const sockets=computed(()=>socketStates(props.state));
const knownSockets=computed(()=>live.value&&sockets.value.length===6&&sockets.value.every(v=>typeof v==='boolean'));
const pm=computed(()=>props.device.model==='daikin'?props.state?.sensors?.pm25?.value:props.state?.pm25);
const freshAir=computed(()=>live.value&&props.state?.sensorAt&&(props.device.model==='daikin'?props.state?.sensors?.pm25?.valid&&props.now-props.state.sensorAt+(props.state.sensors.pm25.age_ms||0)<20000:props.state?.sensor_valid&&props.now-props.state.sensorAt<=15000)&&valid(pm.value));
const co2=computed(()=>{if(props.device.model==='daikin'){const c=props.state?.sensors?.co2;return live.value&&c?.valid&&typeof c.value==='number'&&props.now-props.state.sensorAt+c.age_ms<20000?Math.round(c.value):null;}const s=props.state?.scd40;return live.value&&s?.ready&&s.valid&&s.age_ms<20000&&props.state?.sensorAt&&props.now-props.state.sensorAt<20000&&typeof s.co2_ppm==='number'?Math.round(s.co2_ppm):null;});
const pressure=computed(()=>live.value?pressureReading(props.state,props.now):null);
const quality=computed(()=>!freshAir.value?'—':Number(pm.value)>75||Number(props.device.model==='daikin'&&props.state?.sensors?.formaldehyde?.valid?props.state.sensors.formaldehyde.value:props.state.formaldehyde)>0.1?t('p.895dcef3f1bd'):Number(pm.value)>35||Number(props.device.model==='daikin'&&props.state?.sensors?.formaldehyde?.valid?props.state.sensors.formaldehyde.value:props.state.formaldehyde)>0.08?t('p.91e25f4ddc6f'):t('p.cfea0dce5c5d'));
const presence=computed(()=>{
 if(!props.connected&&!props.state?.lan_connected)return {label:t('p.3d52574ce150'),tone:'muted'};
 if(props.state?.available===false)return {label:t('p.be1b4f3c6c1c'),tone:'muted'};
 const ready=['m1','daikin'].includes(props.device.model)?freshAir.value:props.device.model==='tc1'?knownSockets.value:props.state?.fan_on!==undefined;
 return ready?{label:t('p.b9086662b1df'),tone:'online'}:{label:t('p.5d06446987af'),tone:'waiting'};
});
const speed=computed(()=>props.state?.applied_speed??props.state?.percentage??props.state?.speed);
function valid(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function reading(v,digits=0){return live.value&&valid(v)?Number(v).toFixed(digits):'—';}
</script>
<template>
<span class="device-summary">
 <span class="rack-head"><span class="presence-pill" :class="presence.tone" role="status">{{presence.label}}</span><b :title="name">{{name}}</b></span>
 <span v-if="device.model==='tc1'" class="rack-body tc1-body">
  <span class="stat">{{reading(state?.power_watts??state?.power,1)}}<small>W</small></span>
  <span class="socket-info"><span class="sockets" role="img" :aria-label="sockets.map((v,i)=>t('p.adb6a3f989a5',{v0:(i+1),v1:t(!live||v===undefined?'state.unknown':v?'state.on':'state.off')})).join('; ')"><i v-for="i in 6" :key="i" :class="{on:live&&sockets[i-1]===true,unknown:!live||sockets[i-1]===undefined}"/></span></span>
 </span>
 <span v-else-if="['m1','daikin'].includes(device.model)" class="rack-body m1-body">
  <span class="ring-mini"><span>{{quality}}</span></span><span class="sensor-copy"><span class="stat">{{freshAir?Math.round(Number(pm)):'—'}}<small>μg/m³</small></span></span><small class="rack-detail sensor-details"><span>PM2.5</span><span v-if="co2!==null"> · CO₂ {{co2}} ppm</span><span v-if="pressure!==null" :title="state.barometer.model"> · {{pressure.toFixed(1)}} hPa</span></small>
 </span>
 <span v-else-if="device.model==='a1'" class="rack-body"><span class="stat">{{live&&state?.fan_on!==undefined?(state.fan_on?reading(speed):'0'):'—'}}<small>%</small></span><span class="sensor-copy"><AppIcon name="fan" :size="28"/><small v-if="live&&state?.fan_mode" class="rack-detail">{{state.fan_mode==='auto'?t('p.7eb336e42cb5'):t('p.962f41ef825b')}} · {{!state.fan_on?t('p.5acf2082d7fd'):state.fan_state==='idle'?t('p.bed4c87f1838'):t('p.75b269496f69')}}</small></span></span>
</span>
</template>
<style scoped>
.device-summary{display:grid;grid-template-rows:24px 54px;gap:8px;min-width:0;width:100%;text-align:left}.rack-head{display:flex;align-items:center;gap:8px;min-width:0;padding-right:24px}.rack-head b{font-size:14px;line-height:1.4;min-width:0;color:var(--text);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.rack-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}.rack-dot.online{background:var(--success)}.summary-type,.rack-detail,.summary-reading{font-size:12px;font-weight:400;color:var(--muted);line-height:1.6}.rack-body{display:flex;align-items:center;gap:12px;min-width:0}.stat{font-size:30px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.3;color:var(--text)}.stat small{font-size:12px;color:var(--muted);font-weight:400;margin-left:3px}.socket-info,.sensor-copy{display:flex;flex-direction:column;gap:5px}.sockets{display:flex;gap:5px}.sockets i{width:17px;height:22px;border-radius:5px;border:1px solid var(--border);background:var(--surface-muted)}.sockets i.unknown{border-style:dashed;opacity:.55}.sockets i.on{background:var(--accent-soft);border-color:var(--accent)}.ring-mini{width:52px;height:52px;flex:none;border-radius:50%;background:conic-gradient(var(--accent) 0 62%,var(--surface-muted) 62%);display:grid;place-items:center}.ring-mini>span{width:40px;height:40px;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--text)}
.presence-pill{flex-shrink:0;white-space:nowrap;display:inline-flex;align-items:center;justify-self:start;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;line-height:18px;font-weight:500;background:var(--surface-muted);color:var(--muted)}.presence-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}.presence-pill.online{background:var(--success-soft);color:var(--success)}.presence-pill.waiting{background:var(--warn-soft);color:var(--warn)}

.tc1-body>.stat{flex:0 0 128px;text-align:right;white-space:nowrap}.tc1-body>.socket-info{flex:0 1 127px;min-width:0}
.sensor-copy{min-width:0}.m1-body{display:grid;grid-template-columns:52px minmax(0,1fr);gap:4px 12px}.sensor-details{grid-column:1/-1;display:flex;flex-wrap:wrap;column-gap:3px}.sensor-details>span{white-space:nowrap}.device-summary:has(.sensor-details){grid-template-rows:24px minmax(54px,auto)}
</style>
