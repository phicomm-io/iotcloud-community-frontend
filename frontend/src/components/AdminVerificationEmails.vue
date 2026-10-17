<script setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {api} from '../account';
const props=defineProps({enabled:Boolean});
const data=ref(null),error=ref(''),busy=ref(false),days=ref(30),email=ref(''),status=ref(''),page=ref(1),revealed=ref(new Set()),clock=ref(Date.now());
let timer,tick,sequence=0,stopped=false,serverOffset=0;
const labels={unknown:'发送结果未知',sending:'发送中／结果待确认',sent:'已发送，待注册',registered:'已注册',expired:'已过期，未注册',failed:'发送失败',superseded:'重发后失效',verified:'验证通过，注册未完成',registration_failed:'验证通过，注册失败'};
const metrics=[['sent_emails','已发送邮箱'],['registered_emails','已注册邮箱'],['unregistered_emails','已发送但未注册'],['expired_unregistered_emails','已过期未注册'],['failed_attempts','发送失败次数']];
const pages=computed(()=>Math.max(1,Math.ceil((data.value?.total||0)/50)));
function effectiveStatus(row){return row.status==='sent'&&row.expires_at*1000<=clock.value+serverOffset?'expired':row.status;}
function time(value){return value?new Date(value*1000).toLocaleString():'—';}
async function refresh(reset=false){
 if(reset)page.value=1;
 const id=++sequence;busy.value=true;revealed.value=new Set();
 const query=new URLSearchParams({days:String(days.value),email:email.value.trim(),status:status.value,page:String(page.value)});
 try{const next=await api('/admin/verification-emails?'+query);if(id===sequence&&!stopped){data.value=next;serverOffset=next.server_time*1000-Date.now();error.value='';}}
 catch(e){if(id===sequence&&!stopped){error.value=e.message;data.value=null;}}
 finally{if(id===sequence&&!stopped)busy.value=false;}
}
function reveal(id){const next=new Set(revealed.value);next.has(id)?next.delete(id):next.add(id);revealed.value=next;}
function turn(delta){page.value+=delta;refresh();}
onMounted(()=>{refresh();timer=setInterval(refresh,30000);tick=setInterval(()=>{clock.value=Date.now();},1000);});
onBeforeUnmount(()=>{stopped=true;clearInterval(timer);clearInterval(tick);});
</script>
<template>
<section class="card verification-records" aria-labelledby="verification-records-title">
 <header class="verification-heading"><div><h2 id="verification-records-title">注册验证码记录</h2><p class="help">{{props.enabled?'邮箱验证已开启':'邮箱验证未开启，仍可查看历史记录'}} · 每 30 秒刷新</p></div><button type="button" :disabled="busy" @click="refresh()">{{busy?'刷新中…':'刷新记录'}}</button></header>
 <p class="help verification-note">“已发送”表示邮件服务器已接受，不代表已送达收件箱。可结合未注册数量排查邮件或垃圾箱问题。记录保留 90 天，从功能启用后开始。</p>
 <form class="verification-filters" @submit.prevent="refresh(true)"><label>记录范围<select aria-label="记录范围" v-model="days" @change="refresh(true)"><option :value="1">近 1 天</option><option :value="7">近 7 天</option><option :value="30">近 30 天</option><option :value="90">近 90 天</option></select></label><label>状态<select aria-label="状态" v-model="status" @change="refresh(true)"><option value="">全部状态</option><option v-for="(name,key) in labels" :key="key" :value="key">{{name}}</option></select></label><label>搜索邮箱<input v-model="email" maxlength="254" placeholder="输入全部或部分邮箱" type="search" /></label><button :disabled="busy">查询</button></form>
 <p v-if="error" role="alert" class="error">{{error}}</p>
 <template v-if="data">
  <div class="verification-metrics"><div v-for="[key,title] in metrics" :key="key"><span>{{title}}</span><b>{{data.summary[key]}}</b></div></div>
  <p class="help">概况按所选时间范围统计，不受邮箱和状态筛选影响；邮箱去重，重发不会重复计入。未注册指尚无成功注册记录的邮箱。</p>
  <ul v-if="data.records.length" class="verification-list"><li v-for="row in data.records" :key="row.id">
   <header><b class="verification-email">{{row.email}}</b><span class="verification-status" :class="{'is-failed':['failed','registration_failed'].includes(effectiveStatus(row)),'is-registered':effectiveStatus(row)==='registered'}">{{labels[effectiveStatus(row)]||row.status}}</span></header>
   <dl><div><dt>申请时间</dt><dd>{{time(row.created_at)}}</dd></div><div><dt>发送时间</dt><dd>{{time(row.sent_at)}}</dd></div><div><dt>有效期至</dt><dd>{{time(row.expires_at)}}</dd></div><div v-if="row.username"><dt>注册账号</dt><dd>{{row.username}}</dd></div><div v-if="row.registered_at"><dt>注册时间</dt><dd>{{time(row.registered_at)}}</dd></div></dl>
   <p v-if="row.detail" class="help">{{row.detail}}</p>
   <div v-if="row.code&&effectiveStatus(row)==='sent'" class="verification-code"><button type="button" :aria-expanded="revealed.has(row.id)" @click="reveal(row.id)">{{revealed.has(row.id)?'隐藏验证码':'查看验证码'}}</button><code v-if="revealed.has(row.id)" aria-label="有效验证码">{{row.code}}</code><span class="help">仅管理员可见，可手动提供给申请人；仍须在有效期内使用。</span></div>
  </li></ul>
  <p v-else class="help" role="status">当前条件下暂无验证码记录。</p>
  <nav class="verification-pagination" aria-label="验证码记录分页"><span class="help">共 {{data.total}} 条 · 第 {{page}} / {{pages}} 页</span><button type="button" :disabled="busy||page<=1" @click="turn(-1)">上一页</button><button type="button" :disabled="busy||page>=pages" @click="turn(1)">下一页</button></nav>
 </template><p v-else-if="busy" role="status" class="help">正在加载验证码记录…</p>
</section>
</template>
<style scoped>
.verification-records{margin-top:24px}.verification-heading,.verification-list li>header,.verification-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.verification-heading h2{margin-bottom:8px}.verification-note{margin:16px 0;line-height:1.7}.verification-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:20px 0}.verification-filters label{display:grid;gap:8px;min-width:0;flex:1 1 160px}.verification-filters input,.verification-filters select{width:100%;min-width:0}.verification-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:20px 0 12px}.verification-metrics>div{display:grid;gap:10px;background:var(--surface-muted);border-radius:var(--radius-s);padding:16px}.verification-metrics span{font-size:12px;color:var(--muted)}.verification-metrics b{font-size:24px}.verification-list{list-style:none;padding:0;margin:20px 0}.verification-list li{padding:20px 0;border-bottom:1px solid var(--border)}.verification-email{overflow-wrap:anywhere}.verification-status{font-size:12px;color:var(--muted);padding:6px 10px;background:var(--surface-muted);border-radius:var(--radius-s)}.is-failed{color:var(--danger)}.is-registered{color:var(--accent)}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}dl>div{min-width:0}dt{font-size:12px;color:var(--muted)}dd{margin:5px 0 0;font-size:13px;overflow-wrap:anywhere}.verification-code{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.verification-code code{font-size:22px;letter-spacing:3px}.verification-code .help{flex:1 1 220px}.verification-pagination{justify-content:flex-end}.verification-pagination>span{margin-right:auto}.verification-records button{min-height:44px}@media(max-width:480px){.verification-filters label{flex-basis:100%}.verification-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:1fr}}
</style>
