<script setup>
import {t} from '../i18n.js';
defineProps({name:String,index:Number,count:Number});
const emit=defineEmits(['move']);
</script>
<template><span class="device-order-buttons"><button type="button" :disabled="index===0" :aria-label="t('deviceOrder.moveUp',{name})" @click="emit('move',-1)">↑ <span>{{t('deviceOrder.up')}}</span></button><button type="button" :disabled="index===count-1" :aria-label="t('deviceOrder.moveDown',{name})" @click="emit('move',1)">↓ <span>{{t('deviceOrder.down')}}</span></button></span></template>
<style scoped>
.device-order-buttons{display:flex;gap:6px;margin-top:6px}.device-order-buttons button{flex:1;min-height:44px;padding:6px 10px;font-size:12px}.device-order-buttons button:disabled{opacity:.4;cursor:default}
</style>
