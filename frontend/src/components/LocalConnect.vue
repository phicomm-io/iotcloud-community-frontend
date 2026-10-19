<script setup>
import {ref} from 'vue';
import {useRouter} from 'vue-router';
import {connectLocal} from '../localConnection';
const emit=defineEmits(['connected']);
const props=defineProps({navigate:Boolean});
const router=useRouter(),address=ref(''),password=ref(''),busy=ref(false),error=ref('');
async function connect(){busy.value=true;error.value='';try{const device=await connectLocal(address.value,password.value);password.value='';emit('connected',device);if(props.navigate)await router.push('/local');}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template>
<section class="local-connect card" aria-label="本地直连">
<div><span class="eyebrow">无需账号 · 无需后端</span><h2>本地直连</h2><p class="help">填写设备内网 IP，即可控制设备、配置 Wi-Fi 和 MQTT。请允许浏览器访问本地网络。</p></div>
<form @submit.prevent="connect">
<label>设备 IP<input v-model="address" required placeholder="192.168.1.100 或 192.168.1.100:80" inputmode="url" autocomplete="off" :disabled="busy"/></label>
<label>设备网页管理密码<input v-model="password" type="password" autocomplete="off" placeholder="未设置则留空" :disabled="busy"/></label>
<button class="btn primary" :disabled="busy">{{busy?'正在探测…':'连接本地设备'}}</button>
<p v-if="error" class="form-message error" role="alert">{{error}}</p>
</form>
<RouterLink v-if="navigate" class="help" to="/local">打开本地设备管理，无需登录 →</RouterLink>
</section>
</template>
<style scoped>
.local-connect{display:grid;gap:18px;margin:20px 0;padding:24px;border-color:var(--accent)}.local-connect h2{margin:6px 0 10px;font-size:22px}.local-connect form{display:grid;gap:16px}.local-connect label{display:grid;gap:8px}.local-connect input{min-width:0;width:100%}.local-connect button{justify-self:start}.local-connect p{overflow-wrap:anywhere}
</style>
