import {userKey,deviceKey} from './deviceProtocol.js';

export const displayMetricUnits={temperature:'°C',humidity:'%',pm25:'µg/m³',formaldehyde:'mg/m³',co2:'ppm',pressure:'Pa',pm10:'µg/m³',tvoc:'ppb',power:'W',energy:'kWh',fan_speed_percent:'%'};
export const typedSensorTopic=username=>`phicomm/v2/${username?userKey(username):'local'}/sensor/+/state`;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uint32=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const airMetrics=['temperature','humidity','pm25','formaldehyde','co2','pressure','pm10','tvoc'];
const producerMetrics={m1:airMetrics.slice(0,6),daikin:airMetrics,tc1:['power','energy'],a1:['fan_speed_percent']};
const validPhysical=(metric,value)=>Number.isFinite(value)&&value<=999999&&
 (metric==='temperature'?value>=-40&&value<=125:value>=0&&
  (metric==='co2'?value>=1&&value<=65535:metric==='humidity'||metric==='fan_speed_percent'?value<=100:true));
function integerFields(text,data){
 const counts={schema:0,boot:0,sequence:0},ages={},stack=[];
 // JSON.parse checked syntax. Inspect the envelope and actual sample ages;
 // additive metadata at other paths cannot change these integer checks.
 for(let i=0;i<text.length;i++){
  const character=text[i];
  if(character==='"'){
   const start=i;for(i++;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')break;}
   const parent=stack.at(-1);if(!parent)continue;
   let next=i+1;while(next<text.length&&/\s/.test(text[next]))next++;
   if(text[next]!==':')continue;
   const key=parent.key=JSON.parse(text.slice(start,i+1));
   if(!parent.path.length&&Object.hasOwn(counts,key)){
    const token=/^\s*([1-9][0-9]*)\s*(?=[,}])/.exec(text.slice(next+1));
    if(!token||Number(token[1])!==data[key]||++counts[key]!==1)return null;
   }else if(parent.path.length===2&&parent.path[0]==='sensors'&&Object.hasOwn(displayMetricUnits,parent.path[1])&&key==='age_ms'){
    const metric=parent.path[1],token=/^\s*(-?(?:0|[1-9][0-9]*))\s*(?=[,}])/.exec(text.slice(next+1));
    ages[metric]=!Object.hasOwn(ages,metric)&&!!token&&Number(token[1])===data.sensors[metric]?.age_ms;
   }
  }else if(character==='{'||character==='['){
   const parent=stack.at(-1);stack.push({path:parent?[...parent.path,parent.array?null:parent.key]:[],array:character==='['});
  }else if(character==='}'||character===']')stack.pop();
 }
 return Object.values(counts).every(count=>count===1)?ages:null;
}

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
 const ages=integerFields(text,data);if(!ages)return true;
 const metrics=data.model===undefined?airMetrics:typeof data.model==='string'&&Object.hasOwn(producerMetrics,data.model)?producerMetrics[data.model]:null;
 if(!metrics||data.model!==undefined&&Object.keys(data.sensors).some(metric=>Object.hasOwn(displayMetricUnits,metric)&&!metrics.includes(metric)))return true;
 const previous=feeds[id],retired=previous?.retired||[];
 if(previous&&(data.boot===previous.boot?(data.sequence-previous.sequence|0)<=0:retired.includes(data.boot)))return true;
 const sensors={};
 for(const [metric,unit] of Object.entries(displayMetricUnits)){
  const sample=data.sensors[metric];
  if(!metrics.includes(metric)||!ages[metric]||!record(sample)||sample.unit!==unit||sample.valid!==true||!validPhysical(metric,sample.value)||
     !Number.isInteger(sample.age_ms)||sample.age_ms<0||sample.age_ms>=20000)continue;
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
