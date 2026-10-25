import {ref} from 'vue';
import messages from './locales.js';
const key='phicomm.language';
const browser=typeof window!=='undefined';
let preference='auto';
try{preference=localStorage.getItem(key)||'auto';}catch{}
function detect(){
 if(!browser)return 'zh-CN';
 for(const language of navigator.languages||[navigator.language||'en']){
  if(/^zh/i.test(language))return 'zh-CN';
  if(/^en/i.test(language))return 'en';
 }
 return 'en';
}
export const languagePreference=ref(['auto','zh-CN','en'].includes(preference)?preference:'auto');
export const language=ref(languagePreference.value==='auto'?detect():languagePreference.value);
export function t(id,values={}){
 const pair=messages[id];
 const text=pair?pair[language.value==='zh-CN'?1:0]:id;
 return text.replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
}
export function setLanguage(value,persist=true){
 if(!['auto','zh-CN','en'].includes(value))return;
 languagePreference.value=value;language.value=value==='auto'?detect():value;
 if(browser){document.documentElement.lang=language.value;if(persist)try{localStorage.setItem(key,value);}catch{}}
}
const legacy=new Map(Object.entries(messages).map(([id,pair])=>[pair[1],id]));
export function errorMessage(data,status){
 const hubError='hub.error.'+data.code;
 const id=messages[hubError]?hubError:messages[data.message_key]?data.message_key:legacy.get(data.error||data.message);
 return id?t(id,data.args||{}):data.error||data.message||t('p.ba1f34a4de75',{v0:status});
}
if(browser){
 setLanguage(languagePreference.value,false);
 window.addEventListener('languagechange',()=>{if(languagePreference.value==='auto')setLanguage('auto',false);});
 window.addEventListener('storage',event=>{if(event.key===key)setLanguage(event.newValue||'auto',false);});
}
