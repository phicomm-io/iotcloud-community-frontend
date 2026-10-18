<script setup>
import {computed} from 'vue';
import {safeBannerURL} from '../banner';
import AppIcon from './AppIcon.vue';
const props=defineProps({banner:{type:Object,required:true}});
const href=computed(()=>safeBannerURL(props.banner.url));
</script>
<template>
 <aside v-if="banner.enabled&&banner.text" class="platform-banner" aria-label="平台公告">
  <span class="banner-symbol"><AppIcon name="guest" :size="20"/></span>
  <p>{{banner.text}}</p>
  <a v-if="href&&banner.label" class="banner-link" :href="href" target="_blank" rel="noopener noreferrer">{{banner.label}}<AppIcon name="arrow" :size="17"/></a>
 </aside>
</template>
<style scoped>
.platform-banner{display:flex;align-items:center;gap:14px;padding:16px 20px;margin:0 0 20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--accent-soft);color:var(--text);line-height:1.7}.banner-symbol{display:grid;place-items:center;flex-shrink:0;color:var(--accent)}p{flex:1;min-width:0;margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:14px}.banner-link{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:6px 12px;color:var(--accent);font-size:14px;font-weight:600;border:1px solid var(--border);border-radius:var(--radius-s);text-decoration:none;overflow-wrap:anywhere;max-width:100%}.banner-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.banner-link svg{flex-shrink:0}@media(max-width:600px){.platform-banner{padding:14px;gap:10px;flex-wrap:wrap;align-items:flex-start}.banner-symbol{margin-top:3px}.platform-banner p{flex-basis:calc(100% - 34px)}.banner-link{margin-left:30px}}
</style>
