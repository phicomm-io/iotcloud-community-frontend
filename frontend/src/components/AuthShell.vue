<script setup>
import AppIcon from './AppIcon.vue';
import ThemeToggle from './ThemeToggle.vue';
</script>
<template>
 <main class="auth-page">
  <header class="auth-topbar"><RouterLink to="/login" class="brand"><span class="brand-mark"><AppIcon name="plug" :size="23" /></span><span>Phicomm<span class="brand-subtitle">TMCP</span></span></RouterLink><ThemeToggle /></header>
  <div class="auth-layout">
   <section class="account-page surface"><slot /></section>
  </div>
  <footer class="copyright">Copyright &copy; Phicomm Community · <a href="https://github.com/phicomm-io/phicomm-community-firmware" target="_blank" rel="noopener noreferrer">固件仓库</a> · <a href="https://github.com/phicomm-io/phicomm-community-mqtt" target="_blank" rel="noopener noreferrer">MQTT 平台仓库</a></footer>
 </main>
</template>
