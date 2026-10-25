<script setup>
import {languagePreference,setLanguage,t} from '../i18n.js';
</script>
<template><label class="language-select"><span>{{t('language.label')}}</span><select :value="languagePreference" :aria-label="t('language.label')" @change="setLanguage($event.target.value)"><option value="auto">{{t('language.auto')}}</option><option value="zh-CN">{{t('language.chinese')}}</option><option value="en">{{t('language.english')}}</option></select></label></template>
<style scoped>.language-select{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:8px 20px;color:var(--muted);font-size:12px}.language-select select{width:auto;min-height:30px;padding:3px 28px 3px 8px}</style>
