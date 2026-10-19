// Embedded pages use the complete shared settings initialization and product UI.
(()=>{
 UI.embedded=true;UI.embeddedRoute='home';
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(!link)return;
  const route=link.getAttribute('href').slice(1);
  if(route!=='home'&&!/^settings\/[a-z]+$/.test(route))return;
  event.preventDefault();UI.embeddedRoute=route;UI.showRoute();
 });
 const start=UI.start;
 UI.start=async dev=>{
  I18N.set('zh-CN');
  await start(dev);
  const header=document.querySelector('.topbar');if(header)header.hidden=true;
 };
 window.addEventListener('storage',event=>{
  if(event.key!=='phicomm.appearance')return;
  if(event.newValue==='system'||!event.newValue)delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme=event.newValue;
 });
 const style=document.createElement('style');style.textContent='body{max-width:none;margin:0;padding:0 0 8px}.banner{margin-top:0}@media(max-width:600px){.grid{grid-template-columns:minmax(0,1fr)}.metric .stat{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:4px}.metric .stat small{margin-left:0}}';document.head.append(style);
 new ResizeObserver(()=>parent.postMessage({type:'device-height',height:Math.ceil(document.body.getBoundingClientRect().height)+8},parent.location.origin)).observe(document.body);
})();
