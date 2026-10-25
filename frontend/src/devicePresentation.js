
import {t} from './i18n.js';
// Both Legacy and TMCP devices may report relay states as booleans or 0/1.
export function socketStates(s={}){
 const source=Array.isArray(s.socket_states)?s.socket_states:Array.from({length:6},(_,i)=>s[`plug_${i}`]?.on);
 return Array.from({length:6},(_,i)=>{
  const v=source[i];
  return v===true||v===1||v==='1'?true:v===false||v===0||v==='0'?false:undefined;
 });
}
export const deviceType=d=>({tc1:t('p.1d002acab84e'),m1:t('p.5f519f80aa2f'),a1:t('p.d1d553a7ed95'),daikin:'DAIKIN BRY88AX151K'})[d.model]||t('p.e1506406a5bd');
export function pressureReading(s={},now=Date.now()){
 const b=s.barometer,elapsed=now-s.sensorAt;
 return b?.ready===true&&b.valid===true&&['BMP388','BMP390'].includes(b.model)&&
  typeof b.pressure_hpa==='number'&&Number.isFinite(b.pressure_hpa)&&b.pressure_hpa>=300&&b.pressure_hpa<=1250&&
  typeof b.age_ms==='number'&&Number.isFinite(b.age_ms)&&b.age_ms>=0&&
  Number.isFinite(elapsed)&&elapsed>=0&&b.age_ms+elapsed<10000?b.pressure_hpa:null;
}
const number=(v,digits=0)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toFixed(digits):'—';
export function deviceSummary(d,s={},connected=false,now=Date.now()){
 if(!connected)return t('p.93ae902da0d3');
 if(s.available===false)return t('p.6e1e714df035');
 if(d.model==='tc1'){
  const sockets=socketStates(s);
  const known=sockets.length===6&&sockets.every(x=>x!==undefined&&x!==null);
  const power=s.power_watts??s.power;
  if(!known&&power===undefined)return t('p.59b4aa3bd881');
  return [power!==undefined?number(power,1)+' W':null,known?t('p.0f583152f409',{v0:(sockets.filter(Boolean).length),v1:(sockets.filter(x=>!x).length)}):null].filter(Boolean).join(' · ');
 }
 if(d.model==='daikin'){
  const p=s.sensors?.pm25;return p?.valid&&typeof p.value==='number'&&now-s.sensorAt+(p.age_ms||0)<20000?'PM2.5 '+number(p.value)+' µg/m³':t('p.47b36dd03059');
 }
 if(d.model==='m1'){
  if(!s.sensor_valid||!s.sensorAt||now-s.sensorAt>60000)return t('p.47b36dd03059');
  if(!Number.isFinite(Number(s.pm25)))return t('p.47b36dd03059');
  const quality=Number(s.pm25)>75||Number(s.formaldehyde)>0.1?t('p.16cedc124c56'):Number(s.pm25)>35||Number(s.formaldehyde)>0.08?t('p.e268425690f3'):t('p.4e519d625485');
  return `${quality} · PM2.5 ${number(s.pm25)}`;
 }
 if(s.fan_on===undefined)return t('p.59b4aa3bd881');
 const speed=s.applied_speed??s.percentage??s.speed;
 return `${s.fan_mode==='auto'?t('p.4bf67adc8978'):s.fan_mode==='manual'?t('p.160f0db1672a'):''}${s.fan_on?(s.fan_state==='idle'?t('p.bed4c87f1838'):(s.fan_mode?'':t('p.a29348be5310'))+number(speed)+'%'):t('p.f006455e3baf')} · ${s.led_enabled===undefined?t('p.2af8e1320bfc'):s.led_enabled?t('p.659da33989d5'):t('p.bbb57d0f248f')}`;
}
