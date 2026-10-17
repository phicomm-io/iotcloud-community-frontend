<script setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {installation, requestInstallation} from '../installApp.js';
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

function choose(choice) {
  preference.value = saveInstallPreference(choice);
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
      message.value = '已取消安装，7 天内不再主动提示。也可以随时从设置打开。';
    } else message.value = '请按下方说明，通过浏览器菜单添加到桌面。';
  } catch {
    message.value = '未能打开安装窗口，请按下方说明操作，或稍后重试。';
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
    <div class="install-promotion-copy"><h2 id="install-promotion-title">把 IotCloud 添加到桌面</h2><p>下次点桌面图标，就能直接打开设备控制。</p></div>
    <div class="install-promotion-actions"><button class="btn primary" type="button" @click="promote">添加到桌面</button><button class="btn ghost" type="button" @click="choose('later')">稍后提示</button><button class="btn ghost" type="button" @click="choose('never')">不再提示</button></div>
  </section>
  <dialog ref="dialog" class="install-dialog" aria-labelledby="install-dialog-title" @close="closed" @click="backdrop">
    <header><img :src="iconURL" alt="" width="40" height="40" /><div><h2 id="install-dialog-title">添加到桌面</h2><p class="help">点桌面图标，快捷打开 IotCloud。</p></div><button class="btn ghost" type="button" aria-label="关闭安装说明" autofocus @click="close">关闭</button></header>
    <div class="install-guide">
      <p v-if="installation.standalone" role="status">当前已在独立窗口中打开，无需重复添加。</p>
      <p v-else-if="installation.installed" role="status">已接受安装。图标就绪后，可从桌面或应用列表打开 IotCloud。</p>
      <template v-else-if="installation.platform === 'in-app'">
        <h3>先在系统浏览器中打开</h3>
        <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">···</span><div><b>打开右上角菜单</b><p>在微信等应用内，点击右上角的菜单按钮。</p></div></li><li><span class="install-step-icon" aria-hidden="true">↗</span><div><b>选择在浏览器中打开</b><p>iPhone 使用 Safari；Android 使用支持安装的浏览器。</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>再选择添加到桌面</b><p>打开 IotCloud 的设置，即可再次查看安装说明。</p></div></li></ol>
      </template>
      <template v-else>
        <button v-if="nativeAvailable" class="btn primary install-native" type="button" :disabled="pending" @click="install">{{pending ? '正在打开安装窗口…' : '安装应用'}}</button>
        <template v-if="isIOS">
          <h3>在 Safari 中添加</h3>
          <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">1</span><div><b>用 Safari 打开当前页面</b><p>如果正在其他浏览器中，请先用 Safari 打开此地址。</p></div></li><li><span class="install-step-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" role="img" aria-label="分享图标"><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" /></svg></span><div><b>点击分享按钮</b><p>在浏览器工具栏或菜单中找到分享图标。</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>选择“添加到主屏幕”</b><p>如有“打开为网页 App”选项，请保持开启，再点“添加”。</p></div></li></ol>
          <p class="install-note">首次从桌面打开时，可能需要重新登录一次。</p>
        </template>
        <template v-else-if="installation.platform === 'android'">
          <h3>{{nativeAvailable ? '也可以使用浏览器菜单' : '通过浏览器菜单添加'}}</h3>
          <ol class="install-steps"><li><span class="install-step-icon" aria-hidden="true">⋮</span><div><b>打开浏览器菜单</b><p>点击地址栏旁的菜单按钮。</p></div></li><li><span class="install-step-icon" aria-hidden="true">＋</span><div><b>选择安装应用或添加到主屏幕</b><p>按浏览器提示确认。不同浏览器的名称可能不同。</p></div></li></ol>
          <p v-if="!nativeAvailable" class="install-note">如果没有该选项，可用 Chrome 或 Edge 打开当前地址后重试。</p>
        </template>
        <template v-else>
          <h3>{{nativeAvailable ? '也可以使用浏览器菜单' : '通过浏览器菜单添加'}}</h3>
          <p>在浏览器地址栏或菜单中查找“安装应用”。如果没有该选项，可用支持安装的 Chrome 或 Edge 打开当前地址。</p>
        </template>
      </template>
      <p v-if="message" class="install-note" role="status">{{message}}</p>
    </div>
    <footer><p class="help">{{preference.never ? '已关闭主动提示，仍可随时从设置查看。' : '稍后提示将延后 7 天；设置中始终保留入口。'}}</p><div><button class="btn ghost" type="button" @click="choose('never')">不再提示</button><button class="btn" type="button" @click="choose('later')">稍后提示</button><button class="btn primary" type="button" @click="close">完成</button></div></footer>
  </dialog>
</template>

<style scoped>
.install-promotion{display:flex;align-items:center;gap:16px;margin-top:24px;padding:18px 20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}
.install-promotion-copy{flex:1;min-width:0}.install-promotion h2{font-size:15px;margin:0 0 5px}.install-promotion p{font-size:13px;color:var(--muted);line-height:1.6;margin:0}.install-promotion-actions{display:flex;flex-wrap:wrap;gap:8px}.install-promotion button,.install-dialog button{min-height:44px}
.install-dialog{width:min(520px,calc(100vw - 32px));max-height:90vh;max-height:90dvh;padding:0;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);overflow:auto;overscroll-behavior:contain;box-shadow:var(--shadow)}.install-dialog::backdrop{background:rgb(0 0 0 / .4)}
.install-dialog header{display:flex;align-items:center;gap:12px;padding:20px;border-bottom:1px solid var(--border)}.install-dialog header>div{flex:1;min-width:0}.install-dialog h2{font-size:18px}.install-dialog h3{font-size:14px;margin:0 0 16px}.install-dialog header p{margin-top:5px;font-size:12px}.install-guide{padding:20px;font-size:14px;line-height:1.7}.install-native{width:100%;margin-bottom:24px}.install-steps{list-style:none;display:grid;gap:20px;margin:0;padding:0}.install-steps li{display:flex;gap:14px;align-items:flex-start}.install-step-icon{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;border-radius:var(--radius-s);background:var(--accent-soft);color:var(--accent);font-size:22px}.install-steps b{font-size:14px}.install-steps p{margin:4px 0 0;font-size:13px;color:var(--muted)}.install-note{margin:20px 0 0;padding:12px;border-radius:var(--radius-s);background:var(--surface-muted);font-size:12px;color:var(--muted)}.install-dialog footer{border-top:1px solid var(--border);padding:16px 20px;padding-bottom:max(16px,env(safe-area-inset-bottom))}.install-dialog footer p{font-size:12px;line-height:1.6;margin:0 0 12px}.install-dialog footer>div{display:flex;justify-content:flex-end;gap:8px}
@media(max-width:800px){.install-promotion{align-items:flex-start;flex-wrap:wrap;gap:12px;padding:16px}.install-promotion-copy{flex-basis:calc(100% - 52px)}.install-promotion-actions{width:100%}.install-promotion-actions>.primary{flex:1}.install-dialog header,.install-guide{padding:16px}.install-dialog footer{padding:16px}.install-dialog header button{padding:8px}.install-dialog footer>div{flex-wrap:wrap}}
</style>
