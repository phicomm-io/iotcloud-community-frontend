<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue';
import {api} from '../account';
import {deviceKey} from '../deviceProtocol';
const props=defineProps({devices:{type:Array,default:()=>[]},deviceName:Function});
const enabled=ref(false),key=ref(''),keySet=ref(false),mappings=ref([]),status=ref('disabled'),busy=ref(true),error=ref(''),notice=ref(''),loaded=ref(false);
const selected=ref(''),channel=ref(0),topic=ref('');
const supported=computed(()=>props.devices.filter(d=>d.version==='v2'&&d.status==='active'&&['tc1','a1'].includes(d.model)));
const device=computed(()=>supported.value.find(d=>deviceKey(d)===selected.value));
const channels=computed(()=>device.value?.model==='tc1'?Array.from({length:6},(_,i)=>({value:i,label:`插孔 ${i+1} · 插座（001）`})):[{value:0,label:'风扇（003）'},{value:1,label:'灯环（002）'}]);
const statusText=computed(()=>({disabled:'未启用',configuration_error:'配置不可用，请检查设备映射并重新保存',connecting:'正在连接巴法云',subscription_error:'主题订阅失败，请检查巴法云主题后重新保存',connected:'巴法云已连接',disconnected:'巴法云连接中断，正在重试',device_offline:'设备尚未就绪，请检查平台连接',device_rejected:'设备未接受指令，请检查设备状态',device_timeout:'设备响应超时，请检查设备连接',busy:'请求繁忙，请稍后重试'}[status.value]||'配置待生效'));
function name(d){return props.deviceName?.(d)||`${d.model.toUpperCase()} · ${d.mac}`;}
function label(m){return `${name(m.device)} · ${m.device.model==='tc1'?`插孔 ${m.channel+1}`:m.channel===0?'风扇':'灯环'}`;}
function apply(data){enabled.value=!!data.enabled;keySet.value=!!data.key_set;mappings.value=data.mappings||[];status.value=data.status;key.value='';loaded.value=true;}
async function load(){busy.value=true;error.value='';try{apply(await api('/integrations/bemfa'));}catch(e){error.value=e.message;}finally{busy.value=false;}}
function add(){
 error.value='';const d=device.value,t=topic.value.trim(),c=Number(channel.value);
 if(!d){error.value='请选择设备';return;}
 const suffix=d.model==='tc1'?'001':c===0?'003':'002';
 if(!/^[A-Za-z0-9_]{1,61}(001|002|003)$/.test(t)||!t.endsWith(suffix)){error.value=`主题需使用字母、数字或下划线，并以 ${suffix} 结尾`;return;}
 if(mappings.value.some(m=>m.topic===t||(deviceKey(m.device)===deviceKey(d)&&m.channel===c))){error.value='主题及设备通道不能重复映射';return;}
 if(mappings.value.length>=64){error.value='最多添加 64 个主题映射';return;}
 mappings.value.push({device:{...d},channel:c,topic:t});topic.value='';notice.value='映射已添加，请保存使其生效';
}
async function save(){busy.value=true;error.value='';notice.value='';try{apply(await api('/integrations/bemfa',{method:'PUT',body:JSON.stringify({enabled:enabled.value,api_key:key.value,mappings:mappings.value})}));notice.value='巴法云配置已保存';}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function clear(){
 if(!window.confirm('清除巴法云密钥和所有主题映射，并停止云端转发？'))return;
 busy.value=true;error.value='';notice.value='';try{await api('/integrations/bemfa',{method:'DELETE'});apply({enabled:false,key_set:false,mappings:[],status:'disabled'});notice.value='巴法云配置已清除';}catch(e){error.value=e.message;}finally{busy.value=false;}
}
let timer,alive=true;onMounted(async()=>{await load();if(!alive)return;timer=setInterval(async()=>{if(!loaded.value||busy.value)return;try{const data=await api('/integrations/bemfa');status.value=data.status;}catch{/* Keep unsaved edits; explicit refresh shows connection errors. */}},10000);});onUnmounted(()=>{alive=false;clearInterval(timer);});
</script>
<template>
<section class="card bemfa-card">
<header><h2>巴法云</h2><p class="help">通过小爱同学控制平台中的设备。设备保持原来的 MQTT 连接，关闭网页后云端转发仍会运行。</p><p role="status">{{statusText}}</p></header>
<p v-if="error" class="message error" role="alert">{{error}}</p><p v-if="notice" class="message" role="status">{{notice}}</p>
<button v-if="!loaded" class="btn" :disabled="busy" @click="load">{{busy?'正在读取…':'重新读取配置'}}</button>
<form v-else @submit.prevent="save">
<fieldset :disabled="busy"><legend class="sr-only">巴法云连接设置</legend>
<label class="enable"><input v-model="enabled" type="checkbox"/>启用巴法云转发</label>
<label>巴法云私钥<input v-model="key" aria-label="巴法云私钥" type="password" autocomplete="new-password" spellcheck="false" :placeholder="keySet?'已设置；留空保留原密钥':'填写巴法云控制台的私钥（API Key）'" maxlength="128"/><small class="help">{{keySet?'密钥已设置，保存时留空可保留。':'使用你自己的巴法云账号私钥。'}}密钥保存在当前平台节点，读取时不显示。请勿填写登录密码。</small></label>
<p class="help">同一私钥请只在一个平台节点启用，并停止其他使用此私钥作为客户端 ID 的 MQTT 连接。</p>
<h3>主题映射</h3><p class="help">先在巴法云创建同名主题：插座以 001 结尾，风扇以 003 结尾，灯以 002 结尾。A1 风扇的四档对应 20%、50%、75%、100%，关闭为 0%。</p>
<ul v-if="mappings.length" class="mappings"><li v-for="(m,i) in mappings" :key="m.topic"><span><b>{{label(m)}}</b><code>{{m.topic}}</code></span><button class="btn" type="button" :aria-label="`移除映射 ${m.topic}`" @click="mappings.splice(i,1);notice='请保存使修改生效'">移除</button></li></ul><p v-else class="help">尚未添加映射。</p>
<div v-if="supported.length" class="add-mapping">
<label>映射设备<select v-model="selected" @change="channel=0"><option value="">选择 TC1 或 A1</option><option v-for="d in supported" :key="deviceKey(d)" :value="deviceKey(d)">{{name(d)}}</option></select></label>
<label>设备通道<select v-model="channel" :disabled="!device"><option v-for="c in channels" :key="c.value" :value="c.value">{{c.label}}</option></select></label>
<label>巴法云主题<input v-model="topic" placeholder="例如 livingroom001" maxlength="64" spellcheck="false"/></label>
<button class="btn" type="button" :disabled="!device||!topic" @click="add">添加映射</button>
</div><p v-else class="help">当前没有可映射的设备。请先将 TMCP TC1 或 A1 连接到本平台账号；M1 和 Legacy TC1 暂不支持。</p>
<div class="actions"><button class="btn primary" type="submit">{{busy?'保存中…':'保存巴法云配置'}}</button><button class="btn danger" type="button" :disabled="!keySet&&!mappings.length" @click="clear">清除配置</button></div>
<p class="help">仅转发在线设备的新指令，离线期间的操作不会在恢复连接后补发。灯环的开关沿用设备当前的灯效与显示规则。<a href="https://cloud.bemfa.com/docs/src/speaker_mi.html" target="_blank" rel="noopener noreferrer">查看小爱同学绑定说明</a></p>
</fieldset></form>
</section>
</template>
<style scoped>
.bemfa-card{padding:24px;min-width:0}.bemfa-card header{display:grid;gap:12px;margin-bottom:20px}.bemfa-card h2{font-size:18px}.bemfa-card h3{font-size:15px;margin:8px 0 0}.bemfa-card fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:18px}.bemfa-card label{display:grid;gap:8px;font-size:13px}.bemfa-card input,.bemfa-card select,.bemfa-card button{min-height:44px;max-width:100%}.bemfa-card .enable{display:flex;align-items:center;gap:10px}.enable input{width:18px;min-height:18px}.help{line-height:1.7}.message{padding:12px;background:var(--accent-soft);border-radius:var(--radius-s);margin-bottom:16px;overflow-wrap:anywhere}.error{color:var(--danger)}.mappings{list-style:none;padding:0;margin:0;display:grid}.mappings li{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--border)}.mappings li>span{min-width:0;flex:1;display:grid;gap:8px}.mappings b,.mappings code{overflow-wrap:anywhere}.mappings code{color:var(--muted)}.add-mapping{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:end}.actions{display:flex;gap:12px;flex-wrap:wrap}.bemfa-card a{color:var(--accent)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.bemfa-card{padding:18px}.add-mapping{grid-template-columns:1fr}.actions>*{flex:1}}
</style>
