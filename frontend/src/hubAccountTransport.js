import {createDeviceWire} from './deviceWire.js';
// Hub account sessions remain separate from device WebUI sessions. Only the
// structured wire envelope changes; cloud account requests never use this path.
export function createHubAccountTransport({fetcher=globalThis.fetch,origin=''}={}){
 const wire=createDeviceWire({fetcher,origin,expectedIdentity:{model:'daikin'}});
 return {wire,decodeResponse:wire.decodeResponse,async request(path,{body,headers,...options}={}){
  await wire.discover();
  const structured=body===undefined?{}:{value:typeof body==='string'?JSON.parse(body):body};
  const clean=new Headers(headers);clean.delete('Content-Type');clean.delete('Accept');
  return wire.request(path,{...options,...structured,credentials:'include',headers:Object.fromEntries(clean)});
 }};
}
