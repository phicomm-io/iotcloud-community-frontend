<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import '../../../common/web/provision.js';
const props=defineProps({connection:Object,broker:Object});
const P=globalThis.IotProvision;
const suggestedHost=computed(()=>{if(props.broker?.host)return props.broker.host;try{return new URL(props.connection.host).hostname;}catch{return '';}});
const expanded=ref(false),address=ref(''),host=ref(''),port=ref(''),user=ref(''),password=ref(''),trusted=ref(false),state=ref(''),error=ref(''),pending=ref(false);
let stop=null;
function cancel(){stop?.();stop=null;password.value='';pending.value=false;}
function edit(){cancel();expanded.value=!expanded.value;state.value='';error.value='';trusted.value=false;if(expanded.value){let fallback='';try{fallback=new URL(props.connection.host).hostname;}catch{}host.value=props.broker?.host||fallback;port.value=props.broker?.port||'';user.value=props.connection.username||'';password.value=props.connection.password||'';}}
watch(()=>[props.connection.host,props.connection.username,props.connection.password],cancel);
function open(){
 cancelPending();error.value='';state.value='';
 let target,values;
 try{P.platformOrigin(location.origin);target=P.deviceURL(address.value);values=P.config({v:1,host:host.value.trim(),port:Number(port.value),user:user.value,password:password.value,protocol:'tmcp',expires:Date.now()+P.TTL});}
 catch{error.value='请填写有效的局域网设备 IP、Broker 主机名、端口和凭据。平台需使用 HTTPS。';return;}
 if(!trusted.value){error.value='请先确认设备地址和局域网可信。';return;}
 const id=P.nonce(),expires=values.expires;
 target.hash=new URLSearchParams({'iotcloud-import':id,origin:location.origin,expires:String(expires)}).toString();
 // The new tab first stays on this origin; navigation never contains credentials.
 const popup=window.open('about:blank','_blank');
 if(!popup){error.value='浏览器阻止了新窗口，请允许后重试。';return;}
 pending.value=true;state.value=`已打开 ${target.origin}。请在设备窗口确认来源并点击“接收并预填”。两分钟内有效。`;
 let sent=false;
 const cleanup=()=>{window.removeEventListener('message',receive);window.removeEventListener('pagehide',abort);clearTimeout(timer);clearInterval(closed);values=null;password.value='';pending.value=false;};
 const abort=()=>{cleanup();state.value='传递已取消，请重新发起。';};
 const receive=e=>{
  if(P.packet(e,{source:popup,origin:target.origin,id,expires},'iotcloud.provision.ready')&&!sent){
   sent=true;popup.postMessage({type:'iotcloud.provision.config',id,config:values},target.origin);values=null;
   state.value='已发送到指定设备窗口，等待设备前端确认接收。';
  }else if(sent&&P.packet(e,{source:popup,origin:target.origin,id,expires},'iotcloud.provision.received')){
   cleanup();stop=null;state.value='设备前端已预填。请在设备窗口检查并保存；此处不代表设备已保存或联网。';
  }
 };
 const timer=setTimeout(()=>{abort();stop=null;},Math.max(0,expires-Date.now()));
 const closed=setInterval(()=>{if(popup.closed){abort();stop=null;}},1000);
 stop=cleanup;window.addEventListener('message',receive);window.addEventListener('pagehide',abort);
 popup.location.replace(target.href);
}
function cancelPending(){stop?.();stop=null;pending.value=false;}
onBeforeUnmount(cancel);
</script>
<template>
<section class="card provision-device" aria-label="配置本地 IoT 设备">
<h2>配置本地 IoT 设备</h2>
<p class="help">在设备本地网页的 MQTT 设置中填写 Broker 主机名和设备接入端口，不要填写本站域名或 WebSocket 地址。</p>
<p v-if="suggestedHost" class="help">设备 MQTT Host：<strong style="overflow-wrap:anywhere">{{suggestedHost}}</strong><span v-if="broker?.port"> · TCP 端口：{{broker.port}}</span></p>
<button type="button" class="btn" :aria-expanded="expanded" @click="edit">{{expanded?'收起':'填写到本地设备'}}</button>
<form v-if="expanded" class="stack" @submit.prevent="open">
<label>设备 IP 或本地网址<input v-model="address" required placeholder="192.168.1.100 或 http://192.168.1.100/" :disabled="pending" autocomplete="off"/></label>
<div class="fields"><label>设备 MQTT Host<input v-model="host" required maxlength="127" :disabled="pending" placeholder="mqtt.example.com"/></label><label>设备 MQTT 端口<input v-model="port" type="number" min="1" max="65535" required :disabled="pending" placeholder="例如 1883（请确认）"/></label></div>
<div class="fields"><label>设备 MQTT 用户名<input v-model="user" maxlength="63" :disabled="pending" autocomplete="off"/></label><label>设备 MQTT 密码<input v-model="password" type="password" maxlength="256" :disabled="pending" autocomplete="off"/></label></div>
<p class="help">仅配置 TMCP。设备需要支持本功能的新版 WebUI，并可能要求设备网页密码。端口是设备使用的 MQTT TCP 端口，不是网页的 WSS 端口。</p>
<label class="trust-device"><input v-model="trusted" type="checkbox" required :disabled="pending"/>我已核对设备 IP，仅在可信局域网内发送。HTTP 设备页面不能防止网络窃听或篡改。</label>
<p class="help">URL 不包含账号密码。接收前会再次确认来源，配置只预填到设备前端，检查并保存后才生效。</p>
<div class="form-actions"><button class="btn primary" :disabled="pending">打开设备并填写</button><button v-if="pending" type="button" class="btn" @click="cancel();state='传递已取消'">取消传递</button></div>
</form>
<p v-if="state" role="status">{{state}}</p><p v-if="error" role="alert">{{error}}</p>
</section>
</template>
<style scoped>
.provision-device{display:grid;gap:14px;padding:24px}.provision-device h2{font-size:17px}.provision-device>.btn{justify-self:start}.provision-device form{display:grid;gap:16px}.provision-device .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.provision-device label{display:grid;gap:8px}.provision-device input{min-width:0}.provision-device .trust-device{display:flex;align-items:flex-start;font-weight:400;line-height:1.6}.trust-device input{width:18px;min-height:18px;flex-shrink:0;margin-top:3px}@media(max-width:600px){.provision-device .fields{grid-template-columns:1fr}}
</style>
