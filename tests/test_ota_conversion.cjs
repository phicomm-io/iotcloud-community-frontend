const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const html=require('./render_page.cjs')('DAIKIN/web/index.html');
async function fixture(capability='full-to-hub',password=true){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://192.168.1.115/#settings/firmware'}),w=dom.window,d=w.document,uploads=[],confirmations=[],missing=[];
 const state={model:'daikin',device_id:'aabbccddeeff',name:'D',version:'1.0.0',firmware_variant:'full',web_password_set:password,sensors:{}};
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=w.setInterval=()=>0;
 w.console.warn=(...args)=>{if(args[0]==='i18n missing')missing.push(args[1]);};
 const choice={confirm:true};w.confirm=text=>{confirmations.push(text);return choice.confirm;};
 w.fetch=async(url,options)=>{
  assert.equal(url,'/api/v1/command');const {action}=JSON.parse(options.body);
  const data=action==='capabilities.get'?{model:'daikin',actions:[],...(capability==null?{}:{ota_variant_conversion:capability})}:action==='status.get'||action==='config.get'?state:{};
  return {ok:true,status:200,json:async()=>({code:action.endsWith('.get')?'ok':'accepted',data})};
 };
 w.XMLHttpRequest=class{
  constructor(){this.upload={};this.headers={};}
  open(method,path){this.method=method;this.path=path;}
  setRequestHeader(name,value){this.headers[name]=value;}
  send(file){this.file=file;uploads.push(this);this.status=202;this.responseText='accepted';this.onload();this.onloadend();}
 };
 require('./legacy_device_fixture.cjs')(w);
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],dom.getInternalVMContext());
 for(let i=0;i<12;i++)await flush();w.I18N.set('en');
 const selectFile=name=>Object.defineProperty(d.querySelector('#firmware'),'files',{value:[new w.File(['signed envelope'],name)],configurable:true});
 const selectConversion=checked=>{const box=d.querySelector('#hubConversion');box.checked=checked;box.dispatchEvent(new w.Event('change'));};
 const submit=()=>d.querySelector('#fileForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 return {dom,w,d,state,uploads,confirmations,choice,missing,selectFile,selectConversion,submit};
}
test('hub conversion is offered only for the exact declared capability',async()=>{
 for(const capability of [null,'hub-to-full','unknown']){
  const f=await fixture(capability);try{assert.equal(f.d.querySelector('#hubConversion'),null);assert.deepEqual(f.missing,[]);}finally{f.dom.window.close();}
 }
 const f=await fixture();try{assert(f.d.querySelector('#hubConversion'));assert.match(f.d.querySelector('#hubConversion').closest('label').textContent,/Switch to hub firmware/);f.w.I18N.set('zh-CN');assert.match(f.d.querySelector('#hubConversion').closest('label').textContent,/切换为中枢版本/);assert.deepEqual(f.missing,[]);}finally{f.dom.window.close();}
});
test('conversion requires a signed file and confirmation; ordinary and unsigned uploads keep their routes',async()=>{
 const f=await fixture();try{
  f.selectFile('firmware.bin');f.submit();assert.equal(f.uploads.at(-1).path,'/api/v1/ota/upload');
  f.d.querySelector('#unsignedRescue').checked=true;f.submit();assert.equal(f.uploads.at(-1).path,'/api/v1/ota/upload-unsigned');
  for(const upload of f.uploads)assert.equal(Object.keys(upload.headers).some(k=>k.startsWith('X-IoTCloud-')),false);
  f.selectConversion(true);assert.equal(f.d.querySelector('#unsignedRescue').checked,false);assert.equal(f.d.querySelector('#unsignedRescue').disabled,true);assert.equal(f.d.querySelector('#firmware').accept,'.signed');
  const before=f.uploads.length;f.submit();assert.equal(f.uploads.length,before,'raw filename cannot start conversion');
  f.selectFile('hub.ota.bin.signed');f.d.querySelector('#unsignedRescue').checked=true;f.submit();assert.equal(f.uploads.length,before,'unsigned rescue cannot start conversion');f.d.querySelector('#unsignedRescue').checked=false;
  f.choice.confirm=false;f.submit();assert.equal(f.uploads.length,before,'cancel does not upload');
  assert.match(f.confirmations.at(-1),/Wi-Fi, MQTT and the web password will be kept/);assert.match(f.confirmations.at(-1),/local HTTP/);
  f.choice.confirm=true;f.submit();assert.equal(f.uploads.length,before+1);assert.equal(f.uploads.at(-1).path,'/api/v1/ota/convert');
  assert.deepEqual(f.uploads.at(-1).headers,{Accept:'application/json','Content-Type':'application/octet-stream','X-IoTCloud-Target-Variant':'hub','X-IoTCloud-Confirm':'full-to-hub'});
  f.selectConversion(false);assert.equal(f.d.querySelector('#unsignedRescue').disabled,false);assert.equal(f.d.querySelector('#firmware').accept,'.bin,.raw,.signed');assert.deepEqual(f.missing,[]);
 }finally{f.dom.window.close();}
});
test('unset web password permits signed conversion with explicit confirmation',async()=>{
 const f=await fixture('full-to-hub',false);try{
  f.selectConversion(true);f.selectFile('hub.ota.bin.signed');assert.equal(f.d.querySelector('#hubConversionPassword'),null);
  f.choice.confirm=false;f.submit();assert.equal(f.uploads.length,0);assert.equal(f.confirmations.length,1);
  f.choice.confirm=true;f.submit();assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].path,'/api/v1/ota/convert');
  assert.deepEqual(f.uploads[0].headers,{Accept:'application/json','Content-Type':'application/octet-stream','X-IoTCloud-Target-Variant':'hub','X-IoTCloud-Confirm':'full-to-hub'});assert.deepEqual(f.missing,[]);
 }finally{f.dom.window.close();}
});
