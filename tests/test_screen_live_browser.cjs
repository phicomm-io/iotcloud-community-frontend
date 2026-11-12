/* Authorized BRY88 acceptance: saves the layout and exercises TVOC modes. */
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.SCREEN_LIVE_URL,out=process.env.SCREEN_BROWSER_ARTIFACTS;
const community=process.env.SCREEN_EXPECT_COMMUNITY==='1';
if(!url||!out)throw Error('Set SCREEN_LIVE_URL and SCREEN_BROWSER_ARTIFACTS');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true}),errors=[],commands=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/v1/command'))commands.push({method:r.method(),type:r.headers()['content-type'],bytes:r.postDataBuffer()?.length||0});});
  await page.goto(url.replace(/\/$/,'')+'/#settings/screen');
  await page.waitForFunction(()=>document.querySelector('#screenEditor')?.hidden===false);
  await page.evaluate(()=>{I18N.set('zh-CN');document.querySelectorAll('#screenEditor details').forEach(d=>d.open=true);});
  await page.locator('#screenLoad').click();await page.waitForSelector('[data-component="1"]');
  const before=await page.evaluate(async()=>({layout:await command('screen.layout.get',{offset:0,limit:512}),status:await command('status.get')}));
  assert.equal(before.status.hardware_model,'BRY88BBA15G');
  assert.equal(before.status.screen.extension_supported,community);
  const tvocModes=community&&Boolean(before.status.screen.capabilities&128);
  async function readLayout(){return page.evaluate(async()=>{
   const first=await command('screen.layout.get',{offset:0,limit:512}),bytes=new Uint8Array(first.total);
   for(let at=0;at<first.total;at+=512){
    const chunk=at?await command('screen.layout.get',{offset:at,limit:512}):first;
    if(chunk.revision!==first.revision||chunk.total!==first.total)throw Error('Layout changed while reading');
    bytes.set(Uint8Array.from(atob(chunk.bytes),c=>c.charCodeAt(0)),at);
   }
   if(ScreenLayout.crc(bytes)!==first.crc)throw Error('Layout CRC mismatch');
   return ScreenLayout.decode(bytes);
  });}
  async function saveAndWait(revision){
   await page.locator('#screenSave').click();
   await page.waitForFunction(()=>/^已保存|^Saved/.test(document.querySelector('#screenDraft').textContent));
   if(community)await page.waitForFunction(async revision=>{
    const s=(await command('status.get')).screen;
    return s.layout_sync==='applied'&&s.mcu_layout_revision===revision;
   },revision,{timeout:45000,polling:1000});
  }
  await saveAndWait(before.layout.revision+1);
  const modeResults=[];
  if(tvocModes){
   const scene=await readLayout(),tvoc=scene.items.find(it=>it.type===1&&it.binding===4);
   assert(tvoc,'Live layout needs a TVOC value');
   await page.locator('#screenEdit').click();
   await page.locator('#screenPage').selectOption(String(tvoc.page));
   await page.locator(`[data-component="${tvoc.id}"]`).click();
   for(const [index,mode]of [2,1].entries()){
    await page.locator('[data-component-field="value_mode"]').selectOption(String(mode));
    await saveAndWait(before.layout.revision+2+index);
    const saved=await readLayout();
    assert.equal(saved.items.find(it=>it.id===tvoc.id).value_mode,mode);
    modeResults.push({mode,revision:saved.revision});
   }
  }
  await page.locator('#screenTab_services').click();await page.locator('#screenReminders [data-i18n="screen.load"]').click();
  await page.locator('#screenWeather [data-i18n="screen.load"]').click();
  await page.waitForFunction(()=>document.querySelector('#screenWeatherProvider').value.length>0);
  const after=await page.evaluate(async()=>({layout:await command('screen.layout.get',{offset:0,limit:512}),weather:await command('screen.weather.get'),reminders:await command('screen.reminders.get',{offset:0}),status:await command('status.get')}));
  assert.equal(after.layout.revision,before.layout.revision+(tvocModes?3:1));
  assert.equal(after.layout.total,before.layout.total);
  if(community){
   await page.waitForFunction(async revision=>{
    const s=(await command('status.get')).screen;
    return s.extension_supported&&s.layout_sync==='applied'&&s.mcu_layout_revision===revision;
   },after.layout.revision,{timeout:45000,polling:1000});
   after.status=await page.evaluate(()=>command('status.get'));
   assert.equal(after.status.screen.mcu_layout_revision,after.layout.revision);
  }
  assert.equal(after.status.screen.config_load_error,'');
  assert.equal(after.status.screen.storage,'owned');
  assert.equal(await page.locator('#screenWeatherKey').inputValue(),'');
  assert.equal('key' in after.weather.config,false);
  await page.evaluate(()=>UI.reload());
  await page.waitForFunction(revision=>UI.state?.screen?.layout_revision===revision,after.layout.revision);
  await page.waitForFunction(()=>document.querySelectorAll('.toast').length===0);
  await page.locator('#screenEditor').screenshot({path:path.join(out,'live-screen-editor-1280-zh-CN.png')});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#screenEditor').screenshot({path:path.join(out,'live-screen-editor-390-zh-CN.png')});
  assert.deepEqual(errors,[]);assert(commands.length>10);
  assert(commands.every(c=>c.method==='POST'&&c.type==='application/msgpack'&&c.bytes>0));
  fs.writeFileSync(path.join(out,'live-browser.json'),JSON.stringify({result:'PASS',url,community,before_revision:before.layout.revision,after_revision:after.layout.revision,modeResults,screen:after.status.screen,weather:after.weather,reminders:after.reminders,commands,errors},null,2)+'\n');
  console.log('PASS live Chromium: complete layout save and MCU ACK, TVOC grade/number readback, reminders/weather reads, key redaction and mobile layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
