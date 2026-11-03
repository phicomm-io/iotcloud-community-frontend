const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const minify=require('../tools/minify_device.cjs'),{packTranslations}=minify;
const root=path.resolve(__dirname,'..');
function evaluate(html){
 const context={};context.window=context;
 for(const [,source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInNewContext(source,context);
 return JSON.parse(JSON.stringify({dictionary:context.dictionary,business:context.business}));
}
test('compact locale table preserves exact values and all dynamic key families',()=>{
 const html=`<div data-i18n="common.html"></div><script>const D={'common.html':['A|B','中文'],'dynamic.one':['one','一'],'dynamic.two':['two','二'],'helper.label':['label','标签'],'other.unused':['unused','不用']};globalThis.dictionary=D;</script><script>const key='dynamic.'+suffix;helper('helper.label');</script>`;
 const packed=packTranslations(html),context={};vm.runInNewContext(packed.match(/<script>(.*?)<\/script>/s)[1],context);
 const d=JSON.parse(JSON.stringify(context.dictionary));
 assert.deepEqual(d,{'common.html':['A|B','中文'],'dynamic.one':['one','一'],'dynamic.two':['two','二'],'helper.label':['label','标签']});
 assert.equal(packTranslations('<script>const value=1;</script>'),'<script>const value=1;</script>');
});

const businessObjects={
 empty:'{}',
 scalar:"{'keep.label':'value'}",
 numeric:"{'keep.label':['value',1]}",
 short:"{'keep.label':['value']}",
 long:"{'keep.label':['value','值','extra']}",
 hole:"{'keep.label':['value',,]}",
 nested:"{'keep.label':{en:'value',zh:'值'}}",
 spread:"{...{'keep.label':['value','值']}}",
 computed:"{['keep.label']:['value','值']}",
 method:"{'keep.label'(){return 'value';}}"
};
for(const [name,object] of Object.entries(businessObjects)){
 test(`unrelated ${name} D object remains business data in either script order`,async()=>{
  const business=`<script>const D=${object};window.business=D;</script>`;
  assert.equal(packTranslations(business),business,'no translation table exists');
  assert.deepEqual(evaluate(await minify(business)),evaluate(business),'minification must not create a translation table from business data');
  const dictionary=`<script>(()=>{const D={'keep.label':['Keep','保留'],'unused.label':['Unused','不用']};window.dictionary=D;})();</script>`;
  for(const html of [dictionary+business,business+dictionary]){
   const expected={dictionary:name==='empty'?{}:{'keep.label':['Keep','保留']},business:evaluate(business).business};
   assert.deepEqual(evaluate(packTranslations(html)),expected,'packing only replaces the translation dictionary');
   assert.deepEqual(evaluate(await minify(html)),expected,'the complete minifier keeps the original dictionary script identity');
  }
 });
}

test('a malformed table is not partially packed and multiple tables are rejected',()=>{
 const malformed="<script>const D={'keep.label':['Keep','保留'],'invalid':['value',1]};</script>";
 assert.equal(packTranslations(malformed),malformed);
 const dictionary="<script>(()=>{const D={'keep.label':['Keep','保留']};})();</script>";
 assert.throws(()=>packTranslations(dictionary+dictionary),/Multiple translation tables/);
});

test('an empty business registry keeps its initialization and update side effects',async()=>{
 const html="<script>(()=>{const D={'unused.label':['Unused','不用']};window.dictionary=D;})();</script><script>const D={};const events=[Object.keys(D).length];D.sensor={value:10};D.sensor.value=20;events.push(Object.keys(D).length,D.sensor.value);window.business=events;</script>";
 const expected={dictionary:{},business:[0,1,20]};
 assert.deepEqual(evaluate(packTranslations(html)),expected);
 assert.deepEqual(evaluate(await minify(html)),expected);
});

function translations(source){
 const context={document:{documentElement:{}},navigator:{languages:['en']},localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:()=>{}};
 context.window=context;vm.runInNewContext(source,context);
 const i18n=context.I18N;
 return Object.fromEntries(i18n.keys().map(key=>{
  i18n.lang='en';const en=i18n.t(key);i18n.lang='zh-CN';return [key,[en,i18n.t(key)]];
 }));
}

test('actual minified M1 preserves translations and renders refreshed sensor tiles',async()=>{
 const shared=translations(fs.readFileSync(path.join(root,'common/web/i18n.js'),'utf8'));
 const html=cp.execFileSync('python3',['common/web/page.py','M1/web/index.html','--minify'],{cwd:root,encoding:'utf8'});
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(([,source])=>/window\.I18N\s*=/.test(source));
 assert.ok(script,'the public I18N API remains available');
 const packed=translations(script[1]);
 assert.ok(Object.keys(packed).length<Object.keys(shared).length,'M1 keeps only referenced translation families');
 assert.equal(Object.hasOwn(packed,''),false,'no phantom key from an empty business object');
 for(const key of ['m.pm25','m.formaldehyde','m.temperature','m.humidity'])assert.ok(Object.hasOwn(packed,key),key);
 for(const [key,value] of Object.entries(packed))assert.deepEqual(value,shared[key],key);
 const {JSDOM}=require('../frontend/node_modules/jsdom');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.deviceParentTransport=true;w.setTimeout=()=>0;w.scrollTo=()=>{};
  w.fetch=async(url,options)=>{throw Error('unexpected tile request: '+url+' '+options?.body);};
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([,source])=>source);
  scripts.forEach((source,index)=>{
   if(index===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;w.UI.reload=async()=>w.UI.state;};
   vm.runInContext(source,dom.getInternalVMContext());
  });
  w.UI.caps={actions:[]};
  const metrics=['pm25','formaldehyde','temperature','humidity'];
  for(const [values,expected] of [[[19,.02,25,50],['19','0.020','25.0','50']],[[0,.123,-5,0],['0','0.123','-5.0','0']]]){
   w.UI.acceptStatus({sensor_received:true,sensor_valid:true,age_ms:100,...Object.fromEntries(metrics.map((key,i)=>[key,values[i]]))});
   w.UI.device.onStatus(w.UI.state);
   assert.deepEqual(metrics.map(key=>w.document.querySelector(`[data-sensor="${key}"] .num`).textContent),expected,'every sensor tile refreshes independently');
  }
  for(const language of ['en','zh-CN']){
   w.I18N.lang=language;w.I18N.apply();
   assert.deepEqual(metrics.map(key=>w.document.querySelector(`[data-sensor="${key}"] .label`).textContent),metrics.map(key=>shared['m.'+key][language==='en'?0:1]));
  }
  await new Promise(resolve=>setImmediate(resolve));
 }finally{w.close();}
});
