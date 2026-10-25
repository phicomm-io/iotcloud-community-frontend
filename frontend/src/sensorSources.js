import {deviceKey} from './deviceProtocol.js';
export function co2SourceCandidates(devices,states,target,username,now=Date.now()){
 const owner=d=>d?.mqtt_username||d?.username||username||'';
 return devices.flatMap(d=>{
  if(d.version!=='v2'||d.mac===target?.mac||owner(d)!==owner(target))return [];
  const s=states[deviceKey(d)]||{};
  if(s.available===false)return [];
  const field=s.sensors?.co2,sensor=s.scd40;
  const samples=[
   {ppm:field?.valid===true&&field.unit==='ppm'?field.value:null,age:field?.age_ms,at:Object.hasOwn(s,'co2SensorAt')?s.co2SensorAt:s.sensorAt},
   {ppm:sensor?.ready===true&&sensor.valid===true?sensor.co2_ppm:null,age:sensor?.age_ms,at:Object.hasOwn(s,'co2Scd40At')?s.co2Scd40At:s.sensorAt}
  ].filter(({ppm,age,at})=>Number.isFinite(ppm)&&ppm>0&&ppm<=65535&&Number.isFinite(age)&&age>=0&&Number.isFinite(at)&&now>=at&&age+now-at<20000).sort((a,b)=>b.at-a.at);
  if(!samples.length)return [];
  return [{device_id:d.mac,name:s.name||d.name||d.model.toUpperCase(),ppm:Math.round(samples[0].ppm)}];
 });
}
