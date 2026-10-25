import {userKey,deviceKey} from './deviceProtocol.js';

export const displayMetricUnits={temperature:'°C',humidity:'%',pm25:'µg/m³',formaldehyde:'mg/m³',co2:'ppm',pressure:'Pa',pm10:'µg/m³',tvoc:'ppb',power:'W',energy:'kWh',fan_speed_percent:'%'};
export const typedSensorTopic=username=>`phicomm/v2/${username?userKey(username):'local'}/sensor/+/state`;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uint32=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const integerToken=(text,key,value)=>{
 const keys=[...text.matchAll(new RegExp('"'+key+'"\\s*:', 'g'))],token=new RegExp('"'+key+'"\\s*:\\s*([1-9][0-9]*)\\s*(?=[,}])').exec(text);
 return keys.length===1&&token&&Number(token[1])===value;
};

// Only a new, live typed publication renews a candidate. Retained snapshots and
// duplicate sequences must not turn an old reading into a fresh display source.
export function applyTypedSensorFeed(feeds,topic,message,{username='',retained=false,now=Date.now(),deviceIds=[]}={}){
 const prefix=typedSensorTopic(username).replace('+/state','');
 if(!topic.startsWith(prefix))return false;
 const match=/^([0-9a-f]{12})\/state$/.exec(topic.slice(prefix.length));
 if(!match)return true;
 const id=match[1];
 if(retained||!deviceIds.includes(id))return true;
 const text=String(message);let data;try{data=JSON.parse(text);}catch{return true;}
 if(!record(data)||data.schema!==1||data.device_id!==id||!uint32(data.boot)||!uint32(data.sequence)||!record(data.sensors))return true;
 if(!['schema','boot','sequence'].every(key=>integerToken(text,key,data[key])))return true;
 const previous=feeds[id],retired=previous?.retired||[];
 if(previous&&(data.boot===previous.boot?(data.sequence-previous.sequence|0)<=0:retired.includes(data.boot)))return true;
 const sensors={};
 for(const [metric,unit] of Object.entries(displayMetricUnits)){
  const sample=data.sensors[metric];
  if(!record(sample)||sample.unit!==unit||sample.valid!==true||!Number.isFinite(sample.value)||
     !Number.isFinite(sample.age_ms)||sample.age_ms<0||sample.age_ms>=20000||
     metric==='fan_speed_percent'&&(sample.value<0||sample.value>100))continue;
  sensors[metric]={value:sample.value,unit,age_ms:sample.age_ms};
 }
 feeds[id]={username,boot:data.boot,sequence:data.sequence,receivedAt:now,sensors,
  retired:previous&&previous.boot!==data.boot?[...retired,previous.boot].slice(-4):retired};
 return true;
}

export function displaySourceCandidates(devices,states,feeds,target,username,now=Date.now()){
 const owner=d=>d?.mqtt_username||d?.username||username||'';
 return devices.flatMap(d=>{
  if(d.version!=='v2'||d.mac===target?.mac||owner(d)!==owner(target))return [];
  const feed=feeds[d.mac],state=states[deviceKey(d)]||{},elapsed=now-feed?.receivedAt;
  if(!feed||feed.username!==owner(target)||state.available===false||!Number.isFinite(elapsed)||elapsed<0)return [];
  return Object.entries(feed.sensors).flatMap(([metric,sample])=>sample.age_ms+elapsed>=20000?[]:[{
   device_id:d.mac,model:d.model,name:state.name||d.name||d.model.toUpperCase(),metric,unit:sample.unit,value:sample.value,age_ms:sample.age_ms+elapsed
  }]);
 });
}
