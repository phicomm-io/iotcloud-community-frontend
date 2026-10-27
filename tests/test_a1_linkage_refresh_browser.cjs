const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http');
let html=require('./render_page.cjs')('A1/web/index.html');
// Use the real device page and renderers without starting background polling.
const last=html.lastIndexOf('<script>');
html=html.slice(0,last)+'<script>UI.start=dev=>{UI.device=dev;UI.pages=dev.pages;};</script>'+html.slice(last);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const engine=process.env.BROWSER||'webkit',browser=await ({chromium,webkit}[engine]).launch();
 try{for(const fresh of [false,true]){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.fixture={hold:null,fail:null,waiting:null,release:null,minimum:20};
   window.fetch=async(url,options)=>{
    const {action}=JSON.parse(options.body),f=fixture;
    if(action===f.hold){f.waiting=action;await new Promise(resolve=>f.release=resolve);f.waiting=null;}
    if(action===f.fail)throw Error('fixture unavailable');
    const data=action==='binding.status.get'?{average:{valid:true,fields:{pm25:true}}}:
     {enabled:1,metrics:1,mode:0,min_speed:f.minimum,max_speed:100,fixed_speed:50,statistic:0};
    return {ok:true,json:async()=>({code:'ok',data})};
   };
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async fresh=>{
   UI.caps={fresh_air:fresh,actions:['fan.mode.set']};
   document.getElementById('homePage').hidden=true;document.getElementById('settingsPage').hidden=false;
   const box=document.querySelector('[data-settings-page="linkage"]');box.hidden=false;
   await UI.pages.linkage.show();
   window.previous=[...box.children];window.emptyFrames=0;
   new MutationObserver(()=>{if(!box.querySelector('input'))emptyFrames++;}).observe(box,{childList:true,subtree:true});
  },fresh);
  const box=page.locator('[data-settings-page="linkage"]');
  assert.equal(await box.locator('[data-auto-fan]').count(),fresh?2:1);
  for(const hold of ['linkage.get',...(fresh?['fresh_air.linkage.get']:[])]){
   await page.evaluate(hold=>{
    fixture.hold=hold;fixture.minimum++;
    window.refreshResult=UI.pages.linkage.show().then(()=>null,e=>e.message);
   },hold);
   await page.waitForFunction(()=>fixture.waiting);
   assert.equal(await page.evaluate(()=>previous.every(el=>el.isConnected)),true,'keep all existing sections while a read is pending');
   assert.equal(await box.locator('input').first().isVisible(),true);
   await page.evaluate(()=>fixture.release());
   assert.equal(await page.evaluate(()=>refreshResult),null);
   assert.equal(await box.locator('[data-auto-fan]').count(),fresh?2:1);
   assert.equal(await page.evaluate(()=>emptyFrames),0,'never expose an empty intermediate page');
   await page.evaluate(()=>previous=[...document.querySelector('[data-settings-page="linkage"]').children]);
  }
  await page.evaluate(()=>{
   UI.reload=async()=>{};UI.pages.light={show:async()=>{}};UI.pages.binding={show:async()=>{}};
   fixture.hold='linkage.get';UI.embeddedRoute='settings/linkage';UI.showRoute();
  });
  await page.waitForFunction(()=>fixture.waiting);
  assert(await page.evaluate(()=>{
   const start=performance.now();
   for(const route of ['light','binding','linkage']){UI.embeddedRoute='settings/'+route;UI.showRoute();}
   return performance.now()-start<1000;
  }),'three settings switches take less than one second');
  assert.equal(await box.isVisible(),true);
  assert.equal(await page.evaluate(()=>previous.every(el=>el.isConnected)),true);
  await page.evaluate(()=>fixture.release());
  await page.waitForFunction(()=>previous.every(el=>!el.isConnected));
  await page.evaluate(()=>previous=[...document.querySelector('[data-settings-page="linkage"]').children]);
  // A failed first or second read must leave the complete previous view intact.
  for(const fail of ['linkage.get',...(fresh?['fresh_air.linkage.get']:[])]){
   await page.evaluate(fail=>{fixture.hold=null;fixture.fail=fail;},fail);
   assert.equal(await page.evaluate(()=>UI.pages.linkage.show().then(()=>null,e=>e.message)),'fixture unavailable');
   assert.equal(await page.evaluate(()=>previous.every(el=>el.isConnected)),true);
   assert.equal(await page.evaluate(()=>emptyFrames),0);
  }
  assert.deepEqual(errors,[]);await page.close();
  console.log(`${engine} fresh_air=${fresh}: pending reads, atomic refresh and failed-read retention PASS`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
