const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const context=vm.createContext({Uint8Array,DataView});vm.runInContext(fs.readFileSync('DAIKIN/web/screen-appearance.js','utf8'),context);const A=context.ScreenAppearance,codec=process.env.SCREEN_APPEARANCE_CODEC;
test('APP1 round-trips full palettes and all 32 widget overrides through the MCU codec',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-app1-'));try{
  for(const theme of A.themes){const a=A.defaults();a.theme=theme;a.revision=17;a.wallpaper='custom';a.custom_crc=0xfedcba98;
   for(const role of A.roles)a.colors[role]='#123456';for(let i=1;i<=32;i++)a.items[i]={background:'#123456',title:'#234567',value:'#345678',unit:'#456789',body:'#56789a',opacity:i};
   const bytes=A.encode(a);assert.equal(bytes.length,704);assert.deepEqual(JSON.parse(JSON.stringify(A.decode(bytes))),JSON.parse(JSON.stringify(a)));
   if(codec){const file=path.join(tmp,'app1.bin');fs.writeFileSync(file,bytes);assert.deepEqual(cp.execFileSync(codec,[file]),Buffer.from(bytes));}
  }
  const invalid=A.encode(A.defaults());invalid[10]=6;assert.throws(()=>A.decode(invalid));const a=A.defaults();a.items[0]={value:'#ffffff'};assert.throws(()=>A.encode(a));
  a.items=[];assert.throws(()=>A.encode(a));a.items={};a.wallpaperDim=71;assert.throws(()=>A.encode(a));
 }finally{fs.rmSync(tmp,{recursive:true});}
});
test('RGB565 output matches the MCU header, payload CRC and dimensions; corruption is rejected',()=>{
 const pixels=new Uint8Array(240*427*4);for(let i=0;i<pixels.length;i++)pixels[i]=(i*17)&255;
 const image=A.packWallpaper(pixels),header=A.parseWallpaper(image);assert.equal(image.length,204992);assert.equal(header.crc,A.crc(image.slice(32)));
 assert.equal(new DataView(image.buffer).getUint16(32,true),((pixels[0]&248)<<8)|((pixels[1]&252)<<3)|(pixels[2]>>3));
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-bwp-'));try{const file=path.join(tmp,'image.bwp');fs.writeFileSync(file,image);if(codec)cp.execFileSync(codec,['wallpaper',file]);
  image[100]^=1;assert.throws(()=>A.parseWallpaper(image));fs.writeFileSync(file,image);if(codec)assert.throws(()=>cp.execFileSync(codec,['wallpaper',file]));
 }finally{fs.rmSync(tmp,{recursive:true});}
 assert.throws(()=>A.parseWallpaper(new Uint8Array(10)));
});
test('all three preset images produce exactly the same RGB565 pixels in the MCU and editor',()=>{
 if(!codec)return;
 for(let k=1;k<=3;k++){const native=cp.execFileSync(codec,['preset',String(k)],{maxBuffer:2*1024*1024});assert.equal(native.length,480*854*2);
  for(let y=0;y<854;y++)for(let x=0;x<480;x++){const c=A.presetPixel(k,x,y),expected=((c>>8)&0xf800)|((c>>5)&0x7e0)|((c>>3)&31);assert.equal(native.readUInt16LE((y*480+x)*2),expected,`${k} ${x} ${y}`);}
 }
});
test('APP1 preserves old Chinese defaults and persists English in the reserved byte',()=>{
 const a=A.defaults();assert.equal(a.language,'zh-CN');a.language='en';const bytes=A.encode(a);assert.equal(bytes[56],1);assert.equal(A.decode(bytes).language,'en');
 bytes[56]=2;assert.throws(()=>A.decode(bytes));a.language='fr';assert.throws(()=>A.encode(a));
});
test('page rail sizes preserve legacy bytes and round-trip through the native codec',()=>{
 const a=A.defaults();assert.equal(A.encode(a)[57],0);assert.equal(A.railHeight(a),12);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-rail-'));try{
  for(const height of [0,6,12,20]){
   a.pageRailHeight=height;const bytes=A.encode(a);assert.equal(bytes[57],height);assert.equal(A.decode(bytes).pageRailHeight,height);
   if(codec){const file=path.join(tmp,'rail.bin');fs.writeFileSync(file,bytes);assert.deepEqual(cp.execFileSync(codec,[file]),Buffer.from(bytes));}
  }
  const bytes=A.encode(a);bytes[57]=7;assert.throws(()=>A.decode(bytes));a.pageRailHeight=7;assert.throws(()=>A.encode(a));
 }finally{fs.rmSync(tmp,{recursive:true});}
});
