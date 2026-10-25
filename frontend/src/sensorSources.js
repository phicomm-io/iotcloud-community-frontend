import {deviceKey} from './deviceProtocol.js';
export function co2SourceCandidates(devices,states,target,username,now=Date.now()){
 const owner=d=>d?.mqtt_username||d?.username||username||'';
 return devices.flatMap(d=>{
  if(d.version!=='v2'||d.mac===target?.mac||owner(d)!==owner(target))return [];
  const s=states[deviceKey(d)]||{},elapsed=now-s.sensorAt;
  if(s.available===false||!Number.isFinite(elapsed)||elapsed<0)return [];
  const field=s.sensors?.co2,sensor=s.scd40;
  const ppm=field?.valid===true&&field.unit==='ppm'?field.value:sensor?.ready===true&&sensor.valid===true?sensor.co2_ppm:null;
  const age=field?field.age_ms:sensor?.age_ms;
  if(!Number.isFinite(ppm)||ppm<=0||ppm>65535||!Number.isFinite(age)||age<0||age+elapsed>=20000)return [];
  return [{device_id:d.mac,name:s.name||d.name||d.model.toUpperCase(),ppm:Math.round(ppm)}];
 });
}
