<script setup>
import {t} from '../i18n';
</script>
<template>
<section class="hub-setup"><p>{{t('hub.securityHelp')}}</p><a class="btn" href="/#settings/device">{{t('hub.deviceSettings')}}</a></section>
</template>
<style scoped>
.hub-setup p{font-size:13px;line-height:1.7;color:var(--muted)}.hub-setup a{color:var(--accent)}
</style>
