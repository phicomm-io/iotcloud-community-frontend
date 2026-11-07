/* Actual minified WebUI and Pages converter over MessagePack HTTP. */
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),vm=require('node:vm');
const html=cp.execFileSync('python3',['common/web/page.py','DAIKIN/web/index.html','--minify']);
const wire=import('../frontend/src/wireCodec.js'),context=vm.createContext({Uint8Array,DataView});
vm.runInContext(fs.readFileSync('DAIKIN/web/screen-appearance.js','utf8'),context);const A=context.ScreenAppearance;
const initial=process.env.SCREEN_TEST_LAYOUT?fs.readFileSync(process.env.SCREEN_TEST_LAYOUT):cp.execFileSync(process.env.SCREEN_SCENE_CODEC,['default']);
const output=process.env.SCREEN_BROWSER_ARTIFACTS;fs.mkdirSync(output,{recursive:true});
let appearance,scene=initial,writes=[],wp,staged,wpHeader,wpWait=0,receivedFile,prepareWait=0;
const actions=['status.get','config.get','capabilities.get','binding.status.get','screen.layout.get','screen.appearance.get','screen.appearance.set','screen.wallpaper.get','screen.wallpaper.begin','screen.wallpaper.chunk','screen.wallpaper.commit','screen.wallpaper.cancel'];
const status=()=>({model:'daikin',hardware_model:'BRY88BBA15G',device_id:'aabbccddeeff',name:'Room',version:'dev-dirty',wifi_connected:true,screen:{extension_supported:true,capabilities:8189,layout_revision:scene.readUInt32LE(4),mcu_layout_revision:scene.readUInt32LE(4),ota:{state:'empty'}}});
const server=http.createServer(async(req,res)=>{
 try{
  const {encodeWire,decodeWire}=await wire,reply=(code,data={})=>res.writeHead(200,{'Content-Type':'application/msgpack'}).end(encodeWire({code,data}));
  if(req.url==='/api/v1/info')return reply('ok',{api_version:1,device_id:'aabbccddeeff',model:'daikin',firmware_version:'dev-dirty',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack',password_set:false});
  if(req.method==='GET'){
   if(req.url.startsWith('/tools/')||['/style.css','/theme.js'].includes(req.url)){const file=path.resolve(process.env.SCREEN_PAGES_ROOT,'.'+req.url.split('?')[0]);assert(file.startsWith(path.resolve(process.env.SCREEN_PAGES_ROOT)+path.sep));const target=req.url.endsWith('/')?path.join(file,'index.html'):file;res.writeHead(200,{'Content-Type':target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html'}).end(fs.readFileSync(target));}
   else res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);
   return;
  }
  const chunks=[];for await(const p of req)chunks.push(p);assert.equal(req.headers['content-type'],'application/msgpack');const {action,params={}}=decodeWire(Buffer.concat(chunks),'msgpack');writes.push({action,params});let data={};
  if(req.url==='/api/v1/auth/login')return reply('ok',{token:'a'.repeat(32)});
  if(action==='status.get'||action==='config.get')data=status();
  else if(action==='capabilities.get')data={device_id:'aabbccddeeff',model:'daikin',firmware_version:'dev-dirty',variant:'full',actions,business_status:true};
  else if(action==='binding.status.get')data={peers:[],max_sessions:4};
  else if(action==='screen.layout.get')data={revision:scene.readUInt32LE(4),crc:A.crc(scene),total:scene.length,offset:params.offset,bytes:scene.subarray(params.offset,params.offset+params.limit).toString('base64')};
  else if(action==='screen.appearance.get')data={supported:true,revision:appearance.revision,applied_revision:appearance.revision,bytes:Buffer.from(A.encode(appearance)).toString('base64')};
  else if(action==='screen.appearance.set'){const next=A.decode(Buffer.from(params.bytes,'base64'));assert(next.revision>appearance.revision);appearance=next;data={revision:appearance.revision};}
  else if(action==='screen.wallpaper.get'){if(prepareWait&&!--prepareWait)wp={...wp,resource_state:6};data=wpWait-- >0?{...wp,state:'pending'}:wp;}
  else if(action?.startsWith('screen.wallpaper.')){
   if(action.endsWith('.begin')){wpHeader=Buffer.from(params.header,'base64');assert.equal(wpHeader.length,32);staged=Buffer.alloc(204960);wp={request:(wp?.request||0)+1,received:0,crc:0,active:true,resource_state:7};prepareWait=3;}
   else if(action.endsWith('.chunk')){assert.equal(params.offset,wp.received);const p=Buffer.from(params.bytes,'base64');assert(p.length<=512);p.copy(staged,params.offset);wp.received+=p.length;wp.request++;}
   else if(action.endsWith('.commit')){receivedFile=Buffer.concat([wpHeader,staged]);const parsed=A.parseWallpaper(receivedFile);assert.equal(wp.received,204960);wp={...wp,request:wp.request+1,crc:parsed.crc,active:false,resource_state:2};}
   else if(action.endsWith('.cancel'))wp.request++;
   wp={...wp,state:'complete',code:0};wpWait=1;data={request:wp.request};
  }
  return reply('ok',data);
 }catch(e){console.error(e);res.writeHead(500).end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,1280])for(const lang of ['en','zh-CN']){
   appearance=A.defaults();scene=Buffer.from(initial);writes=[];const before=Buffer.from(scene),errors=[],page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url+'/#settings/screen');await page.waitForFunction(()=>document.querySelector('#screenAppearance')?.hidden===false);
   await page.evaluate(lang=>{I18N.set(lang);document.querySelectorAll('#screenEditor details').forEach(el=>el.open=true);},lang);
   await page.locator('#screenLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenLoad').hasAttribute('aria-busy'));await page.waitForSelector('[data-component="1"]');
   const pageCount=await page.locator('#screenPage option').count();
   for(let i=0;i<pageCount;i++){await page.locator('#screenPage').selectOption(String(i));assert.equal(await page.locator('#screenPageEnabled').isChecked(),!!initial[16+36*i],`page ${i+1} enable flag must be preserved`);}
   if(pageCount>=6){await page.locator('#screenPage').selectOption('5');assert.equal(await page.locator('[data-unit-axes="3"]').count(),1);await page.locator('#screenGrid').screenshot({path:path.join(output,`sixth-preview-${width}-${lang}.png`)});}await page.locator('#screenPage').selectOption('0');
   await page.locator('#screenTab_appearance').click();for(const name of A.themes){
    await page.locator(`[data-theme="${name}"]`).click();
    const actual=await page.locator('#screenGrid').evaluate(el=>getComputedStyle(el).backgroundColor),hex=A.palettes[A.themes.indexOf(name)].canvas,expected='rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';assert.equal(actual,expected);
   }
   await page.locator('[data-theme="ocean"]').click();await page.locator('#screenTab_appearance').click();await page.locator('#screenAppearanceSave').click();await page.waitForFunction(()=>document.querySelector('#screenAppearanceState').textContent.match(/^Saved|^已保存/));assert.equal(appearance.theme,'ocean');
   await page.locator('#screenTab_layout').click();await page.locator('#screenEdit').click();await page.locator('[data-component="2"]').click();await page.locator('#screenComponentColors summary').click();
   const colors=['#112233','#223344','#334455','#445566','#556677'];
   for(let i=0;i<colors.length;i++)await page.locator('#screenComponentColors input[type=color]').nth(i).evaluate((el,color)=>{el.value=color;el.dispatchEvent(new Event('change',{bubbles:true}));},colors[i]);
   const computed=await page.locator('[data-component="2"]').evaluate(el=>{const s=getComputedStyle(el);return ['background','title','value','unit','body'].map(k=>s.getPropertyValue('--component-'+k).trim());});assert.deepEqual(computed,colors);
   await page.locator('#screenTab_appearance').click();for(const name of ['aurora','dunes','mountains']){await page.locator('#screenWallpaper').selectOption(name);assert.equal(await page.locator('#screenWallpaper').inputValue(),name);}await page.locator('#screenCardOpacity').evaluate(el=>{el.value='45';el.dispatchEvent(new Event('change',{bubbles:true}));});
   assert.match(await page.locator('[data-component="2"]').evaluate(el=>getComputedStyle(el).backgroundColor),/0\.45\)/);assert.equal(await page.locator('[data-component="2"] .screen-widget-value').evaluate(el=>getComputedStyle(el).opacity),'1');
   await page.locator('#screenTab_layout').click();await page.locator('#screenGrid').screenshot({path:path.join(output,`appearance-${width}-${lang}.png`)});
   await page.locator('#screenTab_appearance').click();await page.locator('#screenAppearanceSave').click();await page.waitForFunction(()=>document.querySelector('#screenAppearanceState').textContent.match(/^Saved|^已保存/));assert.equal(appearance.items[2].value,colors[2]);assert.equal(appearance.cardOpacity,45);
   await page.reload();await page.waitForFunction(()=>document.querySelector('#screenAppearance')?.hidden===false);await page.evaluate(()=>document.querySelectorAll('#screenEditor details').forEach(el=>el.open=true));await page.locator('#screenLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenLoad').hasAttribute('aria-busy'));await page.waitForSelector('[data-component="2"]');
   assert.equal(await page.locator('#screenWallpaper').inputValue(),'mountains');assert.equal(await page.locator('#screenCardOpacity').inputValue(),'45');
   assert.deepEqual(scene,before);assert(!writes.some(w=>w.action==='screen.layout.begin'));
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){console.error(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(e=>({id:e.id,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,scroll:e.scrollWidth})).filter(r=>r.right>innerWidth||r.scroll>r.width+2).slice(0,40)})));await page.screenshot({path:path.join(output,'overflow.png'),fullPage:true});}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();console.log(`PASS appearance Chromium ${width} ${lang}: all themes, five roles, transparent card and opaque text, independent persistence, all page enable flags and no overflow`);
  }
  // A real browser image decode, Pages download, then the exact bytes through the device uploader.
  const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/tools/screen-wallpaper/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=500;const x=c.getContext('2d');x.fillStyle='#34789a';x.fillRect(0,0,320,500);x.fillStyle='#eeaa55';x.fillRect(0,180,320,80);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#file').setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>!document.querySelector('#download').hidden);
  const preview=await page.locator('#preview').boundingBox();assert(Math.abs(preview.width/preview.height-480/854)<.001);const downloaded=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.querySelector('#download').href)).arrayBuffer()))),bytes=Buffer.from(downloaded);assert.equal(bytes.length,204992);A.parseWallpaper(bytes);
  fs.writeFileSync(path.join(output,'converted.bwp'),bytes);cp.execFileSync(process.env.SCREEN_APPEARANCE_CODEC,['wallpaper',path.join(output,'converted.bwp')]);
  await page.locator('#dim').evaluate(el=>{el.value='70';el.dispatchEvent(new Event('input'));});assert.deepEqual(Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.querySelector('#download').href)).arrayBuffer())))),bytes,'Dimming must not alter the image');
  for(const lang of ['en','zh']){await page.locator('#language').selectOption(lang);await page.locator('#preview').screenshot({path:path.join(output,`converter-${lang}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  appearance=A.defaults();wp={request:0,state:'idle',received:0,crc:0};wpWait=0;writes=[];
  await page.goto(url+'/#settings/screen');await page.waitForFunction(()=>document.querySelector('#screenAppearance')?.hidden===false);await page.evaluate(()=>document.querySelectorAll('#screenEditor details').forEach(el=>el.open=true));await page.locator('#screenLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenLoad').hasAttribute('aria-busy'));await page.waitForSelector('[data-component="1"]');
  await page.locator('#screenTab_appearance').click();await page.locator('#screenWallpaperFile').setInputFiles({name:'converted.bwp',mimeType:'application/octet-stream',buffer:bytes});await page.locator('#screenWallpaperUpload').click();await page.waitForFunction(()=>document.querySelector('#screenWallpaper').value==='custom'&&document.querySelector('#screenWallpaperProgress').hidden,null,{timeout:90000});
  assert.deepEqual(receivedFile,bytes);assert.equal(appearance.wallpaper,'custom');assert.equal(appearance.custom_crc,A.parseWallpaper(bytes).crc);assert.equal(writes.filter(w=>w.action==='screen.wallpaper.chunk').length,401);assert.equal(writes.filter(w=>w.action==='screen.wallpaper.commit').length,1);assert.deepEqual(scene,initial);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Pages PNG conversion and exact .bwp CRC, bilingual mobile preview, 401 sequential chunks, asynchronous ACKs, commit and appearance selection');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
