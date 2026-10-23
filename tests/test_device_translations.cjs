const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {packTranslations}=require('../tools/minify_device.cjs');
test('compact locale table preserves exact values and all dynamic key families',()=>{
 const html=`<div data-i18n="common.html"></div><script>const D={'common.html':['A|B','中文'],'dynamic.one':['one','一'],'dynamic.two':['two','二'],'helper.label':['label','标签'],'other.unused':['unused','不用']};globalThis.dictionary=D;</script><script>const key='dynamic.'+suffix;helper('helper.label');</script>`;
 const packed=packTranslations(html),context={};vm.runInNewContext(packed.match(/<script>(.*?)<\/script>/s)[1],context);
 const d=JSON.parse(JSON.stringify(context.dictionary));
 assert.deepEqual(d,{'common.html':['A|B','中文'],'dynamic.one':['one','一'],'dynamic.two':['two','二'],'helper.label':['label','标签']});
 assert.equal(packTranslations('<script>const value=1;</script>'),'<script>const value=1;</script>');
});
