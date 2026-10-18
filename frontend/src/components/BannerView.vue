<script setup>
import {computed} from 'vue';
import {safeBannerURL} from '../banner';
import AppIcon from './AppIcon.vue';
const props=defineProps({banner:{type:Object,required:true},dismissible:Boolean});
defineEmits(['dismiss']);
const href=computed(()=>safeBannerURL(props.banner.url));
</script>
<template>
 <aside v-if="banner.enabled&&banner.text" class="platform-banner" aria-label="平台公告">
  <span class="banner-symbol"><AppIcon name="guest" :size="20"/></span>
  <p>{{banner.text}}</p>
  <a v-if="href&&banner.label" class="banner-link" :href="href" target="_blank" rel="noopener noreferrer">{{banner.label}}<AppIcon name="arrow" :size="17"/></a>
  <div v-if="dismissible" class="banner-actions" aria-label="公告提醒设置">
   <button type="button" title="24 小时后再提醒" @click="$emit('dismiss','snooze')">稍后提醒</button>
   <button type="button" title="在当前标签页中忽略此公告" @click="$emit('dismiss','ignore')">忽略</button>
   <button type="button" title="不再显示此条公告" @click="$emit('dismiss','dismiss')">不再显示</button>
  </div>
 </aside>
</template>
<style scoped>
.platform-banner{display:flex;align-items:center;gap:14px;padding:16px 20px;margin:0 0 20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--accent-soft);color:var(--text);line-height:1.7}.banner-symbol{display:grid;place-items:center;flex-shrink:0;color:var(--accent)}p{flex:1;min-width:0;margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:14px}.banner-link{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:6px 12px;color:var(--accent);font-size:14px;font-weight:600;border:1px solid var(--border);border-radius:var(--radius-s);text-decoration:none;overflow-wrap:anywhere;max-width:100%}.banner-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.banner-link svg{flex-shrink:0}@media(max-width:600px){.platform-banner{padding:14px;gap:10px;flex-wrap:wrap;align-items:flex-start}.banner-symbol{margin-top:3px}.platform-banner p{flex-basis:calc(100% - 34px)}.banner-link{margin-left:30px}}

.platform-banner{flex-wrap:wrap}.banner-actions{display:flex;flex-wrap:wrap;gap:4px;flex-basis:100%;padding-left:30px}.banner-actions button{min-height:44px;padding:8px 10px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:13px;cursor:pointer;border-radius:var(--radius-s)}.banner-actions button:hover{background:var(--surface);color:var(--text)}.banner-actions button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
