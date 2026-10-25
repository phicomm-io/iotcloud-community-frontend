// Compile the real Vue components and exercise their DOM and protocol events.
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
  import {createApp,h,reactive,nextTick} from 'vue';
  import {createRouter,createMemoryHistory} from 'vue-router';
  import {setLanguage,t} from './src/i18n.js';
  import {account} from './src/account.js';
  import TaskEditor from './src/components/TaskEditor.vue';
  import MqttConfig from './src/components/MqttConfig.vue';
  import DeviceSummary from './src/components/DeviceSummary.vue';
  import DeviceControl from './src/components/DeviceControl.vue';
  import CommunityControl from './src/components/CommunityControl.vue';
  import NodeSelector from './src/components/NodeSelector.vue';
  import LanguageSelect from './src/components/LanguageSelect.vue';
  import AdminPage from './src/views/AdminPage.vue';
  const components={TaskEditor,MqttConfig,DeviceSummary,DeviceControl,CommunityControl,NodeSelector,LanguageSelect,AdminPage};
  window.translate=t;
  window.changeLanguage=async value=>{setLanguage(value);await nextTick();};
  window.mount=async(name,props={})=>{
   window.events=[];Object.assign(account,{username:'owner',isAdmin:true,loaded:true});
   const values=reactive(props),app=createApp({render:()=>h(components[name],{...values,onSave:data=>window.events.push({type:'save',data}),onConnect:data=>window.events.push({type:'connect',data}),onSendCmd:data=>window.events.push({type:'command',data})})});
   const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]});
   app.use(router);await router.push('/');app.mount('#app');window.currentApp=app;await nextTick();
   window.updateProps=async next=>{Object.assign(values,next);await nextTick();};
  };
  window.loadDemo=()=>import('./src/demo.js');
 `},
 bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
 define:{'process.env.NODE_ENV':'"production"','__VUE_OPTIONS_API__':'true','__VUE_PROD_DEVTOOLS__':'false','__VUE_PROD_HYDRATION_MISMATCH_DETAILS__':'false'},
 plugins:[{name:'test-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{
  const {descriptor}=parse(await readFile(path,'utf8'),{filename:path});
  return {contents:compileScript(descriptor,{id:path,inlineTemplate:true}).content,loader:'js',resolveDir:dirname(path)};
 });}}],
});
const bundle=result.outputFiles[0].text,flush=()=>new Promise(done=>setImmediate(done));
async function fixture(language,name,props={}){
 const errors=[],requests=[],dialogs=[],virtualConsole=new VirtualConsole();
 virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://fixture.local',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window;w.Response=Response;w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.confirm=text=>{dialogs.push(text);return true;};
 w.fetch=async(url,options={})=>{
  const path=new URL(url,w.location.href).pathname;requests.push({path,...options});
  let data={};
  if(path==='/api/admin/users')data=[{username:'member',status:'active',role:'user'},{username:'manager',status:'active',role:'admin'}];
  else if(path==='/api/admin/devices')data=[];
  else if(path==='/api/admin/config')data={register_level:0,contact_info:''};
  else if(path==='/api/admin/analytics')data=Object.fromEntries(['pageviews','visitors','visits','active','events'].map(key=>[key,0]).concat(['models','registered_models','pages','referrers','browsers','systems','screens','actions','trend'].map(key=>[key,[]])));
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 vm.runInContext(bundle,dom.getInternalVMContext());await w.changeLanguage(language);
 if(name)await w.mount(name,props);await flush();await flush();
 return {w,document:w.document,requests,dialogs,errors,close(){w.currentApp?.unmount();dom.window.close();}};
}
const text=node=>node.textContent.replace(/\s+/g,' ').trim();
const plain=value=>JSON.parse(JSON.stringify(value));

for(const language of ['en','zh-CN']){
 const zh=language==='zh-CN';
 test(`task editor and MQTT controls use ${language} without changing emitted settings`,async()=>{
  const f=await fixture(language,'TaskEditor',{task:null,index:1});
  try{
   assert.equal(text(f.document.querySelector('.empty-task')),zh?'任务 2（未启用）':'Task 2 (disabled)');
   f.document.querySelector('.task-summary').click();await flush();
   assert.equal(text(f.document.querySelector('.options label')).split(/\s+/)[0],zh?'动作:':'Action:');
   assert.equal(f.document.querySelectorAll('.options label')[1].firstChild.textContent.trim(),zh?'启用:':'Enabled:');
   f.document.querySelector('.save-btn').click();await flush();
   assert.deepEqual(plain(f.w.events),[{type:'save',data:{hour:12,minute:0,repeat:0,action:1,on:1}}]);
   f.w.currentApp.unmount();f.document.querySelector('#app').replaceChildren();await f.w.mount('MqttConfig');
   assert.equal(text(f.document.querySelector('h3')),f.w.translate('p.6ec5731ad8b8')+' '+f.w.translate('p.3d52574ce150'));
   assert.equal(f.document.querySelector('input[type=password]').placeholder,f.w.translate('p.2deb75f492ce'));
   f.document.querySelector('.primary-btn').click();await flush();
   assert.equal(f.w.events[0].type,'connect');assert.equal(f.w.events[0].data.host,'ws://localhost:8083/mqtt');
   assert.match(f.w.events[0].data.clientId,/^web_client_/);assert.deepEqual(f.errors,[]);
  }finally{f.close();}
 });
 test(`TC1 labels and accessible socket states use ${language}; command IDs remain stable`,async()=>{
  const f=await fixture(language,'DeviceSummary',{device:{model:'tc1'},state:{socket_states:[true,false],power:1},name:'TC1',connected:true,now:Date.now()});
  try{
   assert.equal(f.document.querySelector('.sockets').getAttribute('aria-label'),Array.from({length:6},(_,i)=>f.w.translate('p.adb6a3f989a5',{v0:i+1,v1:f.w.translate(i===0?'state.on':i===1?'state.off':'state.unknown')})).join('; '));
   f.w.currentApp.unmount();f.document.querySelector('#app').replaceChildren();
   await f.w.mount('DeviceControl',{device:{model:'tc1',version:'v2',mac:'aabbccddeeff',socket_0:1}});
   assert.equal(text(f.document.querySelector('.switch-btn')),zh?'开启':'On');
   assert.equal(text(f.document.querySelector('.toggle-chip')),f.w.translate('p.f836b418cd28'));
   assert.ok(!text(f.document.querySelector('.stat-controls')).includes('总开关 总开关'));
   f.document.querySelector('.switch-btn').click();await flush();
   assert.deepEqual(plain(f.w.events.at(-1)),{type:'command',data:{mac:'aabbccddeeff',payload:'set socket aabbccddeeff 0 0'}});assert.deepEqual(f.errors,[]);
  }finally{f.close();}
 });
 test(`community ON/OFF display and administrator confirmations use ${language}`,async()=>{
  const f=await fixture(language,'CommunityControl',{device:{model:'a1',mac:'aabbccddeeff',available:true,fan:'ON',fan_percentage:60,light:{state:'OFF'},child_lock:'ON'},connected:true});
  try{
   assert.ok(text(f.document.querySelector('.a1-module')).includes(f.w.translate('state.on')));
   assert.equal(text(f.document.querySelector('.extra-control small')),f.w.translate('state.on'));
   assert.equal(text(f.document.querySelectorAll('.extra-control small')[1]),f.w.translate('state.unknown'));
   f.document.querySelector('.a1-module button').click();await flush();
   assert.deepEqual(plain(f.w.events.at(-1)),{type:'command',data:{mac:'aabbccddeeff',leaf:'fan/set',value:'OFF'}});
   f.w.currentApp.unmount();f.document.querySelector('#app').replaceChildren();await f.w.mount('AdminPage');await flush();await flush();
   const roles=f.document.querySelectorAll('.admin-list li .admin-actions button:first-child');assert.equal(roles.length,2);
   roles[0].click();await flush();await flush();roles[1].click();await flush();await flush();
   assert.deepEqual(f.dialogs,[f.w.translate('admin.grantConfirm',{username:'member'}),f.w.translate('admin.revokeConfirm',{username:'manager'})]);
   assert.deepEqual(f.requests.filter(request=>request.path.endsWith('/role')).map(request=>JSON.parse(request.body)),[{role:'admin'},{role:'user'}]);assert.deepEqual(f.errors,[]);
  }finally{f.close();}
 });
}

test('language selector and cached node names update immediately when the language changes',async()=>{
 const f=await fixture('en','NodeSelector');
 try{
  assert.equal(text(f.document.querySelector('option[value=china]')),f.w.translate('p.fefdd0fd8715'));
  const english=text(f.document.querySelector('option[value=china]'));await f.w.changeLanguage('zh-CN');
  assert.notEqual(text(f.document.querySelector('option[value=china]')),english);
  assert.equal(text(f.document.querySelector('option[value=china]')),f.w.translate('p.fefdd0fd8715'));
  f.w.currentApp.unmount();f.document.querySelector('#app').replaceChildren();await f.w.mount('LanguageSelect');
  assert.equal(f.document.querySelector('select').getAttribute('aria-label'),'语言');
  const select=f.document.querySelector('select');select.value='en';select.dispatchEvent(new f.w.Event('change'));await flush();
  assert.equal(select.getAttribute('aria-label'),'Language');assert.equal(f.w.localStorage.getItem('phicomm.language'),'en');assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});

test('platform demo banner follows the selected language and retains its destination',async()=>{
 const f=await fixture('en');
 try{
  await f.w.loadDemo();await flush();const link=f.document.querySelector('a');
  assert.equal(text(link),f.w.translate('demo.openPlatform'));assert.equal(link.href,'https://phicomm-io.github.io/iotcloud/');
  const english=text(link.parentElement);await f.w.changeLanguage('zh-CN');
  assert.notEqual(text(link.parentElement),english);assert.ok(text(link.parentElement).includes(f.w.translate('demo.banner')));
  assert.equal(text(link),f.w.translate('demo.openPlatform'));assert.deepEqual(f.errors,[]);
 }finally{f.close();}
});
