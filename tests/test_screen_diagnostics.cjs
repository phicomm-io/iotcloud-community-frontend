const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function fixture(){
 const html=require('./render_page.cjs')('DAIKIN/web/index.html'),dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local/#settings/screen'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.scrollTo=()=>{};w.setInterval=()=>0;
 w.HTMLCanvasElement.prototype.getContext=()=>({font:'',measureText(text){return {width:text.length*16};}});
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((s,i)=>{if(i===scripts.length-1)w.UI.start=dev=>w.UI.device=dev;vm.runInContext(s,dom.getInternalVMContext());});
 w.I18N.set('zh-CN');let request=0,offset=0,limit=0,waiting=false;const writes=[];
 const page={supported:true,available:true,request:0,state:'idle',current:1,enabled_mask:37,count:6,asleep:true};
 const all=Array.from({length:10},(_,i)=>({index:i,kind:1,last:i===9,area:[0,i*40,479,(i+1)*40-1],at_us:i*20000,duration_us:100,pixels:19200}));
 w.command=async(action,params={})=>{
  writes.push({action,params:JSON.parse(JSON.stringify(params))});
  if(action==='screen.page.get')return {...page};
  if(action==='screen.page.set'){
   page.request++;page.asleep=false;page.state='complete';
   const enabled=[1,3,6],index=enabled.indexOf(page.current);
   page.current=params.page??enabled[(index+(params.direction==='next'?1:2))%3];
   assert(enabled.includes(page.current));return {request:page.request};
  }
  if(action==='screen.diagnostics.start'){waiting=params.mode==='next';request++;offset=limit=0;return {request};}
  if(action==='screen.diagnostics.read'){request++;offset=params.offset||0;limit=params.limit||0;return {request};}
  if(action==='screen.diagnostics.get')return {supported:true,available:true,pending:false,request,reply_request:request,status:0,active:false,waiting,
    generation:7,page:1,elapsed_us:180100,frame_period_us:20000,flush_count:10,flush_total_us:1000,monitor_count:1,monitor_total_ms:180,stored:10,dropped:0,records:all.slice(offset,offset+limit)};
  return {};
 };
 w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:0}});
 const settle=async()=>{for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,10));if(!w.document.querySelector('#screenDiagStart').hasAttribute('aria-busy'))return;}throw Error('UI did not finish');};
 return {w,dom,writes,settle,page,advance:()=>waiting=false};
}
test('display diagnostics is capability gated, pages real regions and reports microsecond gaps',async()=>{
 const {dom,w,writes,settle}=fixture();try{
  const d=w.document,start=d.querySelector('#screenDiagStart');assert(start.disabled);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:524288}});assert(!start.disabled);
  d.querySelector('#screenTab_diagnostics').click();assert(!d.querySelector('#screenPanel_diagnostics').hidden);
  start.click();await settle();
  assert.equal(d.querySelectorAll('#screenDiagRows tr').length,10);
  assert.match(d.querySelector('#screenDiagInfo').textContent,/20.00 ms.*50.0 Hz.*10.*1.00 ms/);
  assert.equal(d.querySelectorAll('#screenDiagRows tr')[1].lastChild.textContent,'19.900');
  assert.deepEqual(writes.filter(x=>x.action==='screen.diagnostics.read'&&x.params.limit).map(x=>x.params),[{offset:0,limit:8},{offset:8,limit:8}]);
  assert(!d.querySelector('#screenDiagExport').disabled);
  w.I18N.set('en');assert.match(d.querySelector('#screenDiagInfo').textContent,/^Scan /);
  w.I18N.set('zh-CN');assert.match(d.querySelector('#screenDiagInfo').textContent,/^扫描 /);
  assert.equal(d.querySelectorAll('.toast').length,0);
 }finally{dom.window.close();}
});
test('remote page controls use MCU acknowledgements, skip disabled pages and preserve a selection during status polling',async()=>{
 const {dom,w,writes,page}=fixture();try{
  const d=w.document,next=d.querySelector('#screenRemoteNext'),select=d.querySelector('#screenRemotePage');assert(next.disabled);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:1048576,page:{...page}}});
  assert(!next.disabled);assert.deepEqual([...select.options].map(o=>o.value),['1','3','6']);
  const click=async id=>{d.querySelector(id).click();for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,10));if(!d.querySelector(id).hasAttribute('aria-busy'))return;}throw Error('Page control did not finish');};
  await click('#screenRemoteNext');assert.equal(page.current,3);assert(!page.asleep);assert.match(d.querySelector('#screenRemotePageInfo').textContent,/第 3 页/);
  await click('#screenRemotePrevious');assert.equal(page.current,1);
  select.value='6';select.dispatchEvent(new w.Event('change'));
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:1048576,page:{...page}}});assert.equal(select.value,'6');
  await click('#screenRemoteGo');assert.equal(page.current,6);
  await click('#screenRemoteNext');assert.equal(page.current,1);
  assert.deepEqual(writes.filter(x=>x.action==='screen.page.set').map(x=>x.params),[{direction:'next'},{direction:'previous'},{page:6},{direction:'next'}]);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:0}});assert(next.disabled);
 }finally{dom.window.close();}
});
test('next page capture waits for the touch without background polling',async()=>{
 const {dom,w,writes,settle,advance}=fixture();try{
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:524288}});
  const d=w.document;d.querySelector('#screenDiagMode').value='next';d.querySelector('#screenDiagStart').click();await settle();
  assert.match(d.querySelector('#screenDiagInfo').textContent,/正面/);
  assert.equal(writes.filter(x=>x.action==='screen.diagnostics.read').length,0);
  advance();d.querySelector('#screenDiagRead').click();
  for(let i=0;i<100&&!d.querySelector('#screenDiagRows tr');i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(d.querySelectorAll('#screenDiagRows tr').length,10);
 }finally{dom.window.close();}
});
