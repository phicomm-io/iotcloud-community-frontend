<script setup>
import {ref} from 'vue';
import {nodes,currentNode,selectNode} from '../serverConfig';
const selected=ref(currentNode()),error=ref('');
function change(event){try{selectNode(event.target.value);}catch(e){error.value=e.message;selected.value=currentNode();}}
</script>
<template>
 <aside class="node-bar" aria-label="平台节点">
  <label>节点 <select :value="selected" aria-label="选择平台节点" @change="change"><option v-if="selected==='custom'" value="custom" disabled>本站 / 自定义</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{node.label}}</option></select></label>
  <span>China 与 US 的账号、设备和数据独立，需分别注册。</span>
  <span v-if="error" role="alert">{{error}}</span>
 </aside>
</template>
<style scoped>
.node-bar{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:10px 20px;border-bottom:1px solid var(--border);color:var(--muted);font-size:12px;background:var(--surface)}.node-bar label{display:flex;align-items:center;gap:8px;white-space:nowrap}.node-bar select{width:auto;padding:5px 28px 5px 10px;font-size:13px;min-height:32px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px}@media(max-width:600px){.node-bar{gap:5px;padding:8px 12px}.node-bar>span{font-size:11px;text-align:center}}
</style>
