<script setup>
import {t} from '../i18n.js';

import {ref,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {deviceKey} from '../deviceProtocol';
import DeviceSummary from './DeviceSummary.vue';
import AppIcon from './AppIcon.vue';
defineProps({devices:Array,selected:String,states:Object,deviceName:Function,connected:Boolean,now:Number});
const emit=defineEmits(['select','refresh','add']);
const dialog=ref(),list=ref();
let media,overflow,trigger;
function unlock(){
 if(!overflow)return;
 document.documentElement.style.overflow=overflow.html;
 document.body.style.overflow=overflow.body;
 overflow=null;
}
function closed(){if(dialog.value?.open)return;unlock();if(trigger?.getClientRects().length)trigger.focus({preventScroll:true});}
function close(){dialog.value?.close();unlock();}
async function open(){
 if(dialog.value.open)return;
 trigger=document.activeElement;
 dialog.value.showModal();
 overflow={html:document.documentElement.style.overflow,body:document.body.style.overflow};
 document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';
 await nextTick();
 const selected=list.value.querySelector('[aria-pressed=true]');
 if(selected)list.value.scrollTop+=selected.getBoundingClientRect().top-list.value.getBoundingClientRect().top;
}
function add(){close();emit('add');}
function select(device){emit('select',deviceKey(device));close();}
function keydown(event){
 if(event.key!=='Tab')return;
 const buttons=[...dialog.value.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
function backdrop(event){if(event.target!==dialog.value)return;const r=dialog.value.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}
function resize(){if(!media.matches)close();}
onMounted(()=>{media=matchMedia('(max-width:800px)');media.addEventListener('change',resize);});
onBeforeUnmount(()=>{media?.removeEventListener('change',resize);close();});
defineExpose({open});
</script>
<template>
 <dialog ref="dialog" class="device-picker" aria-labelledby="device-picker-title" @cancel="unlock" @close="closed" @click="backdrop" @keydown="keydown">
  <header><h2 id="device-picker-title">{{t('p.28465d512f3a')}} <small>{{devices.length}} {{t('p.991363a244f0')}}</small></h2><button type="button" :aria-label="t('p.29813d4b9d79')" autofocus @click="close"><AppIcon name="close"/></button></header>
  <button class="add-device-entry" type="button" @click="add"><AppIcon name="plus" :size="17"/>{{t('p.3aea0927d015')}}</button>
  <ul ref="list" class="picker-list">
   <li v-for="device in devices" :key="deviceKey(device)"><button type="button" :aria-pressed="selected===deviceKey(device)" @click="select(device)"><DeviceSummary :device="device" :state="states[deviceKey(device)]||{}" :name="deviceName(device)" :connected="connected" :now="now"/><AppIcon v-if="selected===deviceKey(device)" name="check"/></button></li>
   <li v-if="!devices.length" class="help">{{t('p.a19be92ce7b8')}}</li>
  </ul>
  <footer><button type="button" @click="emit('refresh')">{{t('p.9758635d2f5e')}}</button><button type="button" @click="close">{{t('p.c0b3fbff51cc')}}</button></footer>
 </dialog>
</template>
<style scoped>
.device-picker{position:fixed;inset:auto 0 0;margin:0 auto;width:100%;max-width:800px;max-height:80vh;max-height:80dvh;padding:0;border:1px solid var(--border);border-bottom:0;border-radius:20px 20px 0 0;background:var(--surface);color:var(--text);box-shadow:var(--shadow);overflow:hidden}
.device-picker[open]{display:flex;flex-direction:column}.device-picker::backdrop{background:rgb(0 0 0 / .4)}
.device-picker header,.device-picker footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex-shrink:0}
.device-picker header{border-bottom:1px solid var(--border)}.device-picker h2 small{margin-left:6px;font-size:12px;font-weight:400;color:var(--muted)}
.device-picker button{min-height:44px}.device-picker header button{width:44px;padding:8px}
.picker-list{list-style:none;margin:0;padding:12px 16px;overflow-y:auto;overscroll-behavior:contain;min-height:0;display:grid;gap:10px}
.picker-list>li>button{width:100%;padding:12px;justify-content:flex-start;text-align:left}.picker-list>li>button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft)}
.device-picker>.add-device-entry{margin:12px 16px 0;flex-shrink:0}
.device-picker footer{border-top:1px solid var(--border);padding-bottom:max(12px,env(safe-area-inset-bottom))}
</style>
