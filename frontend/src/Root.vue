<script setup>
import { RouterView,useRoute } from 'vue-router'
import NodeSelector from './components/NodeSelector.vue'
import PlatformBanner from './components/PlatformBanner.vue'
const demoMode=import.meta.env.VITE_DEMO==='1';
const route=useRoute();
</script>

<template>
  <PlatformBanner v-if="!demoMode && route.name!=='Local'"/>
  <NodeSelector v-if="!demoMode && ['Login','Register'].includes(route.name)" />
  <RouterView :key="route.name" />
</template>
