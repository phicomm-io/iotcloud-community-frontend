const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('build/bundle');
const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(file.endsWith(path.sep)||fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');try{const body=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true});try{
 for(const model of ['tc1','m1','a1','platform']){
  const page=await browser.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url());});
  await page.goto(base+'/demos/'+model+'/');
  if(model==='platform'){await page.waitForSelector('.device-select');assert.equal(await page.locator('.device-select').count(),3);for(const b of await page.locator('.device-select').all())await b.click();}
  else{await page.evaluate(()=>{location.hash='settings/firmware';});await page.locator('#otaSource').selectOption('global');await page.getByRole('button',{name:/检查更新|Check for updates/}).click();await page.getByText(/当前已是最新版本|Already up to date/).waitFor();}
  await page.waitForTimeout(100);assert.deepEqual(errors,[],model+' page errors');assert.deepEqual(external,[],model+' external requests');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),model+' mobile overflow');await page.close();console.log(model+' demo passed');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
