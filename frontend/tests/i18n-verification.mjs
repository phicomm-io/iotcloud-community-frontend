// Real component regression: language changes update existing records in place.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {JSDOM,VirtualConsole} from 'jsdom';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({
 stdin:{resolveDir:root,contents:`
  import {createApp,nextTick} from 'vue';
  import {setLanguage,t} from './src/i18n.js';
  import Records from './src/components/AdminVerificationEmails.vue';
  window.translate=t;
  window.changeLanguage=async value=>{setLanguage(value);await nextTick();};
  window.mount=()=>{window.app=createApp(Records,{enabled:true});window.app.mount('#app');};
 `},
 bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
 define:{'process.env.NODE_ENV':'"production"','__VUE_OPTIONS_API__':'true','__VUE_PROD_DEVTOOLS__':'false','__VUE_PROD_HYDRATION_MISMATCH_DETAILS__':'false'},
 plugins:[{name:'test-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{
  const {descriptor}=parse(await readFile(path,'utf8'),{filename:path});
  return {contents:compileScript(descriptor,{id:path,inlineTemplate:true}).content,loader:'js',resolveDir:dirname(path)};
 });}}],
});
const bundle=result.outputFiles[0].text,flush=()=>new Promise(done=>setImmediate(done));
const text=node=>node.textContent.replace(/\s+/g,' ').trim();

test('verification status, metrics and known details follow immediate language changes',async()=>{
 const errors=[],requests=[],virtualConsole=new VirtualConsole();
 virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://fixture.local',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window;w.Response=Response;
 w.fetch=async(url,options)=>{
  requests.push({url,options});
  return new Response(JSON.stringify({
   total:3,server_time:Math.floor(Date.now()/1000),
   summary:{sent_emails:1,registered_emails:0,unregistered_emails:1,expired_unregistered_emails:0,failed_attempts:2},
   records:[
    {id:1,email:'failed@example.com',status:'failed',detail:'The mail server could not send the message. Check the SMTP logs.',detail_key:'verification.delivery_failed'},
    {id:2,email:'unknown@example.com',status:'unknown',detail:'发送过程可能被中断，无法确认邮件服务器是否接受；请重新获取验证码'},
    {id:3,email:'custom@example.com',status:'registration_failed',detail:'Administrator-provided detail',detail_key:'future.unknown'},
   ],
  }),{headers:{'Content-Type':'application/json'}});
 };
 try{
  vm.runInContext(bundle,dom.getInternalVMContext());await w.changeLanguage('en');w.mount();await flush();await flush();
  const status=()=>[...w.document.querySelectorAll('.verification-status')].map(text);
  const details=()=>[...w.document.querySelectorAll('.verification-list li>p')].map(text);
  const metric=()=>text(w.document.querySelector('.verification-metrics span'));
  assert.equal(status()[0],w.translate('p.ac77953a1e06'));
  assert.equal(details()[0],w.translate('verification.delivery_failed'));
  assert.equal(details()[1],w.translate('verification.interrupted'));
  assert.equal(details()[2],'Administrator-provided detail');
  const englishStatus=status()[0],englishMetric=metric();
  await w.changeLanguage('zh-CN');
  assert.notEqual(status()[0],englishStatus);assert.notEqual(metric(),englishMetric);
  assert.equal(status()[0],w.translate('p.ac77953a1e06'));
  assert.equal(details()[0],w.translate('verification.delivery_failed'));
  assert.equal(details()[1],w.translate('verification.interrupted'));
  assert.equal(details()[2],'Administrator-provided detail');
  assert.equal(requests.length,1,'switching language must not resend the administrator query');
  assert.equal(requests[0].options.headers['Accept-Language'],'en');assert.deepEqual(errors,[]);
 }finally{w.app?.unmount();dom.window.close();}
});
