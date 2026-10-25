<script setup>
import {t} from '../i18n.js';

import {ref, onMounted} from 'vue';
import {api} from '../account';
import {startGitHub} from '../githubAuth';
const props=defineProps({link:Boolean});
const enabled=ref(false),busy=ref(false),message=ref('');
onMounted(async()=>{if(import.meta.env.VITE_DEMO==='1')return;try{enabled.value=(await api('/auth/github/status')).enabled===true;}catch{/* Optional on older or unconfigured backends. */}});
async function start(){busy.value=true;message.value='';try{await startGitHub(props.link);}catch(e){message.value=e.message;busy.value=false;}}
</script>
<template>
 <div v-if="enabled" class="github-entry">
  <button type="button" class="btn github-button" :disabled="busy" @click="start">
   <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.09c-3.12.68-3.78-1.33-3.78-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.62 1.22 3.26.93.1-.73.39-1.22.71-1.5-2.49-.29-5.11-1.25-5.11-5.54 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.96.71.78 1.15 1.78 1.15 3.01 0 4.3-2.62 5.24-5.12 5.52.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/></svg>
   {{busy?t('p.2711c461abda'):link?t('p.c78677e812af'):t('p.9498a94fd1ea')}}
  </button>
  <p v-if="message" role="alert" class="form-message error">{{message}}</p>
 </div>
</template>
<style scoped>
.github-entry{margin-top:16px}.github-button{width:100%;min-height:44px;justify-content:center;gap:10px}
</style>
