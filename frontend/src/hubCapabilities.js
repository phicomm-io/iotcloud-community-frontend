// Same remote business surface as firmware common/lan_policy.h. Local WebUI
// configuration remains available on the gateway's own authenticated page.
const remoteActions=new Set([
 'status.get','capabilities.get','info.get','diagnostics.get',
 'power.get','filter.get','alarm.get','wake_alarm.get','mcu.version.get',
 'fan.set','fan.mode.set','fan.mode.toggle','light.set','child_lock.set',
 'light_always.set','light_effect.select','light_effect.next',
 'outlet.set','indicator.set','display.set','buzzer.set',
 'wake_alarm.start','wake_alarm.stop',
 'fresh_air.config.get','fresh_air.linkage.get','fresh_air.set',
]);

export function hubRemoteCapabilities(caps){
 return {...caps,hub_remote:true,actions:(caps.actions||[]).filter(action=>remoteActions.has(action)),
  ota_upload:false,ota_variant_conversion:undefined,config_backup:false};
}
