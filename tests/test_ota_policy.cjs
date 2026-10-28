/* Stable channel UI: backend remains authoritative; never offer stale install. */
const {JSDOM}=require('jsdom'),assert=require('node:assert/strict');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{for(const model of ['M1','A1','TC1']){
 const html=require('./render_page.cjs')(model==='TC1'?'TC1/http_server/web/index.html':model+'/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local/#settings/firmware'}),w=dom.window,d=w.document;
 let result={state:'idle',available:false},installs=0;const timers=[];
 w.TextEncoder=require('node:util').TextEncoder;w.scrollTo=()=>{};w.confirm=()=>true;
 w.setTimeout=(fn,ms)=>{if(ms===500)timers.push(fn);return 0;};
 w.fetch=async(_url,options)=>{
  const req=JSON.parse(options.body);let data={};
  if(req.action==='capabilities.get')data={model:model.toLowerCase(),actions:['status.get','capabilities.get','ota.sources.get','ota.check','ota.check.get','ota.install']};
  if(req.action==='status.get')data={version:'0.9.27',wifi_connected:true};
  if(req.action==='ota.sources.get')data={sources:['cn']};
  if(req.action==='ota.check.get')data=result;
  if(req.action==='ota.install')installs++;
  return {ok:true,status:200,json:async()=>({code:'ok',data})};
 };
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))require('node:vm').runInContext(match[1],dom.getInternalVMContext());
 for(let i=0;i<15;i++)await flush();
 assert(d.querySelector('[data-i18n="fw.version_path_help"]'));
 const check=d.querySelector('[data-source="cn"]');assert(check);
 const install=[...d.querySelectorAll('button')].find(button=>button.textContent===w.I18N.t('fw.install_online'));assert(install);
 for(const candidate of [{state:'available',version:'1.0.0',available:true},{state:'up_to_date',version:'1.0.0',available:false},{state:'failed',version:'1.0.1',available:true},{state:'available',version:'1.0.1',available:false},{state:'available',version:'',available:true}]){
  result=candidate;check.click();await flush();await flush();for(const fn of timers.splice(0))fn();for(let i=0;i<5;i++)await flush();
  assert.equal(install.hidden,!(!!candidate.version&&candidate.available&&candidate.state==='available'));
  const before=installs;install.click();for(let i=0;i<3;i++)await flush();
  assert.equal(installs-before,!!candidate.version&&candidate.available&&candidate.state==='available'?1:0);
 }
 dom.window.close();console.log(model+': OTA bridge notice and available-only install PASS');
}})().catch(error=>{console.error(error);process.exit(1);});
