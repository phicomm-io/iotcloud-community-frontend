const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={window:{},TextEncoder};vm.runInNewContext(fs.readFileSync('M1/web/display-format.js','utf8'),context);
const f=context.window.M1DisplayFormat;
const display=(mode,show_label=false,show_unit=false)=>({mode,show_label,show_unit});

test('fixed glass formatting matches independently specified rounding and saturation boundaries',()=>{
 const cases={
  integer:[[0,'0'],[.49,'0'],[.5,'1'],[998.49,'998'],[998.5,'999'],[999.5,'999'],[1000,'999'],[999999,'999']],
  auto_kilo:[[999,'999'],[999.5,'999'],[1000,'1.00'],[1234,'1.23'],[9999,'9.99'],[10000,'9.99'],[999999,'9.99']],
  decimal_2:[[0,'0.00'],[.004,'0.00'],[.005,'0.01'],[1.234,'1.23'],[1.235,'1.24'],[2.675,'2.68'],[9.995,'9.99'],[1000,'9.99']],
  decimal_1:[[.04,'0.00'],[.05,'0.10'],[1.24,'1.20'],[1.25,'1.30'],[9.94,'9.90'],[9.95,'9.90'],[1000,'9.90']],
  milli:[[0,'0.00'],[5,'0.01'],[999,'1.00'],[1234,'1.23'],[10000,'9.99'],[999999,'9.99']]
 };
 for(const [mode,values] of Object.entries(cases))for(const [value,expected] of values){
  const encoded=f.encode(display(mode),0,value);assert.equal(encoded.text,expected,`${mode} ${value}`);
  assert.equal(encoded.format,expected.includes('.')?1:0);assert(encoded.number>=0&&encoded.number<=999);
 }
 assert.equal(f.encode(display('decimal_1'),0,1.26).number,130);
});
test('physical point and label/unit segments remain independent in both positions',()=>{
 for(const slot of [0,1])for(const label of [false,true])for(const unit of [false,true]){
  const value=f.encode(display('integer',label,unit),slot,12.75);
  assert.equal(value.text,'13');assert.equal(value.format,(label?2:0)|(unit?4:0));
 }
 for(const mode of ['auto_kilo','decimal_1','decimal_2','milli'])assert.equal(f.encode(display(mode),1,1),null,`PM forbids ${mode}`);
 for(const value of [-1,NaN,Infinity,-Infinity,1e39,null,undefined,'1'])assert.equal(f.encode(display('integer'),0,value),null);
 for(const mode of ['bad',null,undefined])assert.equal(f.encode(display(mode),0,1),null);
 assert.equal(f.encode({...display('integer'),extra:1},0,1),null);
 assert.equal(f.encode(display('integer'),2,1),null);
 assert.equal(f.metricValid('co2',0),false);assert.equal(f.metricValid('co2',65536),false);
 assert.equal(f.metricValid('fan_speed_percent',101),false);assert.equal(f.metricValid('temperature',-20),true);
});
test('MAC normalization accepts precisely compact or six full octets and emits canonical IDs',()=>{
 for(const value of ['AABBCCDDEEFF','aa:bb:cc:dd:ee:ff','AA:BB:CC:DD:EE:FF',' aAbBcCdDeEfF '])assert.equal(f.deviceID(value),'aabbccddeeff');
 for(const value of ['',null,undefined,'xxxxxxxxxxxx','xx:xx:xx:xx:xx:xx','aabbccddeeff00','aa-bb-cc-dd-ee-ff','aabb.ccdd.eeff',
  'aabb:cc:dd:ee:ff','a:ab:bc:cd:de:ef','aabbccddeefg','aa:bb:cc:dd:ee:ff:','aa:bb:cc:dd:ee:ffgg'])assert.equal(f.deviceID(value),null,String(value));
});
test('generic source IDs and descriptor text use the protocol byte limits without coercion',()=>{
 for(const value of ['a','constructor','new_field_2','a'.repeat(32)])assert.equal(f.fieldID(value),true);
 for(const value of ['',null,0,'Uppercase','_field','with.dot','with-dash','a'.repeat(33)])assert.equal(f.fieldID(value),false);
 for(const value of ['', '界'.repeat(8),'µg/m³'])assert.equal(f.descriptorText(value,0,24),true);
 for(const value of [null,0,false,'界'.repeat(9),'x\n','x\u007f','\ud800','\udfff'])assert.equal(f.descriptorText(value,0,24),false);
 assert.equal(f.descriptorText('',1,64),false);assert.equal(f.descriptorText('界'.repeat(21)+'a',1,64),true);assert.equal(f.descriptorText('界'.repeat(22),1,64),false);
});
test('all 512 independent lamp patterns retain exact booleans and reject malformed shapes',()=>{
 for(let mask=0;mask<512;mask++){
  const lamps=Array.from({length:3},(_,position)=>({red:!!(mask&(1<<position)),green:!!(mask&(1<<(position+3))),yellow:!!(mask&(1<<(position+6)))}));
  assert.equal(f.validLamps(lamps),true);
  const read=lamps.reduce((value,lamp,position)=>value|(Number(lamp.red)<<position)|(Number(lamp.green)<<(position+3))|(Number(lamp.yellow)<<(position+6)),0);
  assert.equal(read,mask);
 }
 for(const bad of [null,[],[{}, {}, {}],f.uniformLamps('red').slice(1),[{red:1,green:false,yellow:false},...f.uniformLamps('off').slice(1)],
  [{...f.uniformLamps('off')[0],blue:true},...f.uniformLamps('off').slice(1)]])assert.equal(f.validLamps(bad),false);
});
test('production C raw frames retain their digits, native glyphs and float32 values independently of source metadata',()=>{
 const sample=require('./fixtures/m1-display-v3-production-get.json');
 for(const [slot,lane] of sample.runtime.lanes.entries()){
  assert.equal(f.validLamps(lane.lamps),true);assert.equal(f.physical(lane.value),true);
  const decoded=lane.format&1?lane.number/100:lane.number;
  assert.equal(f.samePhysical(lane.value,decoded),true);
  assert.equal(lane.unit,lane.format&4?(slot?'µg/m³':'mg/m³'):'');
 }
 assert.equal(f.samePhysical(sample.runtime.lanes[0].value,1.2300000190734863),true,'JSON and C float32 encodings confirm the same frame');
 assert.equal(f.samePhysical(sample.runtime.lanes[0].value,1.231),false);
 assert.equal(sample.runtime.lanes[0].number,123);assert.equal(sample.runtime.lanes[0].format,5);
 assert.notEqual(f.encode(sample.lanes[0].display,0,sample.runtime.lanes[0].value).number,123,'raw API digits must never pass through the physical-source encoder');
});
