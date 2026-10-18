<script setup>
import {onMounted,onBeforeUnmount} from 'vue';
import {banner,refreshBanner} from '../banner';
import BannerView from './BannerView.vue';
let timer;
const refreshVisible=()=>{if(!document.hidden)refreshBanner();};
onMounted(()=>{refreshBanner();timer=setInterval(refreshVisible,60000);document.addEventListener('visibilitychange',refreshVisible);});
onBeforeUnmount(()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible);});
</script>
<template><BannerView :banner="banner"/></template>
