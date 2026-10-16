<script setup>
import { RouterView } from 'vue-router'
import NodeSelector from './components/NodeSelector.vue'
const demoMode=import.meta.env.VITE_DEMO==='1';
</script>

<template>
  <NodeSelector v-if="!demoMode" />
  <RouterView />
</template>
