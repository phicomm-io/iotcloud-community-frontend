export const HUB_POWER_TTL=15000;
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

// Older TC1 power.get replies have no validity/age fields. Their receipt is
// still independent from status.get, which contains only the relay snapshot.
export function hubPowerSample(data,receivedAt=Date.now()){
 const age=data?.age_ms===undefined?0:data.age_ms;
 const meter=data?.metering;
 const watts=meter?meter.active_power:data?.power_watts;
 const meterValid=!meter||(meter.valid_fields===undefined?meter.valid!==false:Number.isInteger(meter.valid_fields)&&!!(meter.valid_fields&4));
 const valid=data&&typeof data==='object'&&!Array.isArray(data)&&nonnegative(watts)&&meterValid&&
  nonnegative(receivedAt)&&nonnegative(age)&&age<HUB_POWER_TTL&&
  ['valid','power_valid','sensor_valid','meter_valid'].every(key=>data[key]===undefined||data[key]===true);
 return {valid:!!valid,power_watts:nonnegative(watts)?watts:null,
  energy_kwh:nonnegative(data?.energy_kwh)?data.energy_kwh:meter?.energy_kwh??null,
  ...(meter?{metering:{...meter}}:{}),receivedAt,age_ms:age};
}

export function hubMeterFresh(sample,now=Date.now()){
 const elapsed=now-sample?.receivedAt;
 return nonnegative(elapsed)&&nonnegative(sample?.age_ms)&&elapsed+sample.age_ms<HUB_POWER_TTL;
}

export function hubPowerReading(state={},now=Date.now()){
 if(!Object.hasOwn(state,'hubPower')){
  const value=state.power_watts??state.power;
  // S30's `power` is the relay state, not a measurement.
  return typeof value==='boolean'?null:value;
 }
 const sample=state.hubPower;
 return sample?.valid===true&&nonnegative(sample.power_watts)&&hubMeterFresh(sample,now)?sample.power_watts:null;
}
