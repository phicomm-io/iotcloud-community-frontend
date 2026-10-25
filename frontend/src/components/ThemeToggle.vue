<script setup>
import {t} from '../i18n.js';

import { theme, toggleTheme } from '../appearance';
import AppIcon from './AppIcon.vue';
</script>
<template><button class="theme-toggle icon-button" type="button" @click="toggleTheme" :aria-label="t('p.fb542174c933',{v0:t('theme.'+theme)})" :title="t('p.e918bce0bd42',{v0:t('theme.'+theme)})"><AppIcon :name="theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'" /></button></template>
