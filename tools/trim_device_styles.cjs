const cssTree=require('../frontend/node_modules/css-tree');

// Immutable product ownership, not runtime capabilities. All styles for a
// product's optional hardware (CO2, particle sensors, fresh air, etc.) remain.
const owners={
 a1:'a1-home fan-hero power mini-metrics light-layout ring ring-effect-preview ring-preview-controls ring-v ring-l ring-anchor ring-guide ring-edge ring-light-segment swatches swatch',
 m1:'verdict fresh metrics metric scale with-co2 co2-stale co2-empty sensor-metrics metric-head metric-reference indicator-lights indicator-light indicator-state indicator-wifi indicator-rule-group indicator-rule-list indicator-rule particle-grid particle-raw m1-metrics',
 tc1:'tc1-home tiles tile-wrap tile tile-top idx tile-edit spark line area'
};
function trimStyles(css,model){
 if(!Object.hasOwn(owners,model))return css;
 const excluded=new Set(Object.entries(owners).filter(([owner])=>owner!==model).flatMap(([,names])=>names.split(' ')));
 const ast=cssTree.parse(css);
 cssTree.walk(ast,{visit:'Rule',enter(rule,item,list){
  if(rule.prelude?.type!=='SelectorList')return;
  rule.prelude.children.forEach((selector,entry,selectors)=>{
   // Only direct selector classes can prove a rule impossible. A class inside
   // :not/:is/:has cannot; retain those expressions unchanged.
   if(selector.children.some(node=>node.type==='ClassSelector'&&excluded.has(node.name)))selectors.remove(entry);
  });
  if(rule.prelude.children.isEmpty)list.remove(item);
 }});
 return cssTree.generate(ast);
}
module.exports=trimStyles;
