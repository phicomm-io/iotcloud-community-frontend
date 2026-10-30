const pathPeer=peer=>encodeURIComponent(peer);

export function createHubLanClient(request){
 return {
  discover:signal=>request('/hub/lan',{cache:'no-store',signal}),
  register(device){return request('/devices',{method:'POST',body:JSON.stringify({mac:device.device_id,model:device.model,version:'v2'})});},
  unregister(peer){return request('/devices/'+pathPeer(peer),{method:'DELETE'});},
  pair({peer,ip,password,scopes=1}){return request('/hub/lan/pair',{method:'POST',body:JSON.stringify({peer,ip,password,scopes})});},
  pairStatus(peer){return request('/hub/lan/pair/'+pathPeer(peer),{cache:'no-store'});},
  unpair(peer){return request('/hub/lan/unpair',{method:'POST',body:JSON.stringify({peer})});},
 };
}
