// Real rendered pages, populated with the firmware's advertised peer capacity.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('build/bundle/demos');
const server=http.createServer((req,res)=>{const model=req.url.slice(1);if(!['m1','a1'].includes(model)){res.writeHead(404).end();return;}res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,model,'index.html')));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{for(const model of ['m1','a1'])for(const width of [375,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+model);
  await page.waitForFunction(()=>window.UI?.state);
  await page.evaluate(()=>{
   const original=window.api;
   window.api=async(path,data)=>{
    const value=await original(path,data);
    if(path!='/binding/config'||data!==undefined)return value;
    const macs=['b0f8932864b6','b0f8932864b7','b0f8932864b8','b0f8932864b9'];
    return {...value,max_peers:4,max_sessions:4,peers:macs.map(mac=>({mac,ip:'192.168.123.123',session_ready:true,transport:'lan'}))};
   };
   location.hash='settings/binding';
  });
  const section=page.locator('[data-settings-page="binding"]');
  await section.locator('.binding-peer').first().waitFor();
  assert.equal(await section.locator('.binding-peer').count(),4);
  assert.ok((await section.innerText()).includes('4 / 4'));
  if(model==='a1'){
   assert.equal(await section.locator('form button[type=submit]').isDisabled(),true);
   assert.equal(await section.locator('input[name=force_mqtt]').count(),0);
  }else{
   assert.equal(await section.locator('form,input,button[data-remove]').count(),0);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${model} ${width} overflow`);
  await page.screenshot({path:`build/binding-${model}-${width}.png`,fullPage:true});
  await page.close();console.log(model,width,'capacity and layout passed');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
