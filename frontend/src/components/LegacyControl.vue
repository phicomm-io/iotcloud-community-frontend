<script setup>
import {t} from '../i18n.js';

const props=defineProps({device:Object,connected:Boolean});const emit=defineEmits(['send-cmd']);
function toggle(index){const p=props.device[`plug_${index}`];if(p)emit('send-cmd',{mac:props.device.mac,[`plug_${index}`]:{on:p.on?0:1}});}
</script>
<template><section class="surface platform-core"><h3>{{t('p.17cb97521322')}}</h3><div class="outlet-grid"><button v-for="n in 6" :key="n" :disabled="!connected||device[`plug_${n-1}`]?.on===undefined" @click="toggle(n-1)">{{device[`plug_${n-1}`]?.setting?.name||t('p.b8e4960b36a2',{v0:(n)})}} · {{device[`plug_${n-1}`]?.on===undefined?t('p.93e474c68ed5'):device[`plug_${n-1}`].on?t('p.39eae64cfc41'):t('p.5d0ae622f61f')}}</button></div><dl class="sensor-grid"><div><dt>{{t('p.3993e09bcbbe')}}</dt><dd>{{device.power_watts??device.power??'—'}} W</dd></div><div><dt>{{t('p.a43c04a4937c')}}</dt><dd>{{device.energy_kwh??device.powerConsumption??'—'}} kWh</dd></div></dl></section></template>
