const parser=require('../frontend/node_modules/@babel/parser');
function walk(n,fn,parent){if(!n||typeof n!=='object')return;fn(n,parent);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(x=>walk(x,fn,n));else if(v&&typeof v==='object')walk(v,fn,n)}}
const key=p=>p.key?.name||p.key?.value;
const member=n=>n?.type==='MemberExpression'||n?.type==='OptionalMemberExpression';
const memberKey=n=>n.computed?n.property?.type==='StringLiteral'?n.property.value:null:n.property?.name;
// Analyze the complete embedded document, never runtime hardware capability values.
// Any escape from statically visible UI access keeps the original exports.
function trimExports(html){
 if(/<script\b[^>]*\bsrc\s*=|<[a-z][^>]*\son[a-z]+\s*=/i.test(html))return {html,removed:[],fallback:true};
 const blocks=[...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)],trees=blocks.map(b=>parser.parse(b[2]));
 let table,index,assignment;const used=new Set();let unsafe=false;
 trees.forEach((tree,i)=>walk(tree,(n,p)=>{
  if(['CallExpression','NewExpression'].includes(n.type)&&['eval','Function'].includes(n.callee?.name))unsafe=true;
  if(n.type==='VariableDeclarator'&&n.id?.name==='UI'&&n.init?.type==='AssignmentExpression'&&n.init.left?.object?.name==='window'&&n.init.left.property?.name==='UI'&&n.init.right?.type==='ObjectExpression'){table=n.init.right;assignment=n.init.left;index=i;}
  if(member(n)&&['window','globalThis','self'].includes(n.object?.name)&&memberKey(n)==='UI'&&n!==assignment){
   if(member(p)&&p.object===n&&memberKey(p)!==null)used.add(memberKey(p));else unsafe=true;
  }
  if((n.type==='MemberExpression'||n.type==='OptionalMemberExpression')&&n.object?.name==='UI'){
   if(!n.computed)used.add(n.property.name);else if(n.property.type==='StringLiteral')used.add(n.property.value);else unsafe=true;
  }
  if(n.type==='VariableDeclarator'&&n.init?.name==='UI'&&n.id?.type==='ObjectPattern')for(const prop of n.id.properties){if(prop.type==='RestElement'||prop.computed)unsafe=true;else used.add(key(prop));}
  if(n.type==='Identifier'&&n.name==='UI'){
   const allowed=(p?.type==='VariableDeclarator'&&(p.id===n||p.init===n&&p.id.type==='ObjectPattern'))||((p?.type==='MemberExpression'||p?.type==='OptionalMemberExpression')&&(p.object===n||p.property===n&&!p.computed));
   if(!allowed)unsafe=true;
  }
 }));
 if(!table||unsafe)return {html,removed:[],fallback:unsafe};
 const removable=table.properties.filter(p=>p.type==='ObjectProperty'&&p.value?.type==='Identifier'&&!used.has(key(p)));
 const keep=table.properties.filter(p=>!removable.includes(p));
 const text='{'+keep.map(p=>blocks[index][2].slice(p.start,p.end)).join(',')+'}';
 const code=blocks[index][2];html=html.replace(blocks[index][0],()=>blocks[index][1]+code.slice(0,table.start)+text+code.slice(table.end)+blocks[index][3]);
 return {html,removed:removable.map(key),fallback:false};
}
module.exports = trimExports;
