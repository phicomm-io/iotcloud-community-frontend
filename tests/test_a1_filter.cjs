const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('A1 filter rendering, lifetime edit, reset confirmation and failed writes',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  let confirm=false,fail=false;w.confirm=()=>confirm;
  const writes=[];let f={used_seconds:4320*3600*.95,lifetime_hours:4320,remaining_percent:5,replacement_due:true};
  w.fetch=async(url,options)=>{
   const req=JSON.parse(options.body);let code='ok',data={};
   if(req.action.startsWith('filter.')){
    if(req.action!=='filter.get')writes.push(req);
    if(fail)code='storage_error';
    else if(req.action==='filter.reset')f={...f,used_seconds:0,remaining_percent:100,replacement_due:false};
    else if(req.action==='filter.set')f={...f,lifetime_hours:req.params.lifetime_hours};
    data={...f};
   }
   return {ok:true,json:async()=>({code,data})};
  };
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{
   if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{};}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  await flush();
  const status={filter:f,red:0,green:0,blue:255,brightness:255,requested_speed:60,percentage:60,applied_speed:60,fan_on:true};w.UI.state=status;
  const render=()=>w.UI.device.onStatus(w.UI.state);
  render();assert.equal(w.document.getElementById('filterCard').hidden,false);
  assert.equal(w.document.getElementById('filterRemaining').textContent,'5%');
  assert.equal(w.document.getElementById('filterProgress').getAttribute('aria-valuenow'),'5');
  assert.match(w.document.getElementById('filterBadge').className,/warn/);
  const input=w.document.getElementById('filterLifetime');input.value=6000;input.dispatchEvent(new w.Event('input'));
  render();assert.equal(input.value,'6000','polling preserves edits');
  w.document.getElementById('filterForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
  for(let i=0;i<5;i++)await flush();
  assert.equal(writes.at(-1).action,'filter.set');assert.equal(writes.at(-1).params.lifetime_hours,6000);
  assert.equal(w.UI.state.filter.used_seconds,4320*3600*.95);
  const reset=w.document.getElementById('filterReset');reset.click();await flush();
  assert.equal(writes.length,1,'cancel does not reset');
  confirm=true;fail=true;reset.click();for(let i=0;i<5;i++)await flush();
  assert.equal(w.document.getElementById('filterRemaining').textContent,'5%','failed reset preserves usage');
  fail=false;reset.click();for(let i=0;i<5;i++)await flush();
  assert.equal(w.document.getElementById('filterRemaining').textContent,'100%');
  assert.equal(w.UI.state.filter.used_seconds,0);
  w.UI.state.ota_active=true;render();assert.equal(reset.disabled,true);
  delete w.UI.state.filter;render();assert.equal(w.document.getElementById('filterCard').hidden,true,'older firmware remains compatible');
 }finally{dom.window.close();}
});
