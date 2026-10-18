<script setup>
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {useRoute} from 'vue-router';
import {account} from '../account';
import {scopeKey} from '../serverConfig';
import {bannerHidden,hideBanner} from '../bannerPreferences';
import {banner,refreshBanner} from '../banner';
import BannerView from './BannerView.vue';
let timer;
const route=useRoute(),now=ref(Date.now()),preferences=ref(0);
const visible=computed(()=>{
 preferences.value;
 const audience=banner.audience==='after_login'?!!account.username:!account.username&&['Login','Register'].includes(route.name);
 return audience&&!bannerHidden(banner,scopeKey(),account.username,now.value);
});
const refreshVisible=()=>{if(!document.hidden){now.value=Date.now();refreshBanner();}};
const storageChanged=()=>{now.value=Date.now();preferences.value++;};
function dismiss(choice){hideBanner(banner,scopeKey(),account.username,choice);preferences.value++;}
watch(()=>account.username,()=>{banner.enabled=false;refreshVisible();});
onMounted(()=>{refreshVisible();timer=setInterval(refreshVisible,60000);document.addEventListener('visibilitychange',refreshVisible);window.addEventListener('storage',storageChanged);});
onBeforeUnmount(()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible);window.removeEventListener('storage',storageChanged);});
</script>
<template><BannerView v-if="visible" :banner="banner" dismissible @dismiss="dismiss"/></template>
