import {decodeWire,detectWire} from './wireCodec.js';
import {userKey} from './deviceProtocol.js';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uint32=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const fieldID=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(value);
const text=(value,min,max)=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value)&&new TextEncoder().encode(value).length>=min&&new TextEncoder().encode(value).length<=max;
export const sensorMetadataTopic=username=>`phicomm/v2/${username?userKey(username):'local'}/sensor/+/metadata`;
// Descriptors are cached only for this owner/device/boot/revision. A state is a
// complete replacement, never a merge that could revive a missing reading.
export function applyDescriptorFeed(feeds,topic,message,{username='',retained=false,now=Date.now(),deviceIds=[]}={}){
 const prefix=`phicomm/v2/${username?userKey(username):'local'}/sensor/`;
 if(!topic.startsWith(prefix))return false;
 const match=/^([0-9a-f]{12})\/(metadata|state)$/.exec(topic.slice(prefix.length));
 if(!match)return false;
 let data;const fractional=new Set();try{data=decodeWire(message,undefined,{onNumber:(_,integer,path)=>{if(!integer)fractional.add(path.join('.'));}});}catch{return true;}
 if(data.schema!==3&&match[2]==='state')return false;
 if(detectWire(message)!=='msgpack')return true;
 const id=match[1];if(!deviceIds.includes(id)||!record(data)||data.schema!==3||data.device_id!==id||!uint32(data.boot)||!uint32(data.descriptor_revision)||['schema','boot','descriptor_revision'].some(key=>fractional.has(key)))return true;
 const key=username+':'+id,previous=feeds[key],retired=previous?.retired||[];
 if(previous&&previous.username!==username)delete feeds[key];
 const old=feeds[key];if(old&&old.boot!==data.boot&&retired.includes(data.boot))return true;
 const history=old&&old.boot!==data.boot?[...retired,old.boot].slice(-4):retired;
 if(match[2]==='metadata'){
  if(!record(data.fields)||Object.keys(data.fields).length>16)return true;
  if(old?.boot===data.boot&&old.metadata&&(data.descriptor_revision-old.metadata.revision|0)<0)return true;
  const fields={};for(const [id,field] of Object.entries(data.fields)){
   if(!fieldID(id)||!record(field)||!text(field.name,1,64)||!text(field.type,1,16)||!text(field.unit,0,24))return true;
   fields[id]={name:field.name,type:field.type,unit:field.unit};
  }
  const same=old?.boot===data.boot&&old.metadata?.revision===data.descriptor_revision;
  if(same&&(Object.keys(fields).length!==Object.keys(old.metadata.fields).length||Object.entries(fields).some(([id,field])=>!Object.hasOwn(old.metadata.fields,id)||['name','type','unit'].some(key=>field[key]!==old.metadata.fields[id][key])))){feeds[key]={...old,sensors:{},metadata:null};return true;}
  feeds[key]={username,boot:data.boot,sequence:old?.boot===data.boot?old.sequence:0,receivedAt:same?old.receivedAt:now,sensors:same?old.sensors:{},retired:history,metadata:{revision:data.descriptor_revision,fields}};
  return true;
 }
 if(retained||!uint32(data.sequence)||fractional.has('sequence')||!record(data.sensors)||Object.keys(data.sensors).length>16)return true;
 if(old?.boot===data.boot&&old.sequence&&(data.sequence-old.sequence|0)<=0)return true;
 const metadata=old?.boot===data.boot?old.metadata:null,sensors={};
 if(metadata?.revision===data.descriptor_revision)for(const [field_id,sample] of Object.entries(data.sensors)){
  const field=metadata.fields[field_id];
  if(!fieldID(field_id)||!field||field.type!=='number'||!record(sample)||sample.valid!==true||!Number.isFinite(sample.value)||!Number.isFinite(Math.fround(sample.value))||!Number.isInteger(sample.age_ms)||sample.age_ms<0||sample.age_ms>=20000||fractional.has('sensors.'+field_id+'.age_ms'))continue;
  sensors[field_id]={...field,value:sample.value,age_ms:sample.age_ms};
 }
 feeds[key]={username,boot:data.boot,sequence:data.sequence,receivedAt:now,sensors,retired:history,...(metadata?{metadata}:{})};return true;
}
