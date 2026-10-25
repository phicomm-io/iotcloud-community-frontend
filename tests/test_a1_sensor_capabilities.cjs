const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('A1 automation is selected by fresh measurements, with absent values hidden',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 let fields={pm25:true,formaldehyde:false};const writes=[],timers=[];
 const saved={enabled:1,metrics:3,mode:1,min_speed:0,max_speed:100,fallback_speed:30,hysteresis_enabled:1,low_pm:10,high_pm:100,low_hcho:.01,high_hcho:.1,target_pm:15,on_pm:50,target_hcho:.01,on_hcho:.1,statistic:0};
 try{
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=(fn,ms)=>{if(ms===3000)timers.push(fn);return 0;};
 w.fetch=async(url,options)=>{const req=JSON.parse(options.body);let data={};
 if(req.action==='binding.status.get')data={peers:[{mac:'9c9c1ff76748',fresh:true}],average:{valid:true,fields,pm25:42,formaldehyde:null}};
 else if(req.action==='linkage.get')data={...saved};
 else if(req.action==='light_effect.get')data={effect:0};
 else if(req.action==='linkage.set'){writes.push(req.params);data={revision:1};}
 return {ok:true,json:async()=>({code:'ok',data})};};
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((source,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;w.UI.pages=dev.pages;};vm.runInContext(source,dom.getInternalVMContext());});
 w.UI.caps={actions:['fan.mode.set']};
 await w.UI.device.pages.linkage.show();
 let page=w.document.querySelector('[data-settings-page="linkage"]');
 assert.match(page.textContent,/PM2.5/);assert.ok(!page.textContent.includes(w.I18N.t('m.formaldehyde')));
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 page.querySelector('.form-actions button').click();await flush();await flush();
 assert.equal(writes.length,0,'unavailable saved metrics must not be sent');
 fields={pm25:true,formaldehyde:true};await w.UI.device.pages.linkage.show();
 assert.ok(page.textContent.includes(w.I18N.t('m.formaldehyde')));
 fields={pm25:false,formaldehyde:false};await w.UI.device.pages.linkage.show();
 assert.ok(page.textContent.includes(w.I18N.t('auto.no_data_options')));
 assert.equal(saved.metrics,3,'missing data must not overwrite the saved rule');
 // Poll changes the options without reloading and discarding the draft.
 w.UI.embeddedRoute='settings/linkage';
 const speed=[...page.querySelectorAll('input')].find(el=>el.type==='number');
 speed.value='17';speed.dispatchEvent(new w.Event('input'));
 fields={pm25:true,formaldehyde:true};await flush();
 const loadedBefore=writes.length;
 assert.ok(timers.length);await timers.shift()();
 assert.ok(page.textContent.includes(w.I18N.t('m.formaldehyde')));
 page.querySelector('.form-actions button').click();await flush();await flush();
 assert.equal(writes.length,loadedBefore+1);
 assert.equal(writes[0].min_speed,17,'capability refresh retains edited settings');
 assert.equal(writes[0].metrics,3,'capability loss and recovery retain saved choices');
 fields={pm25:true,formaldehyde:false};await timers.shift()();
 const selectAvailable=[...page.querySelectorAll('button')].find(el=>el.textContent===w.I18N.t('auto.available_only'));
 assert.ok(selectAvailable);selectAvailable.click();
 page.querySelector('.form-actions button').click();await flush();await flush();
 assert.equal(writes.at(-1).metrics,1,'only an explicit choice drops unavailable metrics');
 }finally{dom.window.close();}
});
