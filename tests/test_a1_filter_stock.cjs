const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');const flush=()=>new Promise(r=>setImmediate(r));
async function idle(){for(let i=0;i<8;i++)await flush();}
function setup(model,actions){
 const html=require('./render_page.cjs')(model+'/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.confirm=()=>false;
 const calls=[];let fail=false;let filter={model:'runtime',remaining_percent:85,time_remaining_percent:85,weighted_remaining_percent:75,air_volume_m3_estimate:123.456,used_seconds:100,lifetime_hours:4320};
 w.fetch=async(url,opt)=>{const req=opt?.body?JSON.parse(opt.body):{};calls.push(req);let data={};
  if(req.action==='filter.model.set'&&!fail)filter={...filter,model:req.params.weighted?'weighted_estimate':'runtime'};
  if(req.action?.startsWith('filter.'))data=filter;
  if(req.action==='mcu.version.get')data={version_received:false,buzzer_requested:false};
  return {ok:true,json:async()=>({code:fail?'storage_error':'ok',data})};};
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((s,i)=>{if(i===scripts.length-1){w.UI.start=d=>{w.UI.device=d;w.UI.caps={actions};d.capabilities?.(w.UI.caps);};w.UI.reload=async()=>{};}vm.runInContext(s,dom.getInternalVMContext());});
 const $=id=>w.document.getElementById(id),render=s=>{w.UI.state=s;w.UI.device.onStatus(s);};
 const submit=id=>$(id).dispatchEvent(new w.Event('submit',{cancelable:true}));
 return {dom,w,$,render,submit,calls,filter,setFail:v=>{fail=v;}};
}
test('A1 weighted filter estimates, draft preservation, failed model writes and OTA lock',async()=>{
 const x=setup('A1',['filter.model.set']);const {w,$,render,submit,calls,filter}=x;
 try{await idle();const state={filter,red:0,green:0,blue:255,brightness:255,requested_speed:20,percentage:20,applied_speed:0,fan_on:false,fan_feedback_ready:true,fan_feedback_frequency_millihz:12345,fan_feedback_pulses:123,fan_feedback_level:true};
 render(state);assert.equal($('filterEstimates').hidden,false);assert.match($('filterEstimateValues').textContent,/75%/);
 $('filterModel').value='weighted_estimate';$('filterModel').dispatchEvent(new w.Event('change'));render(state);assert.equal($('filterModel').value,'weighted_estimate');
 $('filterLifetime').value='6000';$('filterLifetime').dispatchEvent(new w.Event('input'));
 submit('filterModelForm');await idle();assert.equal($('filterLifetime').value,'6000','saving model preserves lifetime draft');assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c.action==='filter.model.set').params)),{weighted:true});assert.equal(w.UI.state.filter.model,'weighted_estimate');
 $('filterModel').value='runtime';$('filterModel').dispatchEvent(new w.Event('change'));x.setFail(true);submit('filterModelForm');await idle();assert.equal(w.UI.state.filter.model,'weighted_estimate');assert.equal($('filterModel').value,'runtime');x.setFail(false);
 render({...w.UI.state,ota_active:true});assert.equal($("filterModel").disabled,true);assert.equal($("filterReset").disabled,true);
 }finally{x.dom.window.close();}
});
test('older A1 filter firmware hides estimates and model controls',async()=>{
 const x=setup('A1',[]);try{await idle();x.render({filter:{remaining_percent:80,used_seconds:100,lifetime_hours:4320},brightness:255,red:0,green:0,blue:255});assert.equal(x.$('filterEstimates').hidden,true);assert.equal(x.$('filterModelForm').hidden,true);}finally{x.dom.window.close();}
});
