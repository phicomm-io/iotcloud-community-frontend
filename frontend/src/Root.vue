<script setup>
import { RouterView,useRoute } from 'vue-router'
import NodeSelector from './components/NodeSelector.vue'
import PlatformBanner from './components/PlatformBanner.vue'
import LanguageSelect from './components/LanguageSelect.vue'
import {language} from './i18n.js'
import {hubMode} from './deployment.js'
const demoMode=import.meta.env.VITE_DEMO==='1';
const route=useRoute();
</script>

<template>
  <LanguageSelect/>
  <PlatformBanner v-if="!demoMode && !hubMode && route.name!=='Local'"/>
  <NodeSelector v-if="!demoMode && !hubMode && ['Login','Register'].includes(route.name)" />
  <RouterView :key="route.name+language" />
</template>
