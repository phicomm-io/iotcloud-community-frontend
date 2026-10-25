const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('common/web/demo.js','utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

test('demo defaults follow language changes while user names and stable IDs survive',()=>{
 const context={window:{},structuredClone,performance};vm.runInNewContext(source,context);
 const demo=context.window.PhicommDemo,device=demo.create('tc1'),id=device.state.device_id;
 assert.equal(device.state.name,'Demo device');assert.equal(device.state.socket_names[0],'Desk lamp');
 demo.setLanguage('zh-CN');assert.equal(device.state.name,'演示设备');assert.equal(device.state.socket_names[0],'台灯');
 device.command('config.set',{section:'device',values:{name:'用户名字'}});
 device.command('config.set',{section:'outlets',values:{names:['用户插座',...device.state.socket_names.slice(1)]}});
 demo.setLanguage('en');
 assert.equal(device.state.name,'用户名字');assert.equal(device.state.socket_names[0],'用户插座');assert.equal(device.state.socket_names[1],'Monitor');
 assert.equal(device.state.version,'Demo');assert.equal(device.state.device_id,id);
 assert.deepEqual(plain(device.state.socket_states),[true,true,false,true,false,false]);
 device.command('ota.check',{source:'github'});assert.equal(device.command('ota.check.get').version,'Demo');
});

test('standalone demo banner uses the page i18n and refreshes translated defaults',async()=>{
 const dom=new JSDOM('<!doctype html><div></div>',{url:'http://demo.local',runScripts:'outside-only'}),w=dom.window;
 try{
  w.structuredClone=structuredClone;w.localStorage.setItem('phicomm.language','en');
  vm.runInContext(source.replace('__MODEL__','tc1'),dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('common/web/i18n.js','utf8'),dom.getInternalVMContext());
  let refreshes=0;w.UI={reload:()=>refreshes++};await new Promise(done=>setImmediate(done));
  const banner=w.document.querySelector('[data-i18n="demo.deviceBanner"]');assert.ok(banner.textContent.includes('Interactive demo'));
  const command=async(action,params={})=>(await(await w.fetch('/api/v1/command',{body:JSON.stringify({action,params})})).json()).data;
  assert.equal((await command('status.get')).name,'Demo device');w.I18N.set('zh-CN');
  assert.ok(banner.textContent.includes('交互演示'));assert.equal((await command('status.get')).name,'演示设备');assert.equal(refreshes,1);
  await command('config.set',{section:'device',values:{name:'My device'}});w.I18N.set('en');assert.equal((await command('status.get')).name,'My device');
 }finally{dom.window.close();}
});
