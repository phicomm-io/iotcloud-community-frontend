const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('build/bundle');
const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(file.endsWith(path.sep)||fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');try{const body=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true});try{
 for(const model of ['tc1','m1','a1','daikin','platform']){
  const page=await browser.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url());});
  await page.goto(base+'/demos/'+model+'/');
  if(model!=='platform')for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});
   await page.locator('[data-tab="settings"]').click();
   await page.locator('#side a[href="#settings/device"]').click();
   await page.locator('#deviceName').waitFor({state:'visible'});
   await page.locator('#webPassword').waitFor({state:'visible'});
   assert.equal(await page.locator('#side a[href="#settings/device"]').getAttribute('aria-current'),'page');
   await page.locator('[data-tab="home"]').click();
  }
  if(model==='a1'){
   await page.locator('#filterCard').waitFor({state:'visible'});
   assert.equal(await page.locator('#filterRemaining').textContent(),'95%');
   await page.locator('#filterCard summary').click();await page.locator('#filterLifetime').fill('6000');await page.locator('#filterSave').click();
   await page.waitForFunction(()=>UI.state.filter.lifetime_hours===6000);
   await page.locator('#filterReset').click();await page.getByRole('dialog').getByRole('button',{name:/Cancel|取消/}).click();
   assert.equal(await page.evaluate(()=>UI.state.filter.used_seconds),864000);
   await page.locator('#filterReset').click();await page.getByRole('dialog').getByRole('button',{name:/Reset after replacing|更换滤芯后重置/}).click();
   await page.waitForFunction(()=>UI.state.filter.used_seconds===0);
   assert.equal(await page.locator('#filterRemaining').textContent(),'100%');
  }
  if(model==='platform'){
   await page.waitForSelector('.device-select');assert.equal(await page.locator('.device-select').count(),4);for(const b of await page.locator('.device-select').all())await b.click();
   await page.locator('.device-select').nth(2).click();
   const frame=page.frameLocator('iframe.device-home');
   await frame.locator('#filterCard').waitFor({state:'visible'});
   await frame.locator('#filterCard summary').click();await frame.locator('#filterLifetime').fill('6000');await frame.locator('#filterSave').click();
   await frame.locator('body').evaluate(()=>new Promise((resolve,reject)=>{let n=0;const check=()=>{if(UI.state.filter.lifetime_hours===6000)resolve();else if(++n>100)reject(Error('platform filter form did not submit'));else setTimeout(check,50);};check();}));
   await frame.locator('#filterReset').click();await frame.getByRole('dialog').getByRole('button',{name:'更换滤芯后重置'}).click();
   await frame.locator('body').evaluate(()=>new Promise((resolve,reject)=>{let n=0;const check=()=>{if(UI.state.filter.used_seconds===0)resolve();else if(++n>100)reject(Error('platform filter reset failed'));else setTimeout(check,50);};check();}));
  }
  else if(model==='daikin'){
   await page.locator('[data-sensor="pm25"] > .stat > .num').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-sensor="pm10"] .num').textContent(),'28');
   assert.equal(await page.locator('.metrics > .metric:visible').count(),5);
   assert.equal(await page.locator('[data-sensor="formaldehyde"]').isVisible(),false);
   await page.locator('[data-sensor="temperature"] .scale').waitFor({state:'visible'});
   await page.evaluate(()=>{location.hash='settings/firmware';});
   assert.equal(await page.locator('#otaSources').isVisible(),false);
  }
  else{await page.evaluate(()=>{location.hash='settings/firmware';});for(const source of ['github','cn','global']){await page.locator(`#otaSources [data-source="${source}"]`).click();await page.waitForFunction(()=>[...document.querySelectorAll('#otaSources button')].every(b=>!b.disabled));await page.getByText(/当前已是最新版本|Already up to date/).waitFor();}}
  await page.waitForTimeout(100);assert.deepEqual(errors,[],model+' page errors');assert.deepEqual(external,[],model+' external requests');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),model+' mobile overflow');await page.close();console.log(model+' demo passed');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
