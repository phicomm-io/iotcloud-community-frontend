import test from 'node:test';
import assert from 'node:assert/strict';
import {HUB_POWER_TTL,hubPowerSample,hubPowerReading} from './hubMeter.js';

test('legacy TC1 power replies use an independent receipt and zero watts stays valid',()=>{
 const sample=hubPowerSample({power_watts:0,energy_kwh:.25},1000),state={sensorAt:14000,power_watts:999,hubPower:sample};
 assert.equal(hubPowerReading(state,1000),0);
 assert.equal(hubPowerReading(state,1000+HUB_POWER_TTL-1),0);
 assert.equal(hubPowerReading({...state,sensorAt:16000},1000+HUB_POWER_TTL),null);
 assert.equal(hubPowerReading(state,999),null);
 assert.equal(hubPowerReading(state,NaN),null);
 assert.equal(sample.energy_kwh,.25);
});

test('reported age is counted once and invalid, stale or nonnumeric samples cannot become watts',()=>{
 assert.equal(hubPowerReading({hubPower:hubPowerSample({power_watts:12,age_ms:5000},1000)},10999),12);
 assert.equal(hubPowerReading({hubPower:hubPowerSample({power_watts:12,age_ms:5000},1000)},11000),null);
 for(const data of [null,[],{},...[-1,NaN,Infinity,'0',null].map(power_watts=>({power_watts})),
  ...[-1,NaN,Infinity,HUB_POWER_TTL,'0',null].map(age_ms=>({power_watts:12,age_ms})),
  ...['valid','power_valid','sensor_valid'].flatMap(key=>[false,0,'true'].map(value=>({power_watts:12,[key]:value})))]){
  assert.equal(hubPowerReading({hubPower:hubPowerSample(data,1000)},1000),null,JSON.stringify(data));
 }
 assert.equal(hubPowerSample({power_watts:12},NaN).valid,false);
 assert.equal(hubPowerSample({power_watts:12},-1).valid,false);
});

test('hub validity never falls back to an older status value; existing cloud and S30 values stay intact',()=>{
 assert.equal(hubPowerReading({power_watts:99,hubPower:null},1000),null);
 assert.equal(hubPowerReading({power_watts:99,hubPower:hubPowerSample({power_watts:1,valid:false},1000)},1000),null);
 assert.equal(hubPowerReading({power_watts:0},1000),0);
 assert.equal(hubPowerReading({power:'3.5'},1000),'3.5');
});
