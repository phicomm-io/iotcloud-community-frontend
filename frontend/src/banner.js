import {reactive} from 'vue';
import {api} from './account';

export const banner = reactive({enabled:false, audience:'before_login', text:'', url:'', label:''});
let requestID=0;
export function safeBannerURL(value) {
 try {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value)) return '';
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
 } catch { return ''; }
}
export async function refreshBanner() {
 const id=++requestID;
 try {
  const data = await api('/banner');
  if(id!==requestID)return;
  Object.assign(banner, {enabled:data.enabled === true, audience:data.audience==='after_login'?'after_login':'before_login', text:typeof data.text === 'string' ? data.text : '', url:safeBannerURL(data.url), label:typeof data.label === 'string' ? data.label : ''});
 } catch { if(id===requestID)banner.enabled = false; }
}
