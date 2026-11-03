import test from 'node:test';
import assert from 'node:assert/strict';
import {hubRemoteCapabilities} from './hubCapabilities.js';

test('remote capability projection preserves identity and exposes only the LAN business surface',()=>{
 const caps={device_id:'aabbccddeeff',model:'m1',firmware_version:'rc5',variant:'full',wire_version:1,
  actions:['status.get','capabilities.get','power.get','mcu.version.get','display.set','fresh_air.config.get','fresh_air.linkage.get','fresh_air.set','config.get','config.set','time.get','time.set','ota.start','binding.status.get','sensor_details.get','future.get'],
  ota_upload:true,ota_variant_conversion:'full-to-hub',config_backup:true};
 const projected=hubRemoteCapabilities(caps);
 assert.deepEqual(projected.actions,['status.get','capabilities.get','power.get','mcu.version.get','display.set','fresh_air.config.get','fresh_air.linkage.get','fresh_air.set']);
 assert.deepEqual(Object.fromEntries(['device_id','model','firmware_version','variant','wire_version'].map(key=>[key,projected[key]])),Object.fromEntries(['device_id','model','firmware_version','variant','wire_version'].map(key=>[key,caps[key]])));
 assert.equal(projected.hub_remote,true);assert.equal(projected.ota_upload,false);assert.equal(projected.config_backup,false);assert.equal(projected.ota_variant_conversion,undefined);
 assert.equal(caps.ota_upload,true);assert(caps.actions.includes('config.set'),'the local capability object must remain intact');
});
