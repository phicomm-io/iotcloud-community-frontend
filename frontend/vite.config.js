import { defineConfig } from "vite";
import {createHash} from 'node:crypto';
import vue from "@vitejs/plugin-vue";
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {hubDevicePages} from './deviceAssets.js';

// Render the same source fragments as common/web/page.py; never fork device UI.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const hubMode=process.env.VITE_HUB==='1';
const minifyDevice = createRequire(import.meta.url)(resolve(root,'tools/minify_device.cjs'));
const products = {tc1:'TC1/http_server/web/index.html',a1:'A1/web/index.html',m1:'M1/web/index.html',daikin:'DAIKIN/web/index.html'};
function devicePages() {
 return {name:'device-pages', resolveId(id){if(id==='virtual:device-pages')return '\0device-pages';},
 async load(id){if(id!=='\0device-pages')return;
 const pages=Object.fromEntries(await Promise.all(Object.entries(products).map(async ([model,path])=>{
  const file=resolve(root,path);this.addWatchFile(file);
  let html=readFileSync(file,'utf8').replace(/\/\* @include ([\w.-]+) \*\//g,(_,name)=>{
   const shared=resolve(root,'common/web',name);this.addWatchFile(existsSync(shared)?shared:resolve(dirname(file),name));
   const content=readFileSync(existsSync(shared)?shared:resolve(dirname(file),name),'utf8');
   if(name==='page.js'){const runtime=resolve(here,'src/deviceHomeRuntime.js');this.addWatchFile(runtime);return readFileSync(runtime,'utf8')+'\n'+content;}
   return content;
  });
  if(html.includes('@include'))throw Error('Unresolved device include: '+path);
  this.addWatchFile(resolve(here,'src/deviceBridge.js'));
  const bridge=readFileSync(resolve(here,'src/deviceBridge.js'),'utf8');
  const appearance=readFileSync(resolve(root,'common/web/appearance.js'),'utf8');
  html=html.replace('</head>','<script>'+appearance+'</script></head>');
  html=html.replace('<script>async function command(', '<script>'+bridge+'</script><script>async function command(');
  return [model,await minifyDevice(html)];
 })));
 // Device pages share complete scripts and styles. Keep one copy of each
 // fragment in the bundle, then reconstruct the original HTML for srcdoc.
 const fragments=[], ids=new Map();
 const packed=Object.fromEntries(Object.entries(pages).map(([model,html])=>{
  const parts=html.split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>)/gi);
  return [model,parts.map(part=>{
   if(!ids.has(part)){ids.set(part,fragments.length);fragments.push(part);}
   return ids.get(part);
  })];
 }));
 return 'const fragments='+JSON.stringify(fragments)+';export default Object.fromEntries(Object.entries('+JSON.stringify(packed)+').map(([model,parts])=>[model,parts.map(id=>fragments[id]).join(\"\")]));';
 }};
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  resolve: {alias:hubMode?[{find:/^mqtt$/,replacement:resolve(here,'src/hubMqtt.js')}]:[]},
  esbuild: hubMode?{legalComments:'inline'}:undefined,
  plugins: [vue(), ...(hubMode?[
    {...hubDevicePages({sourceRoot:root,appRoot:here}),apply:'build'},
    {...devicePages(),apply:'serve'},
  ]:[devicePages()]), webApp()],
  server: {
    port: 3000,
    proxy: {
      "/mqtt": {
        target: process.env.MQTT_TARGET || "ws://localhost:9001",
        ws: true,
      },
      "/api": {
        target: process.env.API_TARGET || "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
});

function webApp(){return {name:'iotcloud-webapp',generateBundle(_,bundle){
 const files=['./','index.html','manifest.webmanifest','icons/iotcloud.svg','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png',...Object.keys(bundle).filter(name=>!name.endsWith('.map')&&name!=='standalone-daikin.html')];
 const version=createHash('sha256').update(JSON.stringify(files)+Object.values(bundle).map(item=>item.code||item.source||'').join('')).digest('hex').slice(0,16);
 this.emitFile({type:'asset',fileName:'sw.js',source:`
const CACHE='iotcloud-${version}';
const FILES=${JSON.stringify(files)};
const urls=FILES.map(file=>new URL(file,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(urls))));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('iotcloud-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request;
 const url=new URL(request.url);url.hash='';
 if(request.method!=='GET'||!urls.includes(url.href))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('index.html',self.registration.scope).href))));return;
 }
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.href))||fetch(request)));
});
`});
}};}
