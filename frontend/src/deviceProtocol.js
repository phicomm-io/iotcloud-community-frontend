
import {t} from './i18n.js';
export const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,"0")).join("");
export const userKey = username => "u_" + [...new TextEncoder().encode(username)].map(b => b.toString(16).padStart(2,"0")).join("");
export const deviceKey = d => d.namespace === "account" ? `account:${d.username}:${d.mqtt_username || d.username}:${d.mac}` : d.mac;
export const modelName = (model) => model==='daikin'?'DAIKIN BRY88AX151K':String(model).toUpperCase();
export function normalizeMAC(value) {
  const s = String(value || "").trim();
  if (
    !/^(?:[a-f\d]{12}|(?:[a-f\d]{2}:){5}[a-f\d]{2}|(?:[a-f\d]{2}-){5}[a-f\d]{2})$/i.test(
      s,
    )
  )
    throw new Error(t('p.d87efef93be5'));
  return s.replace(/[:-]/g, "").toLowerCase();
}
export function deviceEntry(value) {
  const d = typeof value === "string" ? { mac: value, version: "v1" } : value;
  const mac = normalizeMAC(d.mac);
  const model = d.model || "tc1";
  const version = d.version || "v2";
  if (
    !["tc1", "m1", "a1", "daikin"].includes(model) ||
    !(model === "tc1"
      ? ["v1", "v2"].includes(version)
      : version === "v2")
  )
    throw new Error(t('p.4baaf7d5f598'));
  if (d.namespace && (d.namespace !== "account" || !d.username)) throw new Error(t('p.c384a9d1db4f'));
  return { mac, model, version, ...(['full','lite','hub'].includes(d.firmware_variant)?{firmware_variant:d.firmware_variant}:{}), ...(d.username ? {username:d.username} : {}), ...(d.namespace ? { namespace: d.namespace, username: d.username, ...(d.mqtt_username ? { mqtt_username: d.mqtt_username } : {}) } : {}), ...(d.status ? { status: d.status } : {}) };
}
export function localDevices(storage = localStorage) {
  const list = JSON.parse(
    storage.getItem("phicomm_devices") ||
      storage.getItem("ztc1_devices") ||
      "[]",
  );
  if (!Array.isArray(list)) throw new Error(t('p.048d76aaefef'));
  const unique = new Map();
  for (const raw of list) {
    const d = deviceEntry(raw);
    unique.set(deviceKey(d), d);
  }
  return [...unique.values()];
}
export const baseTopic = d => `phicomm/v2/${d.mqtt_username || d.username ? userKey(d.mqtt_username || d.username) : "local"}/${d.model}/${d.mac}`;
export function topics(d) {
  if(d.version === "v2") return [baseTopic(d)+"/#"];
  return [...new Set([d.mac,d.mac.toUpperCase(),d.mac.match(/../g).join(":"),d.mac.match(/../g).join(":").toUpperCase()])].flatMap(id=>["sensor","state","availability"].map(leaf=>`device/ztc1/${id}/${leaf}`).concat([`homeassistant/+/${id}/+/#`]));
}

const merge = (state, data) => {
  for (const [key, value] of Object.entries(data))
    if (
      ![
        "__proto__",
        "constructor",
        "prototype",
        "mac",
        "model",
        "version",
        "status",
        "username",
        "namespace",
        "mqtt_username",
        "sensorAt",
        "sensorFresh",
        "co2SensorAt",
        "co2Scd40At",
      ].includes(key)
    )
      if (/^plug_[0-5]$/.test(key) && value && typeof value === "object") {
        const previous = state[key] || {};
        state[key] = {...previous, ...value, ...(value.setting ? {setting:{...previous.setting,...value.setting}} : {})};
      } else state[key] = value;
};
// Old firmware reports each meter on a separate HA topic. Only update fields
// actually present so uptime/energy messages cannot erase the power sample.
function legacyMeters(state, data) {
 for (const [source,target] of [['power','power_watts'],['powerConsumption','energy_kwh']]) {
  const value=data[source];
  if(value!==undefined && value!==null && value!=='' && Number.isFinite(Number(value))) state[target]=Number(value);
 }
}
const json = (value) => {
  try {
    const v = JSON.parse(value);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
function mergeStatus(state,data,now){
 // Partial status updates must not renew an older CO2 representation.
 if(state.co2SensorAt===undefined&&state.sensors?.co2)state.co2SensorAt=state.sensorAt??null;
 if(state.co2Scd40At===undefined&&state.scd40)state.co2Scd40At=state.sensorAt??null;
 merge(state,data);
 if(data.sensors?.co2&&typeof data.sensors.co2==='object'&&Object.hasOwn(data.sensors.co2,'value'))state.co2SensorAt=now;
 if(data.scd40&&typeof data.scd40==='object'&&Object.hasOwn(data.scd40,'co2_ppm'))state.co2Scd40At=now;
 const measurements=['temperature','humidity','pm25','formaldehyde','co2','pm10','tvoc','pressure','power_watts','energy_kwh'].some(key=>Number.isFinite(data[key]))||
  ['sensors','scd40','barometer'].some(key=>data[key]&&typeof data[key]==='object'&&!Array.isArray(data[key])&&Object.keys(data[key]).length>0);
 // A successful empty/metadata response is not a new physical sample.
 if(measurements){state.sensorAt=now;state.sensorFresh=data.sensor_valid===true;}
 else if(data.sensor_valid===false)state.sensorFresh=false;
}
// LAN status is a full snapshot. Explicitly clear absent CO2 receipts so a
// previous MQTT representation cannot supply its timestamp after the merge.
export function statusSnapshot(data,now=Date.now()){
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 return {...data,sensorAt:now,sensorFresh:data.sensor_valid===true,
  co2SensorAt:data.sensors?.co2&&typeof data.sensors.co2==='object'&&Object.hasOwn(data.sensors.co2,'value')?now:null,
  co2Scd40At:data.scd40&&typeof data.scd40==='object'&&Object.hasOwn(data.scd40,'co2_ppm')?now:null};
}
export function applyMessage(d, state, topic, message, now = Date.now()) {
 if(d.version === "v2") {
  const base=baseTopic(d); if(!topic.startsWith(base+"/")) return false;
  const leaf=topic.slice(base.length+1), data=json(String(message));
  if(leaf === "availability") {state.available=String(message)==="online"; if(!state.available)state.sensorFresh=false;}
  else if(leaf === "state" && data) mergeStatus(state,data,now);
  else if(leaf === "sensor" && data) {merge(state,data);if(d.model==="tc1"){state.power_watts=Number(data.power);state.energy_kwh=Number(data.powerConsumption);}}
  else if(leaf === "capabilities" && data) state.capabilities=data;
  else if(leaf === "result" && data) {state.result=data; const payload=data.data; if(data.code==="ok" && state.pending?.[data.request_id]==="status.get" && payload && typeof payload==="object" && !Array.isArray(payload)) mergeStatus(state,payload,now);}
  return true;
 }

 const p=topic.split("/");
 if(p[0]==="homeassistant") {
  try{if(normalizeMAC(p[2])!==d.mac)return false;}catch{return false;}
  if(p.length!==5)return false;
  if(p[4]==="config"){
   const data=json(String(message));
   if(data?.dev?.name||data?.device?.name)state.name=data.dev?.name||data.device?.name;
   const socket=p[1]==="switch"&&p[3].match(/^socket_([0-5])$/);
   if(socket&&typeof data?.name==='string'){
    const key=`plug_${socket[1]}`,previous=state[key]||{};
    state[key]={...previous,setting:{...previous.setting,name:data.name}};
   }
   return true;
  }
  if(p[4]!=="state")return false;
  if(p[1]==="sensor"){const data=json(String(message));if(data){merge(state,data);legacyMeters(state,data);}return true;}
  const m=String(message).trim().match(/^set (socket|led|child_lock) ([a-f\d:]+) (?:(\d) )?([01])$/i);
  if(!m)return false;try{if(normalizeMAC(m[2])!==d.mac)return false;}catch{return false;}
  state.legacyText=true;if(m[1]==="socket"){state[`plug_${m[3]}`]={...(state[`plug_${m[3]}`]||{}),on:Number(m[4])};}else state[m[1]==='led'?'led_lock':'child_lock']={on:Number(m[4])};return true;
 }
 if(p.length!==4 || p[0]!=="device" || p[1]!=="ztc1")return false;
 try {if(normalizeMAC(p[2])!==d.mac)return false;}catch{return false;}
 if(p[3]==="availability")state.available=["online","1","true"].includes(String(message));
 else if(["sensor","state"].includes(p[3])) {const data=json(String(message));if(!data)return false;merge(state,data);legacyMeters(state,data);}
 else return false;
 return true;
}

export function command(d, cmd) {
 if(d.version === "v2") {
  if(!cmd.action || !/^[a-z_.]+$/.test(cmd.action)) throw new Error(t('p.6a9c930be875'));
  return {topic:baseTopic(d)+"/command",payload:JSON.stringify({request_id:cmd.request_id || requestId(),action:cmd.action,params:cmd.params || {}})};
 }

 if(d.legacyText){
  const mac=d.mac.toUpperCase();let text;
  const plug=Object.keys(cmd).find(k=>/^plug_[0-5]$/.test(k));
  if(plug && [0,1].includes(cmd[plug]?.on))text=`set socket ${mac} ${plug.slice(-1)} ${cmd[plug].on}`;
  else if(cmd.child_lock && [0,1].includes(cmd.child_lock.on))text=`set child_lock ${mac} ${cmd.child_lock.on}`;
  else if(cmd.led_lock && [0,1].includes(cmd.led_lock.on))text=`set led ${mac} ${cmd.led_lock.on}`;
  else throw new Error(t('p.2a576928014b'));
  return {topic:`device/ztc1/${mac}/set`,payload:text};
 }
 return {topic:`device/ztc1/${d.mac}/set`,payload:JSON.stringify({...cmd,mac:d.mac})};
}
