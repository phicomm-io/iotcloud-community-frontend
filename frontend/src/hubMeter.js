export const HUB_POWER_TTL=15000;
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

// Older TC1 power.get replies have no validity/age fields. Their receipt is
// still independent from status.get, which contains only the relay snapshot.
export function hubPowerSample(data,receivedAt=Date.now()){
 const age=data?.age_ms===undefined?0:data.age_ms;
 const valid=data&&typeof data==='object'&&!Array.isArray(data)&&nonnegative(data.power_watts)&&
  nonnegative(receivedAt)&&nonnegative(age)&&age<HUB_POWER_TTL&&
  ['valid','power_valid','sensor_valid'].every(key=>data[key]===undefined||data[key]===true);
 return {valid:!!valid,power_watts:nonnegative(data?.power_watts)?data.power_watts:null,
  energy_kwh:nonnegative(data?.energy_kwh)?data.energy_kwh:null,receivedAt,age_ms:age};
}

export function hubPowerReading(state={},now=Date.now()){
 if(!Object.hasOwn(state,'hubPower'))return state.power_watts??state.power;
 const sample=state.hubPower,elapsed=now-sample?.receivedAt;
 return sample?.valid===true&&nonnegative(sample.power_watts)&&nonnegative(sample.age_ms)&&
  nonnegative(elapsed)&&elapsed+sample.age_ms<HUB_POWER_TTL?sample.power_watts:null;
}
