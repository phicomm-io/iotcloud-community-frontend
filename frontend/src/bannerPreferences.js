// One announcement per node/account. Preferences follow the content, so a
// changed announcement can be shown without reviving the dismissed old one.
const memory=new Map();
const key=(node,user)=>'iotcloud.banner.'+encodeURIComponent(node)+'.'+encodeURIComponent(user||'anonymous');
const fingerprint=b=>JSON.stringify([b.audience,b.text,b.url,b.label]);
function read(storage,key){if(memory.has(storage+key))return memory.get(storage+key);try{return JSON.parse(globalThis[storage].getItem(key)||'null');}catch{return null;}}
function write(storage,key,value){try{globalThis[storage].setItem(key,JSON.stringify(value));memory.delete(storage+key);}catch{memory.set(storage+key,value);}}
export function bannerHidden(b,node,user,now=Date.now()){
 const k=key(node,user),id=fingerprint(b),saved=read('localStorage',k),ignored=read('sessionStorage',k);
 return (ignored?.id===id&&ignored.choice==='ignore') || (saved?.id===id&&(saved.choice==='dismiss'||(saved.choice==='snooze'&&saved.until>now)));
}
export function hideBanner(b,node,user,choice,now=Date.now()){
 if(!['ignore','snooze','dismiss'].includes(choice))return;
 write(choice==='ignore'?'sessionStorage':'localStorage',key(node,user),{id:fingerprint(b),choice,until:choice==='snooze'?now+24*60*60*1000:0});
}
