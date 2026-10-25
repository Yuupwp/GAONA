const Module=require('node:module');
const path=require('node:path');
const cp=require('node:child_process');
const original=Module._load;
const root=path.resolve(__dirname,'../..');
const directory=process.argv[2];
Module._load=function(name,...args){
 if(name==='node:child_process')return {...cp,spawn(binary,argv,options){
  if(binary!==process.execPath||argv.length!==2||argv[0]!==path.join(root,'api/scripts/web-local.cjs')||argv[1]!=='api-smtp')throw Error('Ejecutable externo bloqueado por la prueba');
  return cp.spawn(binary,[path.join(__dirname,'smtp-terminal-lector.cjs'),'lector',directory],options);
 }};
 return original.call(this,name,...args);
};
process.argv=[process.execPath,path.join(root,'api/scripts/entorno-web.cjs'),'brevo'];
Module._load(path.join(root,'api/scripts/entorno-web.cjs'),null,true);
