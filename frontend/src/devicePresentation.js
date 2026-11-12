
import {t} from './i18n.js';
import {hubMeterFresh} from './hubMeter.js';
// Both Legacy and TMCP devices may report relay states as booleans or 0/1.
export function socketStates(s={},count=6){
 const source=Array.isArray(s.socket_states)?s.socket_states:Array.from({length:count},(_,i)=>s[`plug_${i}`]?.on);
 return Array.from({length:count},(_,i)=>{
  const v=source[i];
  return v===true||v===1||v==='1'?true:v===false||v===0||v==='0'?false:undefined;
 });
}
export const deviceType=(d,s={})=>({tc1:'TC1',m1:'M1',a1:'A1',daikin:(d.hardware_model||s.hardware_model)==='BRY88BBA15G'?'BRY88BBA15G':(d.hardware_model||s.hardware_model)==='BRY88AX151K'?'BRY88AX151K':'DAIKIN','s30-v1b':'S30M-V1B'})[d.model]||t('p.e1506406a5bd');
export function pressureReading(s={},now=Date.now()){
 const b=s.barometer,elapsed=now-s.sensorAt;
 return b?.ready===true&&b.valid===true&&['BMP388','BMP390'].includes(b.model)&&
  typeof b.pressure_hpa==='number'&&Number.isFinite(b.pressure_hpa)&&b.pressure_hpa>=300&&b.pressure_hpa<=1250&&
  typeof b.age_ms==='number'&&Number.isFinite(b.age_ms)&&b.age_ms>=0&&
  Number.isFinite(elapsed)&&elapsed>=0&&b.age_ms+elapsed<10000?b.pressure_hpa:null;
}
export function meterReading(s={},field,now=Date.now()){
 const sample=s.hubPower;
 if(Object.hasOwn(s,'hubPower')&&!hubMeterFresh(sample,now))return null;
 const bit={voltage:1,current:2,active_power:4}[field],m=Object.hasOwn(s,'hubPower')?sample?.metering:s?.metering,v=m?.[field];
 return bit&&typeof v==='number'&&Number.isFinite(v)&&v>=0&&
  (m.valid_fields===undefined?m.valid!==false:!!(m.valid_fields&bit))?v:null;
}
