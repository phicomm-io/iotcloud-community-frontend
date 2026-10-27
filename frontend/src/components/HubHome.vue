<script setup>
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useRouter} from 'vue-router';
import QRCode from 'qrcode';
import {api} from '../account';
import {t} from '../i18n';

const state=ref({}),enabled=ref(false),loaded=ref(false),loading=ref(false),busy=ref(false),error=ref(''),pendingRestart=ref(false),sessionExpired=ref(false);
const dialog=ref(),qr=ref(''),qrFailed=ref(false);
const router=useRouter();
let timer,request,disposed=false;
const restarting=computed(()=>pendingRestart.value||state.value.code==='restart_required');
const refreshDisabled=computed(()=>busy.value||loading.value||sessionExpired.value);
const disabled=computed(()=>refreshDisabled.value||restarting.value);
const status=computed(()=>restarting.value?'restarting':error.value?'unavailable':!loaded.value?'loading':!state.value.enabled?'disabled':!state.value.ready?'unavailable':state.value.paired?'paired':'ready');
const detail=computed(()=>{
 if(error.value||!loaded.value||restarting.value||!state.value.enabled)return '';
 const code=state.value.code||state.value.error;
 return ['storage_error','identity_changed','invalid_params'].includes(code)?t('hub.home.error.'+code):!state.value.ready?t('hub.home.notReady'):'';
});
const pairing=computed(()=>!busy.value&&!error.value&&!restarting.value&&state.value.enabled&&state.value.ready&&!state.value.paired&&typeof state.value.setup_code==='string'?state.value:null);
watch(()=>pairing.value?.setup_uri,async uri=>{
 qr.value='';qrFailed.value=false;
 if(typeof uri!=='string'||!uri.startsWith('X-HM://'))return;
 try{
  const image=await QRCode.toDataURL(uri,{width:216,margin:4,errorCorrectionLevel:'M'});
  if(!disposed&&pairing.value?.setup_uri===uri)qr.value=image;
 }catch{if(!disposed&&pairing.value?.setup_uri===uri)qrFailed.value=true;}
});
function schedule(){
 clearTimeout(timer);
 if(!disposed&&!sessionExpired.value)timer=setTimeout(()=>{if(document.hidden)schedule();else load();},5000);
}
async function call(path,options={}){
 const controller=new AbortController();request=controller;
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{return await api(path,{...options,cache:'no-store',signal:controller.signal});}
 finally{clearTimeout(timeout);if(request===controller)request=undefined;}
}
function sessionLost(){
 if(disposed||sessionExpired.value)return;
 sessionExpired.value=true;pendingRestart.value=false;state.value={};loaded.value=false;error.value=t('hub.home.sessionExpired');clearTimeout(timer);
 router.replace({name:'Login',query:{reason:'hub-session-expired'}});
}
async function load(){
 if(disposed||refreshDisabled.value)return;
 clearTimeout(timer);loading.value=true;
 try{
  const data=await call('/hub/homekit');
  if(disposed)return;
  const unchanged=!loaded.value||enabled.value===!!state.value.enabled;
  state.value=data;if(unchanged)enabled.value=!!data.enabled;
  if(data.code!=='restart_required')pendingRestart.value=false;
  loaded.value=true;error.value='';
 }catch(e){if(!disposed){
  state.value={...state.value,setup_code:undefined,setup_uri:undefined};
  if(e.code==='unauthorized')sessionLost();
  else if(e.code==='restart_required'){pendingRestart.value=true;error.value='';}
  else if(!restarting.value)error.value=e.code?e.message:t('hub.home.connectionFailed');
 }}
 finally{loading.value=false;schedule();}
}
async function change(reset=false){
 if(disposed||disabled.value||!loaded.value||(!reset&&enabled.value===!!state.value.enabled))return;
 dialog.value?.close();clearTimeout(timer);busy.value=true;error.value='';
 // An old QR code must not survive a reset or a service restart.
 state.value={...state.value,setup_code:undefined,setup_uri:undefined};
 try{
  await call(reset?'/hub/homekit/pairing':'/hub/homekit',{method:reset?'DELETE':'PUT',body:JSON.stringify(reset?{confirm:true}:{enabled:enabled.value})});
  if(disposed)return;
  pendingRestart.value=true;state.value={...state.value,enabled:enabled.value,ready:false,paired:false};
 }catch(e){if(!disposed)error.value=e.code?e.message:t('hub.home.changeUnconfirmed');}
 finally{busy.value=false;schedule();}
}
onMounted(()=>{window.addEventListener('phicomm-session-expired',sessionLost);load();});
onBeforeUnmount(()=>{disposed=true;window.removeEventListener('phicomm-session-expired',sessionLost);clearTimeout(timer);request?.abort();});
</script>

<template>
<section class="card hub-home" aria-labelledby="hub-home-title">
 <header><div><h2 id="hub-home-title">HomeKit</h2><p class="help">{{t('hub.home.help')}}</p></div><button class="btn" type="button" :disabled="refreshDisabled" @click="load">{{t('hub.home.refresh')}}</button></header>
 <p v-if="error" class="error" role="alert">{{error}}</p>
 <div class="home-status" role="status"><span class="badge" :class="['ready','paired'].includes(status)?'ok':status==='unavailable'?'bad':status==='restarting'?'warn':''">{{t('hub.home.status.'+status)}}</span><span v-if="loaded&&state.enabled&&state.ready&&!error&&!restarting" class="help">{{t('hub.home.devices',{count:state.devices||0})}}</span></div>
 <p v-if="detail" class="home-detail" :class="{error:status==='unavailable'}">{{detail}}</p>
 <div v-if="restarting" class="home-restart" role="status"><p>{{t('hub.home.restartingHelp')}}</p><a class="btn" href="#/login">{{t('hub.home.signIn')}}</a></div>
 <a v-else-if="sessionExpired" class="btn" href="#/login">{{t('hub.home.signIn')}}</a>
 <template v-else-if="loaded">
  <form class="home-enable" @submit.prevent="change()">
   <label class="enable"><input v-model="enabled" type="checkbox" :disabled="disabled"/>{{t('hub.home.enabled')}}</label>
   <p class="help">{{t('hub.home.restartHelp')}}</p>
   <button class="btn primary" :disabled="disabled||enabled===!!state.enabled">{{busy?t('hub.saving'):t('hub.home.apply')}}</button>
  </form>
  <div v-if="pairing" class="home-pairing">
   <div class="pairing-instructions"><h3>{{t('hub.home.pair')}}</h3><p class="help">{{t('hub.home.pairHelp')}}</p><span class="help">{{t('hub.home.pairCode')}}</span><output class="pairing-code" :aria-label="t('hub.home.pairCode')">{{pairing.setup_code}}</output><p v-if="!state.devices" class="help">{{t('hub.home.noDevices')}}</p><p v-if="qrFailed" class="help">{{t('hub.home.qrFailed')}}</p></div>
   <img v-if="qr" class="pairing-qr" :src="qr" width="216" height="216" :alt="t('hub.home.qrAlt')"/>
  </div>
  <div v-else-if="state.enabled&&state.ready&&state.paired&&!error" class="home-paired"><h3>{{t('hub.home.pairedTitle')}}</h3><p class="help">{{t('hub.home.pairedHelp')}}</p></div>
  <footer class="home-reset"><div><h3>{{t('hub.home.reset')}}</h3><p class="help">{{t('hub.home.resetHelp')}}</p></div><button class="btn danger" type="button" :disabled="disabled" aria-haspopup="dialog" @click="dialog.showModal()">{{t('hub.home.reset')}}</button></footer>
 </template>
 <dialog ref="dialog" class="home-reset-dialog" aria-labelledby="hub-home-reset-title" aria-describedby="hub-home-reset-help" @cancel="busy&&$event.preventDefault()">
  <h2 id="hub-home-reset-title">{{t('hub.home.resetTitle')}}</h2><p id="hub-home-reset-help">{{t('hub.home.resetConfirm')}}</p><footer><button class="btn" type="button" :disabled="busy" autofocus @click="dialog.close()">{{t('hub.home.cancel')}}</button><button class="btn danger" type="button" :disabled="disabled" @click="change(true)">{{t('hub.home.resetApply')}}</button></footer>
 </dialog>
</section>
</template>

<style scoped>
.hub-home{padding:24px;display:grid;gap:20px;min-width:0}.hub-home header{display:flex;align-items:flex-start;gap:16px;justify-content:space-between}.hub-home header>div{min-width:0}.hub-home header>button{flex-shrink:0;white-space:nowrap}.hub-home h2{font-size:18px}.hub-home h3{font-size:14px}.hub-home header .help,.home-reset .help,.home-paired .help{margin-top:8px}.hub-home .help,.home-detail,.home-restart p{font-size:13px;line-height:1.7}.home-status{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.home-enable{display:grid;justify-items:start;gap:14px;margin:0}.enable{display:flex;align-items:center;gap:10px;font-size:14px}.enable input{width:18px;height:18px;min-height:0}.home-pairing{display:flex;align-items:center;gap:24px;padding:20px;background:var(--surface-muted);border:1px solid var(--border);border-radius:var(--radius-s);min-width:0}.pairing-instructions{display:grid;gap:12px;min-width:0;flex:1}.pairing-code{font-size:26px;font-weight:650;letter-spacing:2px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--text)}.pairing-qr{display:block;width:216px;max-width:100%;height:auto;flex-shrink:0;background:white;border-radius:var(--radius-s)}.home-reset{border-top:1px solid var(--border);padding-top:20px;display:flex;align-items:center;gap:20px}.home-reset>div{flex:1;min-width:0}.home-reset>button{flex-shrink:0}.home-restart{padding:18px;display:grid;justify-items:start;gap:16px;background:var(--accent-soft);border-radius:var(--radius-s)}.home-restart .btn{text-decoration:none}.home-reset-dialog p{line-height:1.7}.home-reset-dialog footer{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:24px}.error{overflow-wrap:anywhere}.hub-home button{min-height:44px}.home-paired{display:grid;gap:0}@media(max-width:650px){.hub-home{padding:18px}.home-pairing{flex-direction:column;align-items:stretch;padding:16px}.pairing-qr{align-self:center}.home-reset{flex-direction:column;align-items:flex-start}.home-reset-dialog{padding:20px}.home-reset-dialog footer{flex-direction:column}.home-reset-dialog footer button{width:100%}}
</style>
