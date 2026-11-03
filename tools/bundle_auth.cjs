const esbuild=require('../frontend/node_modules/esbuild');
const path=require('node:path');
module.exports=()=>esbuild.buildSync({entryPoints:[path.join(__dirname,'../frontend/src/deviceAuth.js')],bundle:true,write:false,format:'iife',globalName:'DeviceAuth',target:'es2020',minify:true,legalComments:'none'}).outputFiles[0].text;
if(require.main===module)process.stdout.write(module.exports());
