<script setup>
import {t} from '../i18n.js';
import {deviceSortModes} from '../deviceOrder.js';
defineProps({mode:String});
const emit=defineEmits(['change']);
</script>
<template><label class="device-sort"><span>{{t('deviceOrder.label')}}</span><select :value="mode" @change="emit('change',$event.target.value)"><option v-for="value in deviceSortModes" :key="value" :value="value">{{t('deviceOrder.'+value)}}</option></select></label></template>
<style scoped>
.device-sort{display:flex;align-items:center;gap:8px;min-width:0;margin:12px 0;font-size:12px;color:var(--muted)}.device-sort select{flex:1;min-width:0;width:auto;min-height:44px;margin:0;padding:8px;font-size:13px}
</style>
