// Bounded JSON-compatible MessagePack. No DOM or network dependencies;
// the same source is bundled into device pages and the cloud application.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const forbidden=new Set(['__proto__']);
export const wireMime=format=>format==='msgpack'?'application/msgpack':'application/json';
function asBytes(v){return v instanceof Uint8Array?v:v instanceof ArrayBuffer?new Uint8Array(v):ArrayBuffer.isView(v)?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):null;}
export function detectWire(value){
 if(typeof value==='string')return 'json';
 const b=asBytes(value),c=b?.[0];
 return (c>=0x80&&c<=0x8f)||c===0xde||c===0xdf?'msgpack':'json';
}
function invalid(){throw Error('Invalid device wire payload');}
function validText(text){
 if(text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))invalid();
}
function checkValue(v,depth=0,budget={n:0}){
 if(depth>=12||++budget.n>8192)invalid();
 if(v===null||typeof v==='boolean')return;
 if(typeof v==='number'){if(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))invalid();return;}
 if(typeof v==='string'){validText(v);return;}
 if(typeof v!=='object'||ArrayBuffer.isView(v)||v instanceof ArrayBuffer||(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype))invalid();
 for(const [key,item] of Object.entries(v)){validText(key);if(forbidden.has(key)||encoder.encode(key).length>=128)invalid();checkValue(item,depth+1,budget);}
}
export function encodeWire(value,format='msgpack'){
 checkValue(value);if(format==='json')return JSON.stringify(value);
 if(format!=='msgpack')invalid();
 let output=null,pos=0;
 function bytes(b){if(output)output.set(b,pos);pos+=b.length;}
 function byte(n){if(output)output[pos]=n;pos++;}
 function uint(n,width){for(let i=width-1;i>=0;i--)byte(Math.floor(n/2**(8*i))&255);}
 function head(kind,n){
  if(kind===0&&n<128){byte(n);return;}
  if(kind===1&&n<32){byte(255-n);return;}
  if(kind===3&&n<32){byte(0xa0+n);return;}
  if((kind===4||kind===5)&&n<16){byte((kind===4?0x90:0x80)+n);return;}
  let width;
  if(kind<=1){
   width=kind===0?(n<=255?1:n<=65535?2:n<=0xffffffff?4:8):(n<=127?1:n<=32767?2:n<=0x7fffffff?4:8);
   byte((kind===0?0xcc:0xd0)+(width===1?0:width===2?1:width===4?2:3));
   if(kind===0)uint(n,width);else for(let i=width-1;i>=0;i--)byte(255-(Math.floor(n/2**(8*i))&255));return;
  }
  width=kind===3&&n<=255?1:n<=65535?2:4;
  byte(kind===3?(width===1?0xd9:width===2?0xda:0xdb):kind===4?(width===2?0xdc:0xdd):(width===2?0xde:0xdf));uint(n,width);
 }
 function text(s){const b=encoder.encode(s);head(3,b.length);bytes(b);}
 function write(v){
  if(v===null){byte(0xc0);return;}
  if(typeof v==='boolean'){byte(0xc2+Number(v));return;}
  if(typeof v==='number'){
   if(Number.isSafeInteger(v)&&!Object.is(v,-0)){head(v<0?1:0,v<0?-1-v:v);return;}
   byte(0xcb);const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,v);bytes(b);return;
  }
  if(typeof v==='string'){text(v);return;}
  if(Array.isArray(v)){head(4,v.length);for(const item of v)write(item);return;}
  const entries=Object.entries(v);head(5,entries.length);for(const [key,item]of entries){text(key);write(item);}
 }
 write(value);if(pos>1048576)invalid();output=new Uint8Array(pos);pos=0;write(value);return output;
}
export function decodeWire(value,format=detectWire(value),{onNumber}={}){
 let out;
 if(format==='json')out=JSON.parse(typeof value==='string'?value:decoder.decode(asBytes(value)));
 else{
  if(format!=='msgpack')invalid();
  const b=asBytes(value);if(!b||!b.length||b.length>1048576)invalid();
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength);let pos=0,nodes=0;
  function take(n){if(n>b.length-pos)invalid();const start=pos;pos+=n;return start;}
  function uint(width,negative=false){let n=0;const start=take(width);for(let i=start;i<start+width;i++)n=n*256+(negative?255-b[i]:b[i]);if(!Number.isSafeInteger(n))invalid();return negative?-1-n:n;}
  function floating(width){const start=take(width);let n;
   if(width===8)n=view.getFloat64(start);else if(width===4)n=view.getFloat32(start);else{
    const h=view.getUint16(start),e=(h>>10)&31,m=h&1023;
    if(e===31)invalid();n=(h&0x8000?-1:1)*(e?m+1024:m)*2**(e?e-25:-24);
   }if(!Number.isFinite(n))invalid();return n;
  }
  function number(value,integer,path){onNumber?.(value,integer,path);return value;}
  function item(depth=0,path=[]){
   if(depth>=12||++nodes>8192)invalid();const c=b[take(1)];let kind,n;
    if(c<128)return number(c,true,path);if(c>=224)return number(c-256,true,path);
    if(c===0xc0)return null;if(c===0xc2||c===0xc3)return c===0xc3;
    if((c&224)===160){kind=3;n=c&31;}
    else if((c&240)===128){kind=5;n=c&15;}
    else if((c&240)===144){kind=4;n=c&15;}
    else if(c>=0xd9&&c<=0xdb){kind=3;n=uint(1<<(c-0xd9));}
    else if(c===0xdc||c===0xdd){kind=4;n=uint(c===0xdc?2:4);}
    else if(c===0xde||c===0xdf){kind=5;n=uint(c===0xde?2:4);}
    else if(c>=0xcc&&c<=0xcf)return number(uint(1<<(c-0xcc)),true,path);
    else if(c>=0xd0&&c<=0xd3){const width=1<<(c-0xd0);return number(uint(width,!!(b[pos]&128)),true,path);}
    else if(c===0xca||c===0xcb)return number(floating(c===0xca?4:8),false,path);
    else invalid();
   if(kind===3){const start=take(n),text=decoder.decode(b.subarray(start,start+n));validText(text);return text;}
   if(n>8192)invalid();
   if(kind===4){const a=[];for(let i=0;i<n;i++)a.push(item(depth+1,onNumber?[...path,i]:path));return a;}
   const o={};for(let i=0;i<n;i++){
    const key=item(depth+1);if(typeof key!=='string'||Object.hasOwn(o,key)||forbidden.has(key)||encoder.encode(key).length>=128)invalid();o[key]=item(depth+1,onNumber?[...path,key]:path);
   }return o;
  }
  out=item();if(pos!==b.length)invalid();
 }
 checkValue(out);if(!out||typeof out!=='object'||Array.isArray(out))invalid();return out;
}
export async function decodeResponse(response){
 const type=response.headers?.get('Content-Type')?.split(';')[0];
 // Admission can fail before the server can negotiate a wire format.
 if(response.status===503&&!['application/msgpack','application/json'].includes(type)){await response.arrayBuffer();return {code:'busy'};}
 return type==='application/msgpack'?decodeWire(await response.arrayBuffer(),'msgpack'):response.json();
}
