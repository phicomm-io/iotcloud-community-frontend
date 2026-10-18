import {reactive} from 'vue';
import {api} from './account';

export const banner = reactive({enabled:false, text:'', url:'', label:''});
export function safeBannerURL(value) {
 try {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value)) return '';
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
 } catch { return ''; }
}
export async function refreshBanner() {
 try {
  const data = await api('/banner');
  Object.assign(banner, {enabled:data.enabled === true, text:typeof data.text === 'string' ? data.text : '', url:safeBannerURL(data.url), label:typeof data.label === 'string' ? data.label : ''});
 } catch { banner.enabled = false; }
}
