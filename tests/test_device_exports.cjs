const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const trim=require('../tools/trim_device_exports.cjs');
const header='<script>(()=>{function keep(){return 7;}function unused(){return 9;}const UI=window.UI={keep,unused,state:null};})();</script>';
test('native product references retain destructured and literal helpers without unrelated exports',()=>{
 const html=header+'<script>const {keep}=UI;window.value=keep();UI.state=2;</script>',result=trim(html);
 assert.deepEqual(result.removed,['unused']);const context={};context.window=context;vm.runInNewContext([...result.html.matchAll(/<script>(.*?)<\/script>/gs)].map(m=>m[1]).join('\n'),context);assert.equal(context.window.value,7);assert.equal(context.window.UI.state,2);
 assert.deepEqual(trim(header+'<script>UI["unused"]();</script>').removed,['keep']);
 assert.deepEqual(trim(header+'<script>globalThis.UI?.unused();</script>').removed,['keep']);
});
test('unknown aliases, computed references, destructuring rest and unrecognized tables keep exports',()=>{
 for(const use of ['const alias=UI;alias.unused();','UI[window.key]();','const {...all}=UI;','consume(UI);','const ui=window["UI"];','eval("UI.unused()");'])assert.equal(trim(header+'<script>'+use+'</script>').html,header+'<script>'+use+'</script>');
 assert.equal(trim('<p>no table</p>').html,'<p>no table</p>');
 for(const suffix of ['<script src="external.js"></script>','<button onclick="UI.unused()"></button>'])assert.equal(trim(header+suffix).html,header+suffix);
});
test('embedded export specialization is explicit; cloud minifier keeps common export sharing',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('frontend/vite.config.js','utf8');assert.match(source,/minifyDevice\(html\)/);assert.doesNotMatch(source,/trimDeviceExports/);
 const page=fs.readFileSync('common/web/page.py','utf8');assert.match(page,/--trim-device-exports/);
});
