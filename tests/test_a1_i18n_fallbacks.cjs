const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

for(const language of ['en','zh-CN'])test(`A1 missing automation and light-effect fields stay readable in ${language}`,async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 const warnings=[],writes=[];
 try{
  w.localStorage.setItem('phicomm.language',language);
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  w.console.warn=(...args)=>warnings.push(args.join(' '));
  w.fetch=async(url,options)=>{
   const request=JSON.parse(options.body);
   if(!request.action.endsWith('.get'))writes.push(request);
   const data=request.action==='binding.status.get'?{peers:[{mac:'aabbccddeeff',fresh:true}],average:{valid:false}}:{};
   return {ok:true,json:async()=>({code:'ok',data})};
  };
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  scripts.forEach((source,index)=>{
   if(index===scripts.length-1){w.UI.start=device=>{w.UI.device=device;w.UI.pages=device.pages;};w.UI.reload=async()=>{};}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  await flush();
  const state={red:0,green:100,blue:255,brightness:192,led_enabled:true,led_always_on:false,requested_speed:60,percentage:60,applied_speed:60,fan_on:true,fan_mode:'manual'};
  w.UI.state=state;
  // Older firmware may omit these optional fields in successful read replies.
  await w.UI.pages.light.show();w.UI.device.onStatus(state);
  const unknown=w.I18N.t('s.unknown'),auto=w.document.querySelector('#autoCard');
  assert.equal(auto.querySelector('.badge').textContent,unknown);
  assert.ok(auto.textContent.includes('—'),'missing automatic speed is shown as unavailable');
  assert.ok(w.document.querySelector('#effectNote').textContent.includes(unknown));
  assert.equal(w.document.querySelector('.ring-l').textContent,unknown);
  for(const node of [auto,w.document.querySelector('#effectNote'),w.document.querySelector('.ring-l')])assert.ok(!node.textContent.includes('undefined'));
  assert.deepEqual(warnings,[],'missing fields do not create missing translation keys');
  assert.deepEqual(writes,[],'display fallbacks do not change device configuration');
 }finally{dom.window.close();}
});
