import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';

const products={tc1:'TC1/http_server/web/index.html',a1:'A1/web/index.html',m1:'M1/web/index.html',daikin:'DAIKIN/web/index.html','s30-v1b':'S30/web/index.html'};
const i18nScript=/<script data-device-part="i18n.js">([\s\S]*?)<\/script>/;

// Only hub builds use external resources. The ordinary device and cloud pages
// stay self contained; every resource here is also stored on the hub itself.
export async function buildDeviceAssets({sourceRoot,appRoot,watch=()=>{}}){
 const require=createRequire(import.meta.url);
 const minifyDevice=require(resolve(sourceRoot,'tools/minify_device.cjs'));
 const authBundle=require(resolve(sourceRoot,'tools/bundle_auth.cjs'))();
 const read=file=>{watch(file);return readFileSync(file,'utf8');};
 const pages=Object.fromEntries(Object.entries(products).map(([model,path])=>{
  const file=resolve(sourceRoot,path);
  let html=read(file).replace(/<script>\s*\/\* @include ([\w.-]+) \*\/\s*<\/script>/g,(_,name)=>'<script data-device-part="'+name+'">/* @include '+name+' */</script>');
  html=html.replace(/\/\* @include ([\w.-]+) \*\//g,(_,name)=>{
   const shared=resolve(sourceRoot,'common/web',name);
   return read(existsSync(shared)?shared:resolve(dirname(file),name));
  });
  if(html.includes('@include'))throw Error('Unresolved device include: '+path);
  return [model,html.replace('</head>','<script>'+read(resolve(sourceRoot,'common/web/appearance.js'))+'</script></head>')];
 }));
 // A single dictionary covers the actual references in every product. This
 // retains dynamic key families while making their i18n script identical.
 const dictionary=pages.daikin.match(i18nScript)?.[1];
 if(!dictionary)throw Error('Device translation script missing');
 for(const [model,html] of Object.entries(pages)){
  if(html.match(i18nScript)?.[1]!==dictionary)throw Error('Conflicting device translation dictionary: '+model);
 }
 const references=Object.values(pages).map(html=>html.replace(i18nScript,'')).join('');
 const packed=minifyDevice.packTranslations('<script>'+dictionary+'</script>'+references).match(/^<script>([\s\S]*?)<\/script>/)?.[1];
 if(!packed)throw Error('Device translation packing failed');
 const assets=new Map();
 const resource=(content,extension)=>{
  const fileName='device-assets/'+createHash('sha256').update(content).digest('hex').slice(0,20)+'.'+extension;
  assets.set(fileName,content);
  return '/iotcloud/'+fileName;
 };
 const script=content=>'<script src="'+resource(content,'js')+'"></script>';
 const bridge=script((await minifyDevice('<script>'+read(resolve(appRoot,'src/deviceBridge.js'))+'</script>')).slice(8,-9));
 const runtime=script((await minifyDevice('<script>'+read(resolve(appRoot,'src/deviceHomeRuntime.js'))+'</script>')).slice(8,-9));
 const auth=script(authBundle)+script(read(resolve(sourceRoot,'common/web/auth.js')));
 const embedded={};let standalone;
 for(const [model,raw] of Object.entries(pages)){
  const html=await minifyDevice(raw.replace(i18nScript,()=>'<script data-device-part="i18n.js">'+packed+'</script>'));
  let normal='',frame='',last=0;
  const fragments=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for(const match of html.matchAll(fragments)){
   normal+=html.slice(last,match.index);frame+=html.slice(last,match.index);
   const tag=match[3]===undefined?script(match[2]):'<link rel="stylesheet" href="'+resource(match[3],'css')+'">';
   if(/data-device-part="service\.js"/.test(match[1]||'')){frame+=bridge;normal+=auth;}
   if(/data-device-part="page\.js"/.test(match[1]||''))frame+=runtime;
   normal+=tag;frame+=tag;last=match.index+match[0].length;
  }
  normal+=html.slice(last);frame+=html.slice(last);
  embedded[model]=frame;if(model==='daikin')standalone=normal;
 }
 return {assets,pages:embedded,standalone};
}

export function hubDevicePages(options){
 return {name:'hub-device-assets',resolveId(id){if(id==='virtual:device-pages')return '\0device-pages';},
 async load(id){
  if(id!=='\0device-pages')return;
  const {assets,pages,standalone}=await buildDeviceAssets({...options,watch:file=>this.addWatchFile(file)});
  for(const [fileName,source] of assets)this.emitFile({type:'asset',fileName,source});
  this.emitFile({type:'asset',fileName:'standalone-daikin.html',source:standalone});
  return 'export default '+JSON.stringify(pages)+';';
 }};
}
