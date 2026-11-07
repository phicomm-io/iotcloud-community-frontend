/* SCN3 codec shared by the device editor and isolated demos. */
(()=>{
'use strict';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),t=key=>window.I18N?.t(key)||key;
const txt=(data,at,n)=>{const part=data.slice(at,at+n),end=part.indexOf(0);return decoder.decode(end<0?part:part.slice(0,end));};
const put=(data,at,n,text,lines=false)=>{const s=encoder.encode(text);if(s.length>=n||(lines?/[\x00-\x09\x0b-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(text))throw Error(t('screen.invalid'));data.set(s,at);};
const crc=data=>{let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const isChart=it=>[3,4,5].includes(it.type),num=v=>Number.isInteger(v);
const requiresCompact=it=>it.h===1&&((it.type===1&&it.w===2)||(it.w===4&&[0,6].includes(it.type)));
const minimumHeight=it=>(it.type===1&&[2,4].includes(it.w))||(it.w===4&&[0,6].includes(it.type))?1:2;
function decode(data){
 if(data.length!==9520||txt(data,0,4)!=='SCN3')throw Error(t('screen.invalid'));
 const v=new DataView(data.buffer,data.byteOffset,data.length),s={schema:3,revision:v.getUint32(4,true),pages:[],items:[]};
 if(data[8]>8||data[9]>32)throw Error(t('screen.invalid'));
 for(let i=0;i<data[8];i++){const a=16+36*i;if(data[a]>1)throw Error(t('screen.invalid'));s.pages.push({id:(data[a+1]|data[a+2]<<8|data[a+3]<<16),enabled:!!data[a],title:txt(data,a+4,32)});}
 for(let i=0;i<data[9];i++){const a=304+288*i,it={id:v.getUint16(a,true),page:data[a+2],type:data[a+3],binding:data[a+4],x:data[a+5],y:data[a+6],w:data[a+7],h:data[a+8],source:data[a+9],title:txt(data,a+16,49),unit:txt(data,a+65,17)};
 Object.assign(it,{chart:data[a+10],hours:data[a+11],series_count:data[a+12],binding2:data[a+13],binding3:data[a+14],additive:data[a+15],text:txt(data,a+88,193),value_mode:data[a+82],hide_title:data[a+83],points:v.getUint16(a+84,true)});s.items.push(it);}
 encode(s);return s;
}
function encode(s){
 if(!num(s.revision)||s.revision<0||s.revision>0xffffffff||!s.pages.length||s.pages.length>8||s.items.length>32||!s.pages.some(p=>p.enabled))throw Error(t('screen.invalid'));
 if(s.schema!=null&&s.schema!==3)throw Error(t('screen.invalid'));
 const data=new Uint8Array(9520),v=new DataView(data.buffer),cells=s.pages.map(()=>new Set()),counts=s.pages.map(()=>0),ids=new Set(),pids=new Set();
 data.set(encoder.encode('SCN3'));v.setUint32(4,s.revision,true);data[8]=s.pages.length;data[9]=s.items.length;
 s.pages.forEach((p,i)=>{const a=16+36*i,id=p.id??i+1;if((!num(id)||id<1||id>0xffffff||pids.has(id)))throw Error(t('screen.invalid'));pids.add(id);data[a]=p.enabled?1:0;{data[a+1]=id;data[a+2]=id>>8;data[a+3]=id>>16;}put(data,a+4,32,p.title);});
 s.items.forEach((it,i)=>{
  if(![it.id,it.page,it.type,it.binding,it.x,it.y,it.w,it.h,it.source].every(num)||it.id<1||it.id>65535||ids.has(it.id)||it.page<0||it.page>=s.pages.length||it.type<0||it.type>7||it.binding<0||it.binding>6||it.source<0||it.source>2||it.x<0||it.y<0||it.w<(isChart(it)?4:2)||it.h<minimumHeight(it)||it.x+it.w>4||it.y+it.h>6||++counts[it.page]>8)throw Error(t('screen.invalid'));
  const chart=it.chart??0,hours=it.hours??24,series=it.series_count??1,b2=it.binding2??0,b3=it.binding3??0,add=it.additive??0;
  const points=it.points??0;if(![0,32,64,128,256].includes(points))throw Error(t('screen.invalid'));
  const hide=it.hide_title??0;if(![0,1,false,true].includes(hide))throw Error(t('screen.invalid'));
  const mode=it.value_mode??0;if(!num(mode)||mode<0||mode>2||(mode&&it.type!==1)||(mode===2&&![4,6].includes(it.binding)))throw Error(t('screen.invalid'));
  if((![chart,hours,series,b2,b3,add].every(num)||chart<0||chart>6||![0,1,6,24].includes(hours)||series<0||series>3||b2<0||b2>6||b3<0||b3>6||add<0||add>1||(isChart(it)&&[4,5,6].includes(chart)&&(it.binding!==6||!add))))throw Error(t('screen.invalid'));
  if(isChart(it)&&it.binding!==6&&([it.binding,...([1,2].includes(chart)?[b2,...(series===3?[b3]:[])]:[])].some(b=>b===5||b===6)||(chart===2&&series===3&&new Set([it.binding,b2,b3]).size>2)))throw Error(t('screen.chart_bindings'));
  ids.add(it.id);for(let y=it.y;y<it.y+it.h;y++)for(let x=it.x;x<it.x+it.w;x++){const k=y*4+x;if(cells[it.page].has(k))throw Error(t('screen.overlap'));cells[it.page].add(k);}
  const a=304+288*i;v.setUint16(a,it.id,true);data.set([it.page,it.type,it.binding,it.x,it.y,it.w,it.h,it.source],a+2);put(data,a+16,49,it.title);put(data,a+65,17,it.unit);
  {data.set([chart,hours,series,b2,b3,add],a+10);put(data,a+88,193,it.text||'',true);data[a+82]=mode;data[a+83]=+hide;v.setUint16(a+84,points,true);}
 });return data;
}
window.ScreenLayout={encode,decode,crc,txt,requiresCompact,minimumHeight};
})();
