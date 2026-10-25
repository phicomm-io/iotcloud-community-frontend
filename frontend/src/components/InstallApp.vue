<script setup>
import {t} from '../i18n.js';

import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {installation, requestInstallation, confirmInstallation} from '../installApp.js';
import {INSTALL_PREFERENCE_KEY, canOfferInstallation, readInstallPreference, saveInstallPreference} from '../installation.js';

const props = defineProps({eligible: Boolean});
const dialog = ref(null), preference = ref(readInstallPreference()), handled = ref(false);
const pending = ref(false), message = ref('');
let trigger, overflow;
const iconURL = import.meta.env.BASE_URL + 'icons/iotcloud.svg';
const nativeAvailable = computed(() => !!installation.prompt && installation.platform !== 'in-app');
const showPromotion = computed(() => props.eligible && !handled.value
  && !installation.standalone && !installation.installed
  && (nativeAvailable.value || installation.platform !== 'desktop')
  && canOfferInstallation(preference.value));
const isIOS = computed(() => installation.platform === 'ios');
const manualConfirmation = computed(() => !installation.standalone && !installation.installed
  && !nativeAvailable.value && ['ios', 'android'].includes(installation.platform));

function choose(choice) {
  preference.value = choice === 'installed' ? confirmInstallation() : saveInstallPreference(choice);
  handled.value = true;
  close();
}
function unlock() {
  if (!overflow) return;
  document.documentElement.style.overflow = overflow.html;
  document.body.style.overflow = overflow.body;
  overflow = null;
}
function closed() {
  unlock();
  const fallback = document.querySelector('.platform-tabs button[aria-current="page"]');
  (trigger?.getClientRects().length ? trigger : fallback)?.focus({preventScroll: true});
}
function close() { dialog.value?.close(); unlock(); }
function open() {
  if (dialog.value.open) return;
  trigger = document.activeElement;
  handled.value = true;
  message.value = '';
  dialog.value.showModal();
  overflow = {html: document.documentElement.style.overflow, body: document.body.style.overflow};
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}
function promote() {
  open();
  if (nativeAvailable.value) install();
}
async function install() {
  pending.value = true;
  message.value = '';
  try {
    const result = await requestInstallation();
    if (result === 'accepted') close();
    else if (result === 'dismissed') {
      preference.value = saveInstallPreference('later');
      message.value = t('p.d31bf8d2a5fa');
    } else message.value = t('p.b540b819b3b4');
  } catch {
    message.value = t('p.d7b5e9596c72');
  } finally { pending.value = false; }
}
function backdrop(event) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
}
function syncPreference(event) {
  if (!event || event.key === INSTALL_PREFERENCE_KEY || event.key === null) preference.value = readInstallPreference();
}
onMounted(() => { window.addEventListener('storage', syncPreference); });
onBeforeUnmount(() => { window.removeEventListener('storage', syncPreference); close(); });
defineExpose({open});
</script>

<template>
  <section v-if="showPromotion" class="install-promotion" aria-labelledby="install-promotion-title">
    <img :src="iconURL" alt="" width="40" height="40" />
    <div class="install-promotion-copy"><h2 id="install-promotion-title">{{t('p.528ad8cd9201')}}</h2><p>{{t('p.28b01aa990d1')}}</p></div>
    <div class="install-promotion-actions"><button class="btn primary" type="button" @click="promote">{{t('p.47ee0a9bee5b')}}</button><button v-if="manualConfirmation" class="btn ghost" type="button" @click="choose('installed')">{{t('p.3476d3a8f328')}}</button><button class="btn ghost" type="button" @click="choose('later')">{{t('p.8a3fd4b5a7be')}}</button><button class="btn ghost" type="button" @click="choose('never')">{{t('p.a54a0add5447')}}</button></div>
  </section>
  <dialog ref="dialog" class="install-dialog" aria-labelledby="install-dialog-title" @close="closed" @click="backdrop">
    <header><img :src="iconURL" alt="" width="40" height="40" /><div><h2 id="install-dialog-title">{{t('p.47ee0a9bee5b')}}</h2><p class="help">{{t('p.c3b52c46c884')}}</p></div><button class="btn ghost" type="button" :aria-label="t('p.8d08fdf5a7ad')" autofocus @click="close">{{t('p.3fd47edce45b')}}</button></header>
    <div class="install-guide">
      <p v-if="installation.standalone" role="status">{{t('p.425f1c11150a')}}</p>
      <p v-else-if="installation.installed" role="status">{{t('p.96316f46fa02')}}</p>
      <template v-else-if="installation.platform === 'in-app'">
        <h3>{{t('p.63de39f03604')}}</h3>
        <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">···</span><div><b>{{t('p.176ad515f48c')}}</b><p>{{t('p.afed60ccb624')}}</p></div></li><li><span class="install-step-icon" aria-hidden="true">↗</span><div><b>{{t('p.129c8d5b408c')}}</b><p>{{t('p.4c93bc98285e')}}</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>{{t('p.041d37877b6f')}}</b><p>{{t('p.88b721414d14')}}</p></div></li></ol>
      </template>
      <template v-else>
        <button v-if="nativeAvailable" class="btn primary install-native" type="button" :disabled="pending" @click="install">{{pending ? t('p.8f327633b6a7') : t('p.a298ba1f627c')}}</button>
        <template v-if="isIOS">
          <h3>{{t('p.485a25ee2735')}}</h3>
          <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">1</span><div><b>{{t('p.16c1930ff7ee')}}</b><p>{{t('p.ff7563aab76f')}}</p></div></li><li><span class="install-step-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" role="img" :aria-label="t('p.4138e74e8fb6')"><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" /></svg></span><div><b>{{t('p.b13c93dcab20')}}</b><p>{{t('p.35d133764fee')}}</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>{{t('p.be48b8dab8d1')}}</b><p>{{t('p.44b2ededb94c')}}</p></div></li></ol>
          <p class="install-note">{{t('p.7cf0936559b8')}}</p>
          <p class="install-note">{{t('p.250d25095692')}}</p>
        </template>
        <template v-else-if="installation.platform === 'android'">
          <h3>{{nativeAvailable ? t('p.cfeafa1a4316') : t('p.e2e677b6e57c')}}</h3>
          <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">⋮</span><div><b>{{t('p.26463eda207c')}}</b><p>{{t('p.62b1811c177e')}}</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>{{t('p.83f475a6ac89')}}</b><p>{{t('p.e6360ce18b06')}}</p></div></li></ol>
          <p v-if="!nativeAvailable" class="install-note">{{t('p.d4fb6e342282')}}</p>
        </template>
        <template v-else>
          <h3>{{nativeAvailable ? t('p.cfeafa1a4316') : t('p.e2e677b6e57c')}}</h3>
          <p>{{t('p.a0e407fb7820')}}</p>
        </template>
      </template>
      <p v-if="message" class="install-note" role="status">{{message}}</p>
    </div>
    <footer><p class="help">{{preference.never || preference.installed ? t('p.1e787cef6d43') : t('p.9076f53bbc08')}}</p><div><button class="btn ghost" type="button" @click="choose('never')">{{t('p.a54a0add5447')}}</button><button class="btn" type="button" @click="choose('later')">{{t('p.8a3fd4b5a7be')}}</button><button v-if="manualConfirmation" class="btn primary" type="button" @click="choose('installed')">{{t('p.c327bf46a222')}}</button><button v-else class="btn primary" type="button" @click="close">{{t('p.c0b3fbff51cc')}}</button></div></footer>
  </dialog>
</template>

<style scoped>
.install-promotion{display:flex;align-items:center;gap:16px;margin-top:24px;padding:18px 20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}
.install-promotion-copy{flex:1;min-width:0}.install-promotion h2{font-size:15px;margin:0 0 5px}.install-promotion p{font-size:13px;color:var(--muted);line-height:1.6;margin:0}.install-promotion-actions{display:flex;flex-wrap:wrap;gap:8px}.install-promotion button,.install-dialog button{min-height:44px}
.install-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;max-height:90dvh;padding:0;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);overflow:auto;overscroll-behavior:contain;box-shadow:var(--shadow)}.install-dialog::backdrop{background:rgb(0 0 0 / .4)}
.install-dialog header{display:flex;align-items:center;gap:12px;padding:20px;border-bottom:1px solid var(--border)}.install-dialog header>div{flex:1;min-width:0}.install-dialog h2{font-size:18px}.install-dialog h3{font-size:14px;margin:0 0 16px}.install-dialog header p{margin-top:5px;font-size:12px}.install-guide{padding:20px;font-size:14px;line-height:1.7}.install-native{width:100%;margin-bottom:24px}.install-steps{list-style:none;display:grid;gap:20px;margin:0;padding:0}.install-steps li{display:flex;gap:14px;align-items:flex-start}.install-step-icon{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;border-radius:var(--radius-s);background:var(--accent-soft);color:var(--accent);font-size:22px}.install-steps b{font-size:14px}.install-steps p{margin:4px 0 0;font-size:13px;color:var(--muted)}.install-note{margin:20px 0 0;padding:12px;border-radius:var(--radius-s);background:var(--surface-muted);font-size:12px;color:var(--muted)}.install-dialog footer{border-top:1px solid var(--border);padding:16px 20px;padding-bottom:max(16px,env(safe-area-inset-bottom))}.install-dialog footer p{font-size:12px;line-height:1.6;margin:0 0 12px}.install-dialog footer>div{display:flex;justify-content:flex-end;gap:8px}
@media(max-width:800px){.install-promotion{align-items:flex-start;flex-wrap:wrap;gap:12px;padding:16px}.install-promotion-copy{flex-basis:calc(100% - 52px)}.install-promotion-actions{width:100%}.install-promotion-actions>.primary{flex:1}.install-dialog header,.install-guide{padding:16px}.install-dialog footer{padding:16px}.install-dialog header button{padding:8px}.install-dialog footer>div{flex-wrap:wrap}}
</style>
