// Both Legacy and TMCP devices may report relay states as booleans or 0/1.
export function socketStates(s={}){
 const source=Array.isArray(s.socket_states)?s.socket_states:Array.from({length:6},(_,i)=>s[`plug_${i}`]?.on);
 return Array.from({length:6},(_,i)=>{
  const v=source[i];
  return v===true||v===1||v==='1'?true:v===false||v===0||v==='0'?false:undefined;
 });
}
export const deviceType=d=>({tc1:'TC1 智能插排',m1:'M1 空气质量检测器',a1:'A1 空气净化器',daikin:'DAIKIN BRY88AX151K'})[d.model]||'设备';
export function pressureReading(s={},now=Date.now()){
 const b=s.barometer,elapsed=now-s.sensorAt;
 return b?.ready===true&&b.valid===true&&['BMP388','BMP390'].includes(b.model)&&
  typeof b.pressure_hpa==='number'&&Number.isFinite(b.pressure_hpa)&&b.pressure_hpa>=300&&b.pressure_hpa<=1250&&
  typeof b.age_ms==='number'&&Number.isFinite(b.age_ms)&&b.age_ms>=0&&
  Number.isFinite(elapsed)&&elapsed>=0&&b.age_ms+elapsed<10000?b.pressure_hpa:null;
}
const number=(v,digits=0)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toFixed(digits):'—';
export function deviceSummary(d,s={},connected=false,now=Date.now()){
 if(!connected)return '尚未连接';
 if(s.available===false)return '设备离线';
 if(d.model==='tc1'){
  const sockets=socketStates(s);
  const known=sockets.length===6&&sockets.every(x=>x!==undefined&&x!==null);
  const power=s.power_watts??s.power;
  if(!known&&power===undefined)return '等待设备数据';
  return [power!==undefined?number(power,1)+' W':null,known?`${sockets.filter(Boolean).length} 开 · ${sockets.filter(x=>!x).length} 关`:null].filter(Boolean).join(' · ');
 }
 if(d.model==='daikin'){
  const p=s.sensors?.pm25;return p?.valid&&typeof p.value==='number'&&now-s.sensorAt+(p.age_ms||0)<20000?'PM2.5 '+number(p.value)+' µg/m³':'等待有效空气数据';
 }
 if(d.model==='m1'){
  if(!s.sensor_valid||!s.sensorAt||now-s.sensorAt>60000)return '等待有效空气数据';
  if(!Number.isFinite(Number(s.pm25)))return '等待有效空气数据';
  const quality=Number(s.pm25)>75||Number(s.formaldehyde)>0.1?'空气较差':Number(s.pm25)>35||Number(s.formaldehyde)>0.08?'空气一般':'空气良好';
  return `${quality} · PM2.5 ${number(s.pm25)}`;
 }
 if(s.fan_on===undefined)return '等待设备数据';
 const speed=s.applied_speed??s.percentage??s.speed;
 return `${s.fan_mode==='auto'?'自动 ':s.fan_mode==='manual'?'手动 ':''}${s.fan_on?(s.fan_state==='idle'?'待机':(s.fan_mode?'':'运行 ')+number(speed)+'%'):'已停止'} · ${s.led_enabled===undefined?'灯光未知':s.led_enabled?'灯光开启':'灯光关闭'}`;
}
