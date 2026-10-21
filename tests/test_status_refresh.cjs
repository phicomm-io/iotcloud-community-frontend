/* Real rendered UI: generation barriers and concurrent reloads. */
const {JSDOM}=require('jsdom'),assert=require('node:assert/strict'),vm=require('vm');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const html=require('./render_page.cjs')('TC1/http_server/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.setTimeout=()=>0;w.clearTimeout=()=>{};
 const state={model:'tc1',name:'initial',version:'test',socket_states:[1,1,1,1,1,1],socket_names:['1','2','3','4','5','6'],mqtt_host:'',wifi_connected:true,led_enabled:false};
 let reads=0,held=false,release;
 w.fetch=async(_,options)=>{
  const q=JSON.parse(options.body);let data={};
  if(q.action==='capabilities.get')data={actions:[],status_views:['full','live']};
  if(q.action==='status.get'){
   reads++;data=JSON.parse(JSON.stringify(state));
   if(held){held=false;data.name='stale';await new Promise(r=>release=r);}
  }
  if(q.action==='indicator.set'){state.led_enabled=true;state.name='after-write';}
  return {ok:true,json:async()=>({code:'ok',data})};
 };
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],dom.getInternalVMContext());
 for(let i=0;i<12;i++)await tick();assert.equal(w.UI.confirmed.name,'initial');
 let before=reads;await Promise.all(Array.from({length:10},()=>w.UI.reload()));assert.equal(reads-before,1,'same-generation reloads coalesce');
 before=reads;await Promise.all(Array.from({length:10},()=>w.UI.reload({full:true})));assert.equal(reads-before,1,'simultaneous full reloads share one freshness goal');
 held=true;const old=w.UI.reload();await tick();
 const write=w.command('indicator.set',{on:true});
 const fresh=Array.from({length:10},()=>w.UI.reload());
 release();await old;assert.notEqual(w.UI.confirmed.name,'stale','write invalidates active old poll before UI merge');
 await write;before=reads;await Promise.all(fresh);assert(reads-before<=1);assert.equal(w.UI.confirmed.name,'after-write');assert.equal(w.UI.confirmed.led_enabled,true);
 w.dispatchEvent(new w.Event('pagehide'));dom.window.close();
 console.log('UI reload: concurrent/full coalescing and stale active poll across write barrier PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
