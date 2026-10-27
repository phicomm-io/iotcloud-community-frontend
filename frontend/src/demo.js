import '../../M1/web/display-format.js';
import '../../common/web/demo.js';
import {watchEffect} from 'vue';
import {t,language} from './i18n.js';
const devices=['tc1','m1','a1','daikin'].map((model,i)=>({model,mac:'aabbccddee0'+(i+1),version:'v2',username:'demo',mqtt_username:'demo',status:'active',name:model.toUpperCase()}));
window.fetch=async(url,options={})=>{
 let path=String(url).split('?')[0],data={};
 if(!path.startsWith('/api/'))throw Error(t('demo.networkBlocked'));
 if(path==='/api/auth/me'||path==='/api/auth/login')data={username:'demo',mqtt_username:'demo',aliases:[],is_admin:false};
 else if(path==='/api/register/status')data={enabled:true,mqtt_ws_uri:'wss://demo.invalid/mqtt'};
 else if(path==='/api/devices'){if(options.method==='POST')devices.push(JSON.parse(options.body));data=[...devices];}
 else if(path.startsWith('/api/devices/')&&options.method==='DELETE'){const mac=path.split('/').pop();const i=devices.findIndex(d=>d.mac===mac);if(i>=0)devices.splice(i,1);}
 else if(path.startsWith('/api/analytics'))data={};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
const banner=document.createElement('div'),summary=document.createElement('span');banner.append(summary);banner.style='padding:8px;text-align:center;background:#c7ed70;color:#1b3028;font-size:12px';document.body.prepend(banner);

const platformLink=document.createElement('a');platformLink.href='https://phicomm-io.github.io/iotcloud/';platformLink.style='display:inline-block;margin-left:12px;padding:6px 0;color:inherit;font-weight:600';banner.append(platformLink);
watchEffect(()=>{window.PhicommDemo.setLanguage(language.value);summary.textContent=t('demo.banner');platformLink.textContent=t('demo.openPlatform');});
