<script setup>
import {t} from '../i18n.js';

import {ref,onMounted,onBeforeUnmount} from 'vue';
import pages from 'virtual:device-pages';
const props=defineProps({device:Object,sensorSources:{type:Array,default:()=>[]}});
const emit=defineEmits(['command','settings','upload','resource']);
const uploads=new Map();
const frame=ref(),height=ref(700);
function receive(event){
 if(event.source!==frame.value?.contentWindow||event.origin!==location.origin)return;
 if(event.data?.type==='device-height'){height.value=Math.max(200,Math.min(12000,Number(event.data.height)||700));return;}
 if(event.data?.type==='device-settings'){emit('settings');return;}
 if(event.data?.type==='device-sensor-sources'){
  if(typeof event.data.id==='string')event.source.postMessage({type:'device-sensor-sources-result',id:event.data.id,sources:JSON.parse(JSON.stringify(props.sensorSources))},location.origin);
  return;
 }
 if(event.data?.type==='device-upload-abort'){uploads.get(event.data.id)?.();uploads.delete(event.data.id);return;}
 if(event.data?.type==='device-upload'){
  const {id,file,rescue,target:conversion}=event.data,target=event.source;
  if(typeof id!=='string'||uploads.has(id)||uploads.size||!(file instanceof Blob))return;
  const post=data=>{if(frame.value?.contentWindow===target)target.postMessage({id,...data},location.origin);};
  if(conversion!==undefined&&(conversion?.variant!=='hub'||conversion?.confirm!=='full-to-hub'||rescue||props.device.model!=='daikin')){post({type:'device-upload-result',result:{status:0,text:t('p.bcce0d150ca6')}});return;}
  uploads.set(id,()=>{});
  emit('upload',file,!!rescue,(loaded,total)=>post({type:'device-upload-progress',loaded,total}),result=>{uploads.delete(id);post({type:'device-upload-result',result});},abort=>uploads.set(id,abort),conversion===undefined?undefined:{variant:'hub',confirm:'full-to-hub'});return;
 }
 if(event.data?.type==='device-resource'){
  const {id,path,method,body}=event.data,target=event.source;
  if(typeof id!=='string'||!['/api/v1/config/backup','/api/v1/config/restore'].includes(path)||body?.byteLength>16384)return;
  emit('resource',path,{method,body},result=>{if(frame.value?.contentWindow===target)target.postMessage({type:'device-resource-result',id,...result},location.origin);});return;
 }
 if(event.data?.type!=='device-command')return;
 const {id,request}=event.data,target=event.source;
 emit('command',request,reply=>{if(frame.value?.contentWindow===target)target.postMessage({type:'device-result',id,reply:JSON.parse(JSON.stringify(reply))},location.origin);});
}
defineExpose({refresh:()=>frame.value?.contentWindow?.UI?.reload()});
onMounted(()=>window.addEventListener('message',receive));
onBeforeUnmount(()=>{window.removeEventListener('message',receive);for(const abort of uploads.values())abort();uploads.clear();});
</script>
<template><iframe ref="frame" class="device-home" :style="{height:height+'px'}" :srcdoc="pages[props.device.model]" :title="t('p.82a2884d1cbe',{v0:(props.device.model.toUpperCase())})" sandbox="allow-scripts allow-same-origin allow-modals allow-forms" /></template>
<style scoped>
.device-home{display:block;width:100%;border:0;border-radius:0;background:var(--bg);}
</style>
