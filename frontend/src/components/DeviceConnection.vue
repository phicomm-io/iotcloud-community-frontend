<script setup>
import {ref,watch} from 'vue';
const props=defineProps({preference:Object,connection:Object});
const emit=defineEmits(['save']);
const address=ref(''),mode=ref('auto'),password=ref(''),error=ref('');
watch(()=>props.preference,p=>{address.value=p?.address||'';mode.value=p?.mode||'auto';},{immediate:true});
function save(){error.value='';emit('save',{address:address.value,mode:mode.value,password:password.value},message=>{error.value=message||'';if(!message)password.value='';});}
</script>
<template><form class="local-connection" @submit.prevent="save"><h3>设备连接</h3><label>连接方式<select v-model="mode"><option value="auto">自动，优先内网</option><option value="mqtt">始终使用 MQTT</option></select></label><label>内网地址<input v-model="address" placeholder="192.168.1.100:80" autocomplete="off" spellcheck="false"></label><p class="help">留空时尝试设备最近上报的内网地址。偏好仅保存在当前浏览器。</p><label>网页管理密码<input v-model="password" type="password" autocomplete="off" placeholder="已填写的密码在本次会话内保留"></label><p class="help">与 MQTT 密码独立，仅发送给设备；填写空密码可重新尝试无密码连接。</p><p class="help" role="status">{{connection?.checking?'正在探测内网…':connection?.reason||'未设置内网地址'}}</p><p v-if="error" role="alert">{{error}}</p><button class="btn" type="submit">保存并探测</button></form></template>
<style scoped>.local-connection{display:grid;gap:12px;min-width:220px;max-width:360px;padding:12px 0}.local-connection label{display:grid;gap:6px}.local-connection p{overflow-wrap:anywhere}@media(max-width:600px){.local-connection{min-width:0}}</style>
