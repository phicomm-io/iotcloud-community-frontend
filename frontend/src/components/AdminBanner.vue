<script setup>
import {onMounted,reactive,ref} from 'vue';
import {api} from '../account';
import {refreshBanner} from '../banner';
import BannerView from './BannerView.vue';
const form=reactive({enabled:false,text:'',url:'',label:''}),loading=ref(true),loaded=ref(false),busy=ref(false),error=ref(''),message=ref('');
async function load(){loading.value=true;try{Object.assign(form,await api('/admin/banner'));loaded.value=true;error.value='';}catch(e){error.value=e.message;}finally{loading.value=false;}}
async function save(){busy.value=true;error.value='';message.value='';try{Object.assign(form,await api('/admin/banner',{method:'PUT',body:JSON.stringify(form)}));await refreshBanner();message.value='平台公告已保存';}catch(e){error.value=e.message;}finally{busy.value=false;}}
onMounted(load);
</script>
<template>
 <section class="card admin-banner" aria-labelledby="admin-banner-title">
  <h2 id="admin-banner-title">平台公告</h2>
  <p class="help">在登录页和控制台顶部展示文字及链接。当前节点独立配置，保存后立即生效，已打开的页面会在一分钟内更新。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <button v-if="loading" type="button" disabled>正在加载公告…</button>
  <button v-else-if="!loaded" type="button" @click="load">重新加载公告</button>
  <form v-if="loaded" @submit.prevent="save">
   <label class="banner-toggle"><input v-model="form.enabled" type="checkbox"/>显示平台公告</label>
   <label>公告正文<textarea v-model="form.text" maxlength="300" rows="3" :required="form.enabled" placeholder="填写公告或交流群信息"/></label>
   <div class="banner-fields"><label>链接地址（可选）<input v-model="form.url" type="url" maxlength="1000" :required="!!form.label" placeholder="https://"/></label><label>按钮文字<input v-model="form.label" maxlength="40" :required="!!form.url" placeholder="例如：加入 QQ 群"/></label></div>
   <div class="banner-preview"><p class="help">预览</p><BannerView :banner="form"/><p v-if="!form.enabled||!form.text" class="help">公告已关闭或尚未填写正文。</p></div>
   <button class="btn primary" :disabled="busy">{{busy?'保存中…':'保存公告'}}</button><p v-if="message" role="status" class="help">{{message}}</p>
  </form>
 </section>
</template>
<style scoped>
.admin-banner{margin-top:24px}.admin-banner>h2{margin-bottom:8px}.admin-banner>.help{line-height:1.7}.admin-banner form{display:grid;gap:18px;margin-top:20px}.admin-banner label{display:grid;gap:8px;min-width:0}.admin-banner .banner-toggle{display:flex;align-items:center;gap:10px}.banner-toggle input{width:18px;min-height:18px;height:18px;margin:0}.admin-banner textarea,.admin-banner input:not([type=checkbox]){width:100%;min-width:0}.admin-banner textarea{resize:vertical;min-height:90px;padding:12px;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-s)}.banner-fields{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px}.banner-preview{min-width:0}.banner-preview>.help{margin-bottom:10px}.admin-banner button{min-height:44px;justify-self:start}@media(max-width:600px){.banner-fields{grid-template-columns:1fr}}
</style>
