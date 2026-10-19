import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
test('embedded runtime keeps the complete shared UI initialization',async()=>{
 const dom=new JSDOM('<body><header class="topbar"></header></body>',{url:'https://platform.test',runScripts:'outside-only'});
 try{const w=dom.window;let received;w.ResizeObserver=class{observe(){}};w.I18N={set(){}};w.UI={start:async dev=>{received=dev;}};
 w.eval(readFileSync(new URL('./deviceHomeRuntime.js',import.meta.url),'utf8'));const dev={model:'A1'};await w.UI.start(dev);assert.equal(received,dev);assert.equal(w.UI.embedded,true);assert.equal(w.document.querySelector('.topbar').hidden,true);
 }finally{dom.window.close();}
});
