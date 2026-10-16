import test from 'node:test';
import assert from 'node:assert/strict';
import '../../common/web/provision.js';
const P=globalThis.IotProvision;
test('provisioning permits only explicit local device origins and HTTPS platforms',()=>{
 for(const value of ['192.168.1.8','http://10.0.0.8:8080/','https://[fd00::123]/'])assert(P.deviceURL(value));
 for(const value of ['https://evil.example/','http://8.8.8.8/','http://192.168.1.8.evil.example/','http://user:pass@192.168.1.8/','http://192.168.1.8/?password=secret','http://192.168.1.8/#secret','javascript:alert(1)','http://192.168.1.8/config','http://0.0.0.0/'])assert.throws(()=>P.deviceURL(value));
 for(const value of ['https://phicomm-io.github.io','https://mqtt.example:8443','http://127.0.0.1:1234'])assert.equal(P.platformOrigin(value),value);
 for(const value of ['http://public.example','null','https://example.com/path','https://example.com/','https://user:secret@example.com'])assert.throws(()=>P.platformOrigin(value));
});
test('short-lived ticket rejects expired, excessive, duplicate and credential-bearing fields',()=>{
 const now=Date.now(),id=P.nonce(),origin='https://platform.example',expires=now+P.TTL;
 const hash='#'+new URLSearchParams({'iotcloud-import':id,origin,expires,host:'broker.example',port:1883,user:'demo'});
 assert.deepEqual(P.readTicket(hash,now),{id,origin,expires,host:'broker.example',port:1883,user:'demo'});
 assert(!hash.includes('password'));assert.equal(P.readTicket('#settings/mqtt'),null);
 for(const extra of ['&password=secret','&origin=https://evil.example'])assert.throws(()=>P.readTicket(hash+extra,now));
 assert.throws(()=>P.readTicket(hash,expires));assert.throws(()=>P.readTicket(hash,now-1));
});
test('configuration is a strict bounded schema; window, exact origin, nonce and lifetime must all match',()=>{
 const values={v:1,host:'mqtt.example',port:1883,user:'测试-user',password:'<test>&?#',protocol:'tmcp',expires:Date.now()+P.TTL-1000};
 assert.deepEqual(P.config(values),values);
 for(const change of [{host:'wss://mqtt.example/mqtt'},{host:'user@evil'},{port:0},{port:'1883'},{protocol:'legacy'},{user:'界'.repeat(22)},{password:'界'.repeat(86)},{password:'bad\u0000password'},{v:2},{token:'not-allowed'},{expires:Date.now()-1}])assert.throws(()=>P.config({...values,...change}));
 const source={},expected={source,origin:'http://192.168.1.8',id:P.nonce(),expires:values.expires};
 const event={source,origin:expected.origin,data:{type:'iotcloud.provision.ready',id:expected.id}};
 assert(P.packet(event,expected,'iotcloud.provision.ready'));
 for(const change of [{source:{}},{origin:'http://192.168.1.9'},{data:{...event.data,id:'wrong'}}])assert(!P.packet({...event,...change},expected,'iotcloud.provision.ready'));
 assert(!P.packet(event,{...expected,expires:0},'iotcloud.provision.ready'));
});
