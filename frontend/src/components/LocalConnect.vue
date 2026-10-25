<script setup>
import {t} from '../i18n.js';

import {ref} from 'vue';
import {useRouter} from 'vue-router';
import {connectLocal} from '../localConnection';
const emit=defineEmits(['connected']);
const props=defineProps({navigate:Boolean});
const router=useRouter(),address=ref(''),password=ref(''),busy=ref(false),error=ref('');
async function connect(){busy.value=true;error.value='';try{const device=await connectLocal(address.value,password.value);password.value='';emit('connected',device);if(props.navigate)await router.push('/local');}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template>
<section class="local-connect card" :aria-label="t('p.3d3b06d22814')">
<div><span class="eyebrow">{{t('p.17821a5cda93')}}</span><h2>{{t('p.3d3b06d22814')}}</h2><p class="help">{{t('p.8cb925b229b0')}}</p></div>
<form @submit.prevent="connect">
<label>{{t('p.3fd1c5c06889')}}<input v-model="address" required :placeholder="t('p.42b008274992')" inputmode="url" autocomplete="off" :disabled="busy"/></label>
<label>{{t('p.f07ec443fcb9')}}<input v-model="password" type="password" autocomplete="off" :placeholder="t('p.44bb498d31cb')" :disabled="busy"/></label>
<button class="btn primary" :disabled="busy">{{busy?t('p.f26c1e607006'):t('p.8be0e6fe5dcd')}}</button>
<p v-if="error" class="form-message error" role="alert">{{error}}</p>
</form>
<RouterLink v-if="navigate" class="help" to="/local">{{t('p.66556ccc5e16')}}</RouterLink>
</section>
</template>
<style scoped>
.local-connect{display:grid;gap:18px;margin:20px 0;padding:24px;border-color:var(--accent)}.local-connect h2{margin:6px 0 10px;font-size:22px}.local-connect form{display:grid;gap:16px}.local-connect label{display:grid;gap:8px}.local-connect input{min-width:0;width:100%}.local-connect button{justify-self:start}.local-connect p{overflow-wrap:anywhere}
</style>
