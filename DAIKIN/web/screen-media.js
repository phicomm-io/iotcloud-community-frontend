/* Included in the screen editor owner; uses the shared authenticated service. */
const mediaState=h('p',{class:'help',id:'screenPushState',role:'status'}),mediaProgress=h('progress',{max:1,value:0,hidden:true,id:'screenPushProgress'});
const pushTitle=input('','text',{id:'screenPushTitle',maxLength:64}),pushText=h('textarea',{id:'screenPushText',maxLength:512}),pushFile=input('','file',{id:'screenPushFile',accept:'image/png,image/jpeg,image/webp'});
const pushWidth=input(320,'number',{id:'screenPushWidth',min:1,max:480}),pushHeight=input(240,'number',{id:'screenPushHeight',min:1,max:854}),pushMode=select([['timed','screen.push_timed'],['confirm','screen.push_confirm']],'timed'),pushSeconds=input(10,'number',{id:'screenPushSeconds',min:1,max:3600}),pushWake=input('','checkbox',{id:'screenPushWake',checked:true});
pushMode.id='screenPushMode';
const pushUrl=input('','url',{id:'screenPushUrl',placeholder:'http://camera/image.jpg'}),pushUser=input('','text',{id:'screenPushUser',autocomplete:'off'}),pushPassword=input('','password',{id:'screenPushPassword',autocomplete:'new-password'}),pushFps=input(1,'number',{id:'screenPushFps',min:1,max:10}),pushTls=input('','checkbox',{id:'screenPushTls',checked:true});
const pushSource=h('details',{id:'screenPushSource'},h('summary',{i18n:'screen.push_source'}),h('p',{class:'help',i18n:'screen.push_source_help'}),fieldRow('screen.push_source_url',pushUrl),fieldRow('screen.camera_user',pushUser),fieldRow('screen.push_source_password',pushPassword),fieldRow('screen.camera_fps',pushFps),fieldRow('screen.camera_tls',pushTls));
const pushView=select(Array.from({length:5},(_,i)=>[i,i?'screen.push_view_'+i:'screen.push_view_0']),0);pushView.id='screenPushView';
const pushId=input('','number',{id:'screenPushId',min:1,max:4294967295,placeholder:'1…4294967295'});
const pushQueue=select([],0);pushQueue.id='screenPushQueue';
const pushClear=input('','checkbox',{id:'screenPushClear'});
const pushTtl=input('','number',{id:'screenPushTtl',min:0,max:86400,placeholder:'0…86400'}),pushOverflow=select([['reject','screen.push_overflow_reject'],['drop_newest','screen.push_overflow_drop_newest'],['drop_oldest','screen.push_overflow_drop_oldest']],'reject');pushOverflow.id='screenPushOverflow';
let pushPolicySupported=false;
pushQueue.addEventListener('change',()=>{if(pushQueue.value)pushId.value=pushQueue.value;});
let lastPushId=0;
async function mediaOperation(action,params={}){
 const receipt=await command(action,params),until=Date.now()+10000;
 if(!receipt.request)throw Error(t('screen.media_unconfirmed'));
 while(Date.now()<until){const state=await command('screen.media.get'),request=state.request||{};
  if(request.sequence!==receipt.request)throw Error(t('screen.changed'));
  if(request.state==='complete'&&request.result===0)return state;
  if(['rejected','uncertain'].includes(request.state))throw Error(t('screen.media_failed',{code:request.result}));
  await pause(100);
 }throw Error(t('screen.media_unconfirmed'));
}
async function preparePushImage(file,w,h){
 if(!file||file.size>5*1024*1024||!num(w)||!num(h)||w<1||w>480||h<1||h>854)throw Error(t('screen.invalid'));
 const source=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d');context.fillStyle='#000';context.fillRect(0,0,w,h);
  const scale=Math.min(w/source.width,h/source.height);context.drawImage(source,(w-source.width*scale)/2,(h-source.height*scale)/2,source.width*scale,source.height*scale);
  for(const quality of [.85,.7,.55,.4,.25]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=131072)return new Uint8Array(await blob.arrayBuffer());}
  throw Error(t('screen.media_too_large'));
 }finally{source.close();}
}
async function sendPush(update=false){
 const entered=pushId.value.trim(),id=entered?Number(entered):(crypto.getRandomValues(new Uint32Array(1))[0]||1),file=pushFile.files?.[0],url=pushUrl.value.trim(),w=Number(pushWidth.value),h=Number(pushHeight.value),duration=Number(pushSeconds.value)*1000;
 if(!num(id)||id<1||id>4294967295||(update&&!entered)||(pushClear.checked&&(file||url)))throw Error(t('screen.invalid'));
 if(encoder.encode(pushTitle.value).length>64||encoder.encode(pushText.value).length>512||(!update&&!file&&!url&&!pushTitle.value&&!pushText.value)||(file&&url)||(url&&(!num(w)||!num(h)||w<1||w>480||h<1||h>854||!num(Number(pushFps.value))||Number(pushFps.value)<1||Number(pushFps.value)>10))||!num(duration)||duration<1000||duration>3600000)throw Error(t('screen.invalid'));
 let imageId=0;
 try{
  if(file){const bytes=await preparePushImage(file,w,h);imageId=update?(crypto.getRandomValues(new Uint32Array(1))[0]||1):id;mediaProgress.hidden=false;mediaProgress.max=bytes.length;
   await mediaOperation('screen.media.begin',{id:imageId,total:bytes.length,crc32:crc(bytes),width:w,height:h});
   for(let offset=0;offset<bytes.length;offset+=512){await mediaOperation('screen.media.chunk',{id:imageId,offset,bytes:b64(bytes.slice(offset,offset+512))});mediaProgress.value=Math.min(offset+512,bytes.length);}
   await mediaOperation('screen.media.commit',{id:imageId});
  }
  if(pushTtl.value!==''&&(!num(Number(pushTtl.value))||Number(pushTtl.value)<0||Number(pushTtl.value)>86400))throw Error(t('screen.invalid'));
  const params={id,title:pushTitle.value,text:pushText.value,mode:pushMode.value,duration_ms:duration,wake:pushWake.checked};
  if(pushPolicySupported){if(pushTtl.value!=='')params.ttl_ms=Number(pushTtl.value)*1000;if(!update)params.overflow=pushOverflow.value;}
  if(imageId||!update&&!url||pushClear.checked)params.image_id=imageId;
  if(url)Object.assign(params,{url,username:pushUser.value,...(pushPassword.value||!update?{password:pushPassword.value}:{}),width:w,height:h,fps:Number(pushFps.value),verify_tls:pushTls.checked});
  const state=await mediaOperation(update?'screen.push.update':'screen.push.send',params);
  pushPassword.value='';lastPushId=update?id:(state.last_push_id||id);pushId.value=String(lastPushId);pushClear.checked=false;await refreshPush();
 }catch(error){if(imageId)try{await mediaOperation('screen.media.cancel',{id:imageId});}catch{}throw error;}
 finally{mediaProgress.hidden=true;}
}
async function refreshPush(){
 const state=await command('screen.push.get');pushView.value=state.view_index||0;
 const selected=pushId.value;
 pushQueue.replaceChildren(h('option',{value:'',i18n:'screen.push_choose'}),...(state.queue||[]).map(m=>h('option',{value:m.id},m.id+' · '+t('screen.push_state_'+m.state))));
 pushQueue.value=selected;
 document.querySelector('#screenPushUpdate').disabled=state.update_supported!==true;
 pushPolicySupported=state.policy_supported===true;pushTtl.disabled=pushOverflow.disabled=!pushPolicySupported;
 mediaState.textContent=t('screen.push_capacity',{count:state.queued||0,total:state.queue_capacity||0,images:state.image_capacity||0})+' · '+(state.messages||[]).map(m=>m.id+' · '+t('screen.push_state_'+m.state)).join(' / ');
}
const pushSection=section('screen.external_push',h('p',{class:'help',i18n:'screen.push_help'}),
 fieldRow('screen.push_id',pushId),fieldRow('screen.push_queue',pushQueue),h('p',{class:'help',i18n:'screen.push_update_help'}),
 fieldRow('screen.title',pushTitle),fieldRow('screen.text',pushText),fieldRow('screen.push_file',pushFile),pushSource,
 fieldRow('screen.push_clear_media',pushClear),
 h('div',{class:'row'},fieldRow('screen.media_width',pushWidth),fieldRow('screen.media_height',pushHeight)),
 fieldRow('screen.push_mode',pushMode),fieldRow('screen.push_seconds',pushSeconds),fieldRow('screen.push_wake',pushWake),
 fieldRow('screen.push_ttl',pushTtl),h('p',{class:'help',i18n:'screen.push_ttl_help'}),fieldRow('screen.push_overflow',pushOverflow),
 h('div',{class:'row'},button('screen.push',()=>sendPush(false),{id:'screenPushSend'}),
 button('screen.push_update',()=>sendPush(true),{id:'screenPushUpdate',disabled:true}),
 button('screen.media_refresh',refreshPush,{id:'screenPushRefresh'}),
 button('screen.push_dismiss',async()=>{const id=Number(pushId.value);if(!num(id)||id<1||id>4294967295)throw Error(t('screen.invalid'));await mediaOperation('screen.push.dismiss',{id});await refreshPush();},{id:'screenPushDismiss'})),
 fieldRow('screen.push_view',pushView),button('screen.push_show',async()=>{await mediaOperation('screen.push.select',{index:Number(pushView.value)});await refreshPush();},{id:'screenPushShow'}),mediaProgress,mediaState);pushSection.id='screenExternalPush';
const cameraUrl=input('','url',{id:'screenCameraUrl',placeholder:'http://camera/mjpeg?width={width}&height={height}'}),cameraUser=input('','text',{id:'screenCameraUser',autocomplete:'off'}),cameraPassword=input('','password',{id:'screenCameraPassword',autocomplete:'new-password'}),cameraWidth=input(320,'number',{id:'screenCameraWidth',min:1,max:480}),cameraHeight=input(240,'number',{id:'screenCameraHeight',min:1,max:854}),cameraFps=input(1,'number',{id:'screenCameraFps',min:1,max:10}),cameraTls=input('','checkbox',{id:'screenCameraTls',checked:true}),cameraState=h('p',{class:'help',id:'screenCameraState',role:'status'});
async function cameraRefresh(load=false){const d=await command('screen.stream.get');if(load){cameraUrl.value=d.url||'';cameraUser.value=d.username||'';cameraPassword.value='';cameraWidth.value=d.width;cameraHeight.value=d.height;cameraFps.value=d.fps;cameraTls.checked=d.verify_tls;}
 cameraState.textContent=t('screen.camera_status',{state:t('screen.camera_'+d.state),frames:d.frames||0,width:d.actual_width||0,height:d.actual_height||0,fps:((d.actual_millifps||0)/1000).toFixed(1),error:d.error||0});}
function addCameraPage(){
 if(!scene||scene.pages.length>=8||!(lastStatus?.capabilities&8388608))throw Error(t('screen.media_upgrade'));
 change(()=>{page=scene.pages.length;scene.pages.push({id:Math.max(...scene.pages.map(p=>p.id))+1,enabled:true,title:t('screen.type.image')});const item={id:Math.max(0,...scene.items.map(i=>i.id))+1,page,type:8,binding:6,x:0,y:0,w:4,h:6,source:0,title:t('screen.type.image'),unit:'',hide_title:1,image_source:0,image_fit:0};scene.items.push(item);selected=item;editing=true;});showScreenTab('layout');
}
const cameraSection=section('screen.camera',h('p',{class:'help',i18n:'screen.camera_help'}),fieldRow('screen.camera_url',cameraUrl),fieldRow('screen.camera_user',cameraUser),fieldRow('screen.camera_password',cameraPassword),h('div',{class:'row'},fieldRow('screen.media_width',cameraWidth),fieldRow('screen.media_height',cameraHeight),fieldRow('screen.camera_fps',cameraFps)),fieldRow('screen.camera_tls',cameraTls),h('div',{class:'row'},button('screen.load',()=>cameraRefresh(true),{id:'screenCameraLoad'}),button('common.save',async()=>{const params={url:cameraUrl.value,username:cameraUser.value,width:Number(cameraWidth.value),height:Number(cameraHeight.value),fps:Number(cameraFps.value),verify_tls:cameraTls.checked,enabled:true};if(cameraPassword.value)params.password=cameraPassword.value;await mediaOperation('screen.stream.set',params);cameraPassword.value='';await cameraRefresh();},{id:'screenCameraSave'}),button('screen.camera_start',async()=>{await mediaOperation('screen.stream.start');await cameraRefresh();},{id:'screenCameraStart'}),button('screen.camera_stop',async()=>{await mediaOperation('screen.stream.stop');await cameraRefresh();},{id:'screenCameraStop'}),button('screen.refresh',()=>cameraRefresh(),{id:'screenCameraRefresh'}),button('screen.camera_add_page',addCameraPage,{id:'screenCameraAddPage'})),cameraState);cameraSection.id='screenCamera';
const linkMode=select([['fixed','screen.link_fixed'],['auto','screen.link_auto']],'fixed'),linkRate=select([115200,230400,460800,921600].map(n=>[n,'screen.rate_'+n]),115200),linkMaximum=select([115200,230400,460800,921600].map(n=>[n,'screen.rate_'+n]),921600),linkApply=input('','checkbox',{id:'screenLinkApply'}),linkState=h('p',{class:'help',id:'screenLinkState',role:'status'});
linkMode.id='screenLinkMode';linkRate.id='screenLinkRate';linkMaximum.id='screenLinkMaximum';
async function linkRefresh(load=false){const d=await command('screen.link.get');if(load){linkMode.value=d.mode;linkRate.value=d.rate;linkMaximum.value=d.max_rate;}linkState.textContent=t('screen.link_status',{rate:d.actual_rate,state:d.state,errors:d.crc_errors,fallbacks:d.fallbacks});}
const linkSection=section('screen.link',h('p',{class:'help',i18n:'screen.link_help'}),fieldRow('screen.link_mode',linkMode),fieldRow('screen.link_rate',linkRate),fieldRow('screen.link_maximum',linkMaximum),fieldRow('screen.link_apply',linkApply),h('div',{class:'row'},button('screen.load',()=>linkRefresh(true),{id:'screenLinkLoad'}),button('common.save',async()=>{await command('screen.link.set',{mode:linkMode.value,rate:Number(linkRate.value),max_rate:Number(linkMaximum.value),apply_now:linkApply.checked});await linkRefresh();},{id:'screenLinkSave'})),linkState);linkSection.id='screenLink';
