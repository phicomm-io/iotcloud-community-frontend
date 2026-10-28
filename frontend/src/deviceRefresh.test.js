import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const ui=readFileSync(new URL('../../common/web/ui.js',import.meta.url),'utf8');
const route=ui.slice(ui.indexOf('let routeGeneration=0;'),ui.indexOf('/* Wi-Fi scan is shared:'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const dom=new JSDOM('<div id="homePage"></div><div id="settingsPage"></div><div id="side"></div>'+['linkage','binding','light'].map(key=>'<div data-settings-page="'+key+'"><input value="old"></div>').join(''));
 const {document}=dom.window,reads=[],UI={device:{groups:[['settings',['linkage','binding','light']]]},reload:async()=>{},pages:{}};
 for(const key of ['linkage','binding','light'])UI.pages[key]={show:options=>new Promise(resolve=>reads.push({key,options,resolve:()=>{if(options.current())document.querySelector('[data-settings-page="'+key+'"] input').value='server';resolve();}}))};
 const c=vm.createContext({UI,document,location:dom.window.location,AbortController,$:id=>document.getElementById(id),t:key=>key});vm.runInContext(route+'\nglobalThis.go=showRoute;',c);
 const go=async key=>{UI.embeddedRoute='settings/'+key;c.go();await flush();};return {dom,document,reads,go};
}
test('started page reads retire on three switches and old completion cannot overwrite revisit',async()=>{
 const f=fixture();try{
 await f.go('linkage');await f.go('binding');await f.go('linkage');
 assert.equal(f.reads.length,3);assert.equal(f.reads[0].options.signal.aborted,true);assert.equal(f.reads[1].options.signal.aborted,true);assert.equal(f.reads[2].options.signal.aborted,false);
 f.reads[0].resolve();f.reads[1].resolve();await flush();assert.equal(f.document.querySelector('[data-settings-page="linkage"] input').value,'old');
 f.reads[2].resolve();await flush();assert.equal(f.document.querySelector('[data-settings-page="linkage"] input').value,'server');
 }finally{f.dom.window.close();}
});
test('edits during pending refresh and existing drafts survive leave/revisit; successful save clears only unchanged draft',async()=>{
 const f=fixture();try{
 await f.go('linkage');const input=f.document.querySelector('[data-settings-page="linkage"] input');input.value='draft';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));f.reads[0].resolve();await flush();assert.equal(input.value,'draft');
 await f.go('binding');await f.go('linkage');assert.equal(f.reads.length,2);assert.equal(input.value,'draft');
 const save=ui.slice(ui.indexOf('function saveDraft('),ui.indexOf('function onSubmit('));const saveDraft=new Function(save+'return saveDraft;')();const box=input.parentElement;
 await assert.rejects(saveDraft(box,async()=>{throw Error('busy');})());assert.equal(box.dataset.dirty,'1');
 let finish;const saving=saveDraft(box,()=>new Promise(resolve=>{finish=resolve;}))();
 input.value='newer';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));finish();await saving;assert.equal(box.dataset.dirty,'1','new edit during save remains dirty');
 await saveDraft(box,async()=>{})();assert.equal(box.dataset.dirty,undefined);
 await f.go('linkage');assert.equal(f.reads.length,3);f.reads[2].resolve();await flush();assert.equal(input.value,'server');
 }finally{f.dom.window.close();}
});
test('capture tracking preserves segmented and metric edits that synchronously redraw their DOM',async()=>{
 const f=fixture();try{
 await f.go('linkage');const box=f.document.querySelector('[data-settings-page="linkage"]');
 const redraw=()=>box.replaceChildren(f.document.createElement('input'));
 const seg=f.document.createElement('div');seg.className='seg';const button=f.document.createElement('button');seg.append(button);box.append(seg);button.onclick=redraw;
 button.click();assert.equal(box.dataset.dirty,'1');assert.equal(box.dataset.editVersion,'1');f.reads[0].resolve();await flush();assert.equal(box.querySelector('input').value,'');
 delete box.dataset.dirty;const metric=box.querySelector('input');metric.type='checkbox';metric.onchange=redraw;metric.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
 assert.equal(box.dataset.dirty,'1');assert.equal(box.dataset.editVersion,'2');await f.go('binding');await f.go('linkage');assert.equal(f.reads.length,2);
 }finally{f.dom.window.close();}
});
test('hidden rings never accelerate status refresh; visible ramp/light retains previous cadence',()=>{
 const a1=readFileSync(new URL('../../A1/web/page.js',import.meta.url),'utf8');const source=a1.slice(a1.indexOf('function updateRingAnimation(){'),a1.indexOf('function effectLabel('));let callback,reads=0,homeHidden=true,lightHidden=true,hidden=false;
 const context=vm.createContext({clearInterval(){},setInterval(fn){callback=fn;},ringAnimationTimer:null,UI:{state:{applied_speed:10,percentage:20},reload(){reads++;return Promise.resolve();}},document:{get hidden(){return hidden;},querySelector:()=>({get hidden(){return lightHidden;}})},$:()=>({get hidden(){return homeHidden;}}),ringPolling:false,ringPolledAt:0,performance:{now:()=>1000},advanced:{effect:0},previewTarget:null,renderRing(){}});
 vm.runInContext(source+'updateRingAnimation();',context);callback();assert.equal(reads,0);homeHidden=false;callback();assert.equal(reads,1);context.ringPolling=false;homeHidden=true;lightHidden=false;hidden=true;callback();assert.equal(reads,1);
});
