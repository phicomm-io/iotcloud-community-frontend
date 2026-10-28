// Exercise real controls while a read is pending: feedback must not reflow the page.
const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const engine=process.env.BROWSER||'chromium';
assert(['chromium','webkit'].includes(engine));
const root=path.resolve('build/bundle/demos');
const server=http.createServer((req,res)=>{
 const model=new URL(req.url,'http://local').pathname.slice(1);
 if(!['tc1','m1','a1'].includes(model)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,model,'index.html')));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 try{for(const model of ['tc1','m1','a1'])for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+model);
  await page.waitForFunction(()=>window.UI?.state);
  await page.locator('[data-tab="settings"]').tap();
  await page.locator('#side a[href="#settings/logs"]').tap();
  await page.waitForTimeout(100);
  // Hold the next log read until geometry has been sampled.
  await page.evaluate(()=>{
   const fetch=window.fetch;
   window.fetch=async(...args)=>{
    if(JSON.parse(args[1].body).action==='logs.get')await new Promise(r=>window.releaseLogRead=r);
    return fetch(...args);
   };
  });
  const buttons=page.locator('[data-settings-page="logs"] .btn');
  const bounds=()=>buttons.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
  const before=await bounds();
  await buttons.first().tap();
  await page.waitForFunction(()=>window.releaseLogRead);
  assert.equal(await buttons.first().getAttribute('aria-busy'),'true');
  assert.deepEqual(await bounds(),before,`${engine} ${model} ${width}: pending control moved the layout`);
  await page.evaluate(()=>window.releaseLogRead());
  await page.waitForFunction(()=>!document.querySelector('[data-settings-page="logs"] [aria-busy]'));
  assert.deepEqual(await bounds(),before,`${engine} ${model} ${width}: completed control moved the layout`);
  // Routing may reveal a horizontal menu item, but must not scroll outer ancestors.
  await page.evaluate(()=>{document.body.style.minHeight='3000px';window.scrollTo(0,600);});
  const scroll=await page.evaluate(()=>scrollY);
  await page.evaluate(()=>{location.hash='settings/device';});
  await page.locator('#deviceName').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>scrollY),scroll,`${engine} ${model} ${width}: route scrolled the document`);
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
  // Removing the touch overlay must preserve keyboard focus feedback.
  await page.locator('#deviceName').focus();await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus-visible').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
  assert.deepEqual(errors,[]);
  await page.close();console.log(`${engine} ${model} ${width} interaction layout passed`);
 }
 await require('./test_tc1_identity_browser.cjs')(browser);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
