<script setup>
import {reactive,ref} from 'vue';
import {server,saveServer} from '../serverConfig';
const form=reactive({...server}),error=ref('');
function save(){try{saveServer(form);}catch(e){error.value=e.message;}}
</script>
<template><details class="server-settings"><summary>服务器设置</summary><form class="auth-form" @submit.prevent="save"><label>平台后端地址<input v-model="form.apiOrigin" type="url" placeholder="https://api.example.com（留空使用本站）" /></label><label>平台 MQTT WebSocket 地址<input v-model="form.mqttWS" type="url" placeholder="wss://mqtt.example.com/mqtt（留空由平台提供）" /></label><p>平台账号需使用该后端配套的 Broker。自建 Broker 请进入访客模式。</p><p v-if="error" role="alert">{{error}}</p><button class="primary-button">保存并重新加载</button></form></details></template>
<style scoped>.server-settings{margin:20px 0;font-size:14px}.server-settings summary{cursor:pointer}.server-settings p{color:var(--muted);line-height:1.6}</style>
