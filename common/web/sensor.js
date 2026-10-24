/* Shared metric cards for sensor providers. Units are part of the wire contract. */
window.SensorUI=(()=>{
 const {h}=UI,{t}=I18N;
 function tile(key,unit){
  const value=h('span',{class:'num'},'—'),badge=h('span',{class:'badge'}),scale=h('div');
  const card=h('section',{class:'card metric','data-sensor':key},
   h('div',{class:'metric-head'},h('span',{class:'label','data-i18n':'m.'+key},t('m.'+key)),badge),
   h('div',{class:'stat'},value,h('small',{},unit)),scale);
  return {card,value,badge,scale};
 }
 function reading(el,key,value,valid){
  const grade=valid&&UI.AIR[key]?UI.grade(key,value):null;
  el.value.textContent=valid?Number(value).toFixed(key==='formaldehyde'?3:key==='temperature'?1:0):'—';
  el.badge.className='badge '+(valid&&grade?grade.cls:'');
  el.badge.textContent=valid?(grade?t(grade.key):''):t('m1.no_data');
  el.scale.replaceChildren(...(grade&&valid?[UI.airScale(key,value)]:[]));
  return valid?grade:null;
 }
 function peers(status){return (status.peers||[]).map(p=>h('div',{class:'item binding-peer'},UI.icon('fan'),
  h('div',{class:'grow'},h('b',{class:'num'},'A1 · '+UI.prettyMac(p.mac)),h('span',{},p.ip||'—')),
  h('span',{class:'badge '+(p.session_ready?'ok':'')},t(p.session_ready?'m1.session_ok':'m1.stale'))));}
 return {tile,reading,peers};
})();
