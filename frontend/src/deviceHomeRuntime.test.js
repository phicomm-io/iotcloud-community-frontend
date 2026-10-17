import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

test('automatic settings opens immediately, reports read errors and supports retry',async()=>{
 const dom=new JSDOM('<body><main id="homePage"><a id="autoSettings" href="#settings/linkage">自动调速</a></main><main id="settingsPage" hidden><section data-settings-page="linkage"></section></main></body>',{url:'https://platform.test',runScripts:'outside-only'});
 const w=dom.window;let reject,resolve,reads=0;
 try{
  w.ResizeObserver=class{observe(){}};
  w.I18N={set(){},apply(){}};w.command=()=>new Promise(()=>{});w.UI={};
  w.eval(readFileSync(new URL('./deviceHomeRuntime.js',import.meta.url),'utf8'));
  w.UI.start({model:'A1',pages:{linkage:{show:()=>{reads++;return new Promise((yes,no)=>{resolve=yes;reject=no;});}}}});
  const page=w.document.querySelector('[data-settings-page="linkage"]');
  w.document.querySelector('#autoSettings').click();
  assert.equal(page.hidden,false);assert.equal(w.document.querySelector('#homePage').hidden,true);
  assert.match(page.textContent,/正在读取/);
  w.document.querySelector('#autoSettings').click();assert.equal(reads,1,'duplicate clicks share the pending read');
  reject(Error('MQTT 已断开'));await new Promise(setImmediate);
  assert.equal(page.querySelector('[role=alert]').textContent,'MQTT 已断开');
  page.querySelector('button').click();assert.equal(reads,2);assert.match(page.textContent,/正在读取/);
  page.textContent='设置表单';resolve();await new Promise(setImmediate);
  w.document.querySelector('body > button').click();assert.equal(w.document.querySelector('#homePage').hidden,false);
 }finally{w.close();}
});
