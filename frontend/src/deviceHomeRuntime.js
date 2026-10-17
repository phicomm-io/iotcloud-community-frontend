// Reuse product home renderers and the A1 automatic-control form.
(()=>{
 let dev,stopped=false,ready=false,loading=null,failures=0,lastSuccess=0;
 const disabled=new Map();
 function lock(){for(const el of document.querySelectorAll('#homePage button,#homePage input,#homePage select')){if(!disabled.has(el))disabled.set(el,el.disabled);el.disabled=true;}}
 function unlock(){for(const [el,value] of disabled)el.disabled=value;disabled.clear();}
 const feedback=document.createElement('p');feedback.className='banner info';feedback.setAttribute('role','status');feedback.textContent='正在获取设备状态…';document.body.prepend(feedback);
 async function load(){
  try{
   if(dev.model==='A1'&&!UI.caps)UI.caps=await command('capabilities.get');
   const raw=await command('status.get');failures=0;lastSuccess=Date.now();unlock();const s=UI.acceptStatus(raw);dev.onStatus?.(s);ready=true;feedback.hidden=true;return raw;
  }catch(e){failures++;if(ready&&(failures<3||Date.now()-lastSuccess<30000))return null;lock();feedback.hidden=false;feedback.className='banner warn';feedback.textContent=ready?'暂时无法更新，正在重试。当前显示上次状态。':e.message;if(!ready)document.querySelectorAll('#homePage .tile').forEach((tile,i)=>{tile.querySelector('.name').textContent=I18N.t('tc1.socket_n',{n:i+1});tile.querySelector('.state').textContent='等待设备状态';});}
 }
 function pollLoad(){if(!loading)loading=load().finally(()=>{loading=null;});return loading;}
 UI.reload=async()=>{if(loading)await loading;return pollLoad();};
 UI.start=options=>{document.querySelectorAll('[data-settings-page]').forEach(page=>page.hidden=true);dev=options;UI.device=options;UI.pages=options.pages||{};I18N.set('zh-CN');queueMicrotask(()=>{I18N.apply();lock();(async function poll(){await pollLoad();if(!stopped)setTimeout(poll,3000);})();});};
 let opening=false;
 const back=document.createElement('button');back.type='button';back.className='btn';back.hidden=true;back.textContent='返回设备控制';back.style.marginBottom='16px';document.querySelector('#settingsPage').before(back);
 back.onclick=()=>{document.body.classList.remove('automatic-settings');document.querySelector('#settingsPage').hidden=true;document.querySelector('#homePage').hidden=false;document.querySelector('[data-settings-page="linkage"]').hidden=true;back.hidden=true;};
 async function openAutomatic(){
  if(opening)return;opening=true;
  const page=document.querySelector('[data-settings-page="linkage"]');
  document.body.classList.add('automatic-settings');document.querySelector('#settingsPage').hidden=false;document.querySelector('#homePage').hidden=true;page.hidden=false;back.hidden=false;
  const loading=document.createElement('p');loading.className='banner info';loading.setAttribute('role','status');loading.textContent='正在读取自动调速设置…';page.replaceChildren(loading);
  try{await dev.pages.linkage.show();}
  catch(e){const message=document.createElement('p');message.className='banner warn';message.setAttribute('role','alert');message.textContent=e.message||'读取设置失败';const retry=document.createElement('button');retry.className='btn';retry.textContent='重试';retry.onclick=openAutomatic;page.replaceChildren(message,retry);}
  finally{opening=false;}
 }
 document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#settings/"]');if(!link)return;event.preventDefault();
  if(dev.model==='A1'&&link.getAttribute('href')==='#settings/linkage'){
   openAutomatic();
  }else UI.toast('此项请在设备本地 WebUI 中设置');
 });
 window.addEventListener('pagehide',()=>stopped=true);
 const style=document.createElement('style');style.textContent='body{max-width:none;margin:0;padding:0 0 8px}body:not(.automatic-settings) #settingsPage{display:none!important}body.automatic-settings #settingsPage{display:block}#settingsPage>.side{display:none}.banner{margin-top:0}@media(max-width:600px){.grid{grid-template-columns:minmax(0,1fr)}.metric .stat{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:4px}.metric .stat small{margin-left:0}}';document.head.append(style);
 new ResizeObserver(()=>{parent.postMessage({type:'device-height',height:Math.ceil(document.body.getBoundingClientRect().height)+8},parent.location.origin);}).observe(document.body);
})();
