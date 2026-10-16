<script setup>
import AppIcon from './AppIcon.vue';
import ServerSettings from './ServerSettings.vue';
import ThemeToggle from './ThemeToggle.vue';
const base=import.meta.env.BASE_URL;
</script>
<template>
 <main class="auth-page">
  <header class="auth-topbar"><RouterLink to="/login" class="brand"><span class="brand-mark"><img :src="''+base+'icons/iotcloud.svg'" width="32" height="32" alt="" /></span><span>IotCloud<span class="brand-subtitle">IoT 设备管理</span></span></RouterLink><ThemeToggle /></header>
  <div class="auth-layout">
   <section class="account-page surface"><slot /><ServerSettings /></section>
  </div>
  <footer class="copyright">Copyright &copy; Phicomm Community · <a href="https://github.com/phicomm-io/phicomm-community-firmware" target="_blank" rel="noopener noreferrer">固件仓库</a> · <a href="https://github.com/phicomm-io/phicomm-community-mqtt" target="_blank" rel="noopener noreferrer">MQTT 平台仓库</a> · <a href="https://github.com/phicomm-io/phicomm-community-frontend" target="_blank" rel="noopener noreferrer">前端仓库</a> · <a href="https://phicomm-io.github.io" target="_blank" rel="noopener noreferrer">项目网站</a></footer>
 </main>
</template>
