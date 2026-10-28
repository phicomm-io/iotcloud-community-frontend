import {userKey,deviceKey} from './deviceProtocol.js';
import {decodeWire,detectWire} from './wireCodec.js';
import {applyDescriptorFeed} from './sensorDescriptorFeed.js';
export {sensorMetadataTopic} from './sensorDescriptorFeed.js';

export const typedSensorTopic=username=>`phicomm/v2/${username?userKey(username):'local'}/sensor/+/state`;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uint32=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const fieldID=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(value);
const descriptorText=(value,minimum,maximum)=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value)&&
 ![...value].some(character=>{const code=character.codePointAt(0);return code>=0xd800&&code<=0xdfff;})&&
 new TextEncoder().encode(value).length>=minimum&&new TextEncoder().encode(value).length<=maximum;
function integerFields(text,data){
 const counts={schema:0,boot:0,sequence:0},ages=Object.create(null),stack=[];
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
   }else if(parent.path.length===2&&parent.path[0]==='sensors'&&fieldID(parent.path[1])&&key==='age_ms'){
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
 if(applyDescriptorFeed(feeds,topic,message,{username,retained,now,deviceIds}))return true;
 const prefix=typedSensorTopic(username).replace('+/state','');
 if(!topic.startsWith(prefix))return false;
 const match=/^([0-9a-f]{12})\/state$/.exec(topic.slice(prefix.length));
 if(!match)return true;
 const id=match[1];
 if(retained||!deviceIds.includes(id))return true;
 const format=detectWire(message),text=typeof message==='string'?message:format==='json'?new TextDecoder().decode(message):null;let data;const numeric=[];try{data=decodeWire(message,format,{onNumber:(value,integer,path)=>numeric.push({value,integer,path})});}catch{return true;}
 if(!record(data)||data.schema!==2||data.device_id!==id||!uint32(data.boot)||!uint32(data.sequence)||!record(data.sensors)||Object.keys(data.sensors).length>16)return true;
 const ages=text!==null?integerFields(text,data):numeric.some(n=>n.path.length===1&&['schema','boot','sequence'].includes(n.path[0])&&!n.integer)?null:Object.fromEntries(numeric.filter(n=>n.path.length===3&&n.path[0]==='sensors'&&n.path[2]==='age_ms').map(n=>[n.path[1],n.integer]));if(!ages)return true;
 const previous=feeds[id],retired=previous?.retired||[];
 if(previous&&(data.boot===previous.boot?(data.sequence-previous.sequence|0)<=0:retired.includes(data.boot)))return true;
 const sensors={};
 for(const [field_id,sample] of Object.entries(data.sensors)){
  if(!fieldID(field_id)||!ages[field_id]||!record(sample)||sample.type!=='number'||!descriptorText(sample.name,1,64)||!descriptorText(sample.unit,0,24)||
     sample.valid!==true||!Number.isFinite(sample.value)||!Number.isFinite(Math.fround(sample.value))||
     !Number.isInteger(sample.age_ms)||sample.age_ms<0||sample.age_ms>=20000)continue;
  sensors[field_id]={name:sample.name,type:sample.type,value:sample.value,unit:sample.unit,age_ms:sample.age_ms};
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
  return Object.entries(feed.sensors).flatMap(([field_id,sample])=>sample.age_ms+elapsed>=20000?[]:[{
   device_id:d.mac,device_name:state.name||d.name||(typeof d.model==='string'?d.model.toUpperCase():d.mac),field_id,name:sample.name,type:sample.type,unit:sample.unit,value:sample.value,age_ms:sample.age_ms+elapsed
  }]);
 });
}
