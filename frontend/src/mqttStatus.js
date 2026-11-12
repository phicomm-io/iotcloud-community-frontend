import {baseTopic,deviceKey} from './deviceProtocol.js';
import {decodeWire} from './wireCodec.js';

// Some G3 firmware can publish its complete snapshot but returns an empty
// status.get receipt. Keep the live business publication separately from the
// merged list state: metadata, retained replays and empty replies are not samples.
export function createMqttStatusCache(now=Date.now){
 const snapshots=new Map(),offline=new Set(),key=d=>JSON.stringify([deviceKey(d),baseTopic(d)]);
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 function age(value,elapsed){
  if(Array.isArray(value))return value.map(item=>age(item,elapsed));
  if(!object(value))return value;
  return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,
   (name==='age_ms'||name.endsWith('_age_ms'))&&typeof item==='number'&&Number.isFinite(item)&&item>=0?item+elapsed:age(item,elapsed)]));
 }
 function observe(d,topic,message,packet={}){
  if(d.version!=='v2'||d.model!=='daikin')return;
  if(topic===baseTopic(d)+'/availability'){
   if(String(message)==='online')offline.delete(key(d));else{offline.add(key(d));snapshots.delete(key(d));}
   return;
  }
  if(topic!==baseTopic(d)+'/state'||packet.retain||offline.has(key(d)))return;
  let data;try{data=decodeWire(message);}catch{return;}
  if(object(data)&&Object.hasOwn(data,'code'))data=data.code==='ok'?data.data:null;
  if(!object(data)||data.hardware_model!=='BRY88BBA15G'||data.device_id!==d.mac||data.model!==d.model||
     !d.firmware_version||data.version!==d.firmware_version||data.firmware_variant!==(d.variant||d.firmware_variant)||!object(data.sensors))return;
  snapshots.set(key(d),{data,at:now(),version:d.firmware_version,variant:d.variant||d.firmware_variant});
 }
 function reply(d,request,result){
  if(request.action!=='status.get'||result.code!=='ok'||!object(result.data)||Object.keys(result.data).length)return result;
  const snapshot=snapshots.get(key(d)),elapsed=snapshot?now()-snapshot.at:NaN;
  if(!snapshot||elapsed<0||elapsed>=20000||snapshot.version!==d.firmware_version||snapshot.variant!==(d.variant||d.firmware_variant))return result;
  return {...result,data:age(snapshot.data,elapsed)};
 }
 return {observe,reply,clear:()=>{snapshots.clear();offline.clear();},invalidate:d=>snapshots.delete(key(d))};
}
