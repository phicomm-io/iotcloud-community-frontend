const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function settle(){for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));}
function crc(text){let c=0xffffffff;for(const x of Buffer.from(text)){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return ((c^0xffffffff)>>>0).toString(16).padStart(8,'0');}
async function setup(supported=true){
 const html=require('./render_page.cjs')('M1/web/index.html'),dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
 let song='',pending='',expected=0,wanted='',failCommit=false,failedChunk=false;const calls=[];
 w.fetch=async(url,opt)=>{const req=JSON.parse(opt.body);calls.push(req);let data={},code='ok',p=req.params;
  if(req.action.startsWith('wake_alarm.'))data={active:false,tone_supported:true,tone_count:4,music_supported:supported};
  if(req.action==='music.get')data={present:!!song,length:song.length,crc32:crc(song),duration_ms:1500};
  if(req.action==='music.begin'){expected=p.length;wanted=p.crc32;pending='';}
  if(req.action==='music.chunk'){
   if(!failedChunk){failedChunk=true;throw Error('transient network loss');}
   assert.equal(p.offset,pending.length);pending+=p.data;
  }
  if(req.action==='music.commit'){assert.equal(pending.length,expected);assert.equal(crc(pending),wanted);if(failCommit)code='storage_error';else song=pending;}
  if(req.action==='music.read')data={data:song.slice(p.offset,p.offset+p.length)};
  return {ok:true,json:async()=>({code,data})};};
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 scripts.forEach((s,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;dev.capabilities({actions:['wake_alarm.start','wake_alarm.get','wake_alarm.stop']});};vm.runInContext(s,dom.getInternalVMContext());});
 w.I18N.set('en');await settle();return {dom,w,calls,get:id=>w.document.getElementById(id),song:()=>song,setFail:v=>failCommit=v};
}
test('M1 RTTTL upload, CRC, bounded chunk retry, readback, play/stop and saved-song capability',async()=>{
 const x=await setup(),{get,w,calls}=x;try{
  assert.equal(get('m1Music').hidden,false);assert.equal(get('m1MusicPlay').disabled,true);
  const song='Test:d=8,o=5,b=120:c,e,g,4c6';get('m1MusicText').value=song;get('m1MusicSave').click();await settle();
  assert.equal(x.song(),song);assert.equal(w.UI.m1MusicPresent,true);assert.equal(get('m1MusicPlay').disabled,false);
  assert.deepEqual(calls.find(c=>c.action==='music.begin').params,{length:song.length,crc32:crc(song)});
  assert.equal(calls.filter(c=>c.action==='music.chunk'&&c.params.offset===0).length,2);
  get('m1MusicText').value='draft';get('m1MusicRead').click();await settle();assert.equal(get('m1MusicText').value,song);
  get('m1MusicPlay').click();await settle();assert.equal(calls.at(-1).action,'music.play');
  get('m1MusicStop').click();await settle();assert.deepEqual(calls.slice(-2).map(x=>x.action),['wake_alarm.stop','music.stop']);
  const before=calls.filter(c=>c.action==='music.begin').length;
  for(const bad of ['', '中文', 'x'.repeat(1025)]){get('m1MusicText').value=bad;get('m1MusicSave').click();await settle();}
  assert.equal(calls.filter(c=>c.action==='music.begin').length,before);
  x.setFail(true);get('m1MusicText').value='New::c';get('m1MusicSave').click();await settle();
  assert.equal(calls.at(-1).action,'music.cancel');assert.equal(x.song(),song);assert.equal(get('m1MusicText').value,'New::c');
 }finally{x.dom.window.close();}
 const old=await setup(false);try{assert.equal(old.get('m1Music').hidden,true);assert.equal(old.calls.some(c=>c.action.startsWith('music.')),false);}finally{old.dom.window.close();}
});
