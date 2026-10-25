<script setup>
import {t} from '../i18n.js';

import AppIcon from './AppIcon.vue';
import ServerSettings from './ServerSettings.vue';
import ThemeToggle from './ThemeToggle.vue';
import {hubMode} from '../deployment';
const base=import.meta.env.BASE_URL;
</script>
<template>
 <main class="auth-page">
  <header class="auth-topbar"><RouterLink to="/login" class="brand"><span class="brand-mark"><img :src="''+base+'icons/iotcloud.svg'" width="32" height="32" alt="" /></span><span>IotCloud<span class="brand-subtitle">{{t('p.9f910e660235')}}</span></span></RouterLink><ThemeToggle /></header>
  <div class="auth-layout">
   <section class="account-page surface"><slot /><ServerSettings v-if="!hubMode" /></section>
  </div>
  <footer class="copyright">{{t('auth.copyright')}} · <a href="https://github.com/phicomm-io/iotcloud-community-mqtt" target="_blank" rel="noopener noreferrer">{{t('p.8ea335ab405f')}}</a> · <a href="https://phicomm-io.github.io" target="_blank" rel="noopener noreferrer">{{t('p.3f2111a48779')}}</a></footer>
 </main>
</template>
