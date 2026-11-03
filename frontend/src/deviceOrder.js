import {deviceKey} from './deviceProtocol.js';

export const deviceSortModes=['default','custom','name','type'];
export function readDeviceOrder(key,storage=localStorage){
 try{
  const value=JSON.parse(storage.getItem(key));
  return {mode:deviceSortModes.includes(value?.mode)?value.mode:'default',order:Array.isArray(value?.order)?[...new Set(value.order.filter(k=>typeof k==='string'))]:[]};
 }catch{return {mode:'default',order:[]};}
}
export function sortDevices(devices,preference,name,locale){
 const result=[...devices],compare=new Intl.Collator(locale,{numeric:true,sensitivity:'base'}).compare;
 if(preference.mode==='custom'){
  const ranks=new Map(preference.order.map((key,index)=>[key,index]));
  result.sort((a,b)=>(ranks.get(deviceKey(a))??Infinity)-(ranks.get(deviceKey(b))??Infinity));
 }else if(preference.mode==='name')result.sort((a,b)=>compare(name(a),name(b)));
 else if(preference.mode==='type')result.sort((a,b)=>compare(a.model,b.model)||compare(name(a),name(b)));
 return result;
}
export function moveDevice(devices,key,direction){
 const order=devices.map(deviceKey),index=order.indexOf(key),next=index+direction;
 if(index<0||next<0||next>=order.length)return order;
 [order[index],order[next]]=[order[next],order[index]];
 return order;
}
