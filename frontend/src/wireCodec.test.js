import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWire,decodeWire,decodeResponse} from './wireCodec.js';
const hex=value=>Buffer.from(value).toString('hex');
test('MessagePack fixed vectors cover integers, utf8, floats, maps and arrays',()=>{
 for(const [value,bytes] of [[{n:127},'81a16e7f'],[{n:128},'81a16ecc80'],[{n:256},'81a16ecd0100'],[{n:65536},'81a16ece00010000'],[{n:4294967296},'81a16ecf0000000100000000'],[{n:-32},'81a16ee0'],[{n:-33},'81a16ed0df'],[{n:-129},'81a16ed1ff7f'],[{n:-32769},'81a16ed2ffff7fff'],[{n:-2147483649},'81a16ed3ffffffff7fffffff'],[{n:1.5},'81a16ecb3ff8000000000000'],[{x:[null,true,false,'网']},'81a17894c0c3c2a3e7bd91']]){assert.equal(hex(encodeWire(value)),bytes);assert.deepEqual(decodeWire(Buffer.from(bytes,'hex')),value);}
 assert.deepEqual(decodeWire(Buffer.from('81a16eca3fc00000','hex')),{n:1.5});
});
test('bounded profile rejects truncation, trailing bytes, unsafe numbers, duplicate keys and invalid text',()=>{
 const data={numbers:[0,23,255,65535,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER,.1,-0],text:'网络💡',map:Object.fromEntries(Array.from({length:17},(_,i)=>['key'+i,i])),long:'x'.repeat(256)};const encoded=encodeWire(data);assert.deepEqual(decodeWire(encoded),data);for(let i=0;i<encoded.length;i++)assert.throws(()=>decodeWire(encoded.subarray(0,i)));assert.throws(()=>decodeWire(Uint8Array.from([...encoded,0])));
 for(const value of [{n:NaN},{n:Infinity},{n:2**53},{n:undefined},{n:1n},{s:'\0'},{s:'\ud800'},{['a'.repeat(128)]:0},JSON.parse('{"__proto__":{}}')])assert.throws(()=>encodeWire(value));
 for(const bytes of ['81a178c70000','82a178c0a17801','81a178cf0020000000000000','81a178a1ff'])assert.throws(()=>decodeWire(Buffer.from(bytes,'hex')));
 let deep={};for(let i=0;i<13;i++)deep={n:deep};assert.throws(()=>encodeWire(deep));
});
test('response MIME drives decode; busy admission text is not parsed as a binary download',async()=>{
 assert.deepEqual(await decodeResponse(new Response(encodeWire({code:'ok'}),{headers:{'Content-Type':'application/msgpack; charset=binary'}})),{code:'ok'});assert.deepEqual(await decodeResponse(new Response('busy',{status:503})),{code:'busy'});
});

test('MessagePack binary fields preserve opaque MCU bytes including NUL',()=>{
 const bytes=encodeWire({frame:new Uint8Array([0,1,255])});assert.equal(hex(bytes),'81a56672616d65c4030001ff');assert.deepEqual([...decodeWire(bytes).frame],[0,1,255]);assert.throws(()=>encodeWire({frame:new Uint8Array([0])},'json'));
});
