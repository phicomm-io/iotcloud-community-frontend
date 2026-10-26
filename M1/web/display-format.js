/* Physical M1 glass formatting shared by the form, preview and simulator. */
window.M1DisplayFormat=(()=>{
'use strict';
const colors=['red','green','yellow'];
const units={temperature:'°C',humidity:'%',pm25:'µg/m³',formaldehyde:'mg/m³',co2:'ppm',pressure:'Pa',pm10:'µg/m³',tvoc:'ppb',power:'W',energy:'kWh',fan_speed_percent:'%',custom:''};
const customUnits=['','°C','%','µg/m³','mg/m³','ppm','Pa','W','kWh','ppb'];
const modes=['integer','auto_kilo','decimal_2','decimal_1','milli'];
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const physical=value=>Number.isFinite(value)&&Number.isFinite(Math.fround(value));
const samePhysical=(actual,expected)=>physical(actual)&&physical(expected)&&Math.fround(actual)===Math.fround(expected);
const fieldID=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(value);
const descriptorText=(value,minimum,maximum)=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value)&&
 ![...value].some(character=>{const code=character.codePointAt(0);return code>=0xd800&&code<=0xdfff;})&&
 new TextEncoder().encode(value).length>=minimum&&new TextEncoder().encode(value).length<=maximum;
function deviceID(value){
 if(typeof value!=='string')return null;
 const text=value.trim();
 return /^(?:[\da-f]{12}|[\da-f]{2}(?::[\da-f]{2}){5})$/i.test(text)?text.replaceAll(':','').toLowerCase():null;
}
const validLamps=value=>Array.isArray(value)&&value.length===3&&value.every(lamp=>exact(lamp,colors)&&colors.every(color=>typeof lamp[color]==='boolean'));
const uniformLamps=color=>Array.from({length:3},()=>({red:color==='red',green:color==='green',yellow:color==='yellow'}));
const validDisplay=(display,slot)=>exact(display,['mode','show_label','show_unit'])&&modes.includes(display.mode)&&(!slot||display.mode==='integer')&&typeof display.show_label==='boolean'&&typeof display.show_unit==='boolean';
function metricValid(metric,value){
 if(!physical(value))return false;
 value=Math.fround(value);
 if(metric==='temperature')return value>=-40&&value<=125;
 if(value<0)return false;
 if(metric==='co2')return value>0&&value<=65535;
 return !['humidity','fan_speed_percent'].includes(metric)||value<=100;
}
function encode(display,slot,value){
 if(![0,1].includes(slot)||!validDisplay(display,slot)||!physical(value)||value<0)return null;
 value=Math.fround(value);
 let decimal=false,number=value,maximum=999;
 switch(display.mode){
 case 'auto_kilo':if(value>=1000){number=Math.fround(value/10);decimal=true;}break;
 case 'decimal_2':number=Math.fround(value*100);decimal=true;break;
 case 'decimal_1':number=Math.fround(value*10);maximum=99;decimal=true;break;
 case 'milli':number=Math.fround(value/10);decimal=true;break;
 }
 // Clamp before rounding to avoid overflow, and match the MCU's float32 math.
 number=Math.floor(Math.fround(Math.min(number,maximum)+.5));
 if(display.mode==='decimal_1')number*=10;
 const format=Number(decimal)|(display.show_label?2:0)|(display.show_unit?4:0);
 return {number,format,text:decimal?(number/100).toFixed(2):String(number)};
}
return {colors,units,customUnits,modes,record,exact,physical,samePhysical,fieldID,descriptorText,deviceID,validLamps,uniformLamps,validDisplay,metricValid,encode};
})();
