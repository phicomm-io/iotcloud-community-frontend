export function registerWebApp(){
 if(import.meta.env.VITE_DEMO==='1'||!import.meta.env.PROD||!('serviceWorker' in navigator))return;
 let refreshing=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)location.reload();});
 navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{scope:import.meta.env.BASE_URL}).then(registration=>{
  const offer=()=>{if(registration.waiting&&navigator.serviceWorker.controller&&confirm('IotCloud 有新版本，是否现在更新？更新会重新连接 MQTT。')){refreshing=true;registration.waiting.postMessage('ACTIVATE');}};
  offer();
  registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')offer();});});
  window.addEventListener('online',()=>registration.update());
 }).catch(()=>{});
}
