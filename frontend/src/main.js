import { createApp } from 'vue'
import Root from './Root.vue'
import router from './router.js'
import {hubMode} from './deployment';
import {track} from './analytics'
router.afterEach((to,from,failure)=>{if(!failure)track('pageview',to.path);});
import './style.css'



import {loadServer} from './serverConfig';
import {registerWebApp} from './webapp';
import {registerInstallPrompt} from './installApp';
async function start(){
 registerInstallPrompt();
 if(import.meta.env.VITE_LOCAL_ONLY!=='1')await loadServer();
 if(!hubMode)registerWebApp();
 if(import.meta.env.VITE_DEMO === '1') await import('./demo.js');
 const app=createApp(Root).use(router);
 await router.isReady();
 app.mount('#app');
}
start();
