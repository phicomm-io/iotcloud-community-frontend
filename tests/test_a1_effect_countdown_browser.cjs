const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('build/bundle/demos/a1/index.html');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(root));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));
for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch();try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>UI.state);
 await page.evaluate(()=>I18N.set('en'));await page.evaluate(()=>location.hash='settings/light');
 await page.locator('input[name="effect"][value="2"]').check();const speed=page.getByRole('slider',{name:'Animation speed',exact:true});await speed.fill('9');
 await page.locator('[data-settings-page="light"] .form-actions button').click();
 await page.waitForFunction(async()=>(await command('light_effect.get')).speed===9);
 await page.evaluate(()=>location.hash='settings/schedule');await page.locator('[data-value="countdown"]').click();
 await page.getByRole('spinbutton',{name:'Hours',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'Minutes',exact:true}).fill('5');
 await page.locator('[data-settings-page="schedule"] [type="submit"]').click();await page.locator('[data-countdown-id]').waitFor();
 assert.equal(await page.evaluate(async()=>(await command('schedules.get')).items[0].seconds),3900);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} ${width} overflow`);
 await page.screenshot({path:`build/a1-countdown-${name}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Restart',exact:true}).waitFor();
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
 // Run a short simulator countdown through the same command contract.
 await page.evaluate(async()=>{await command('schedules.put',{id:1,enabled:true,trigger:'countdown',seconds:1,action:'fan.set',params:{on:false}});});
 await page.waitForFunction(async()=>(await command('status.get')).fan_on===false);
 await page.waitForFunction(()=>document.querySelector('[data-settings-page="schedule"]').textContent.includes('Executed'));
 assert.deepEqual(errors,[]);await page.close();console.log(`${name} ${width}: speed save, countdown create/cancel/restart/expire and layout PASS`);
 }}finally{await browser.close();}
}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
