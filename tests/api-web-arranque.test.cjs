const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {apiRequire}=require('./pdf-harness.cjs');
test('Arranque público: entrada remota espera la auditoría y mantiene el puerto cerrado ante rechazo o error',async()=>{
 const source=apiRequire('esbuild').transformSync(fs.readFileSync(path.resolve(__dirname,'../api/src/web.ts'),'utf8'),{loader:'ts',format:'cjs'}).code;
 for(const host of ['remoto.invalid','127.0.0.1','localhost','[::1]'])for(const result of ['aprobado','rechazado','error']){
  let listen=0,disconnect=0,resolve;
  const pending=new Promise(r=>{resolve=r;});const process={env:{WEB_DATABASE_URL:`postgresql://web@${host}/postgres`,NODE_ENV:'production'},exitCode:0};const messages=[];
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,process,console:{log(){},error:m=>messages.push(m)},require(name){
   if(name==='./entorno-publico')return {};
   if(name==='./entorno-web')return apiRequire('./src/entorno-web');
   if(name==='./lib/prisma-web')return {crearPrismaWeb:()=>({$disconnect:async()=>{disconnect++;}}),esConexionRemota:()=>true};
   if(name==='./lib/seguridad-web')return {auditarIdentidadWeb:async()=>false};
   if(name==='./api-web')return {crearApiWeb:(_db,env)=>{assert.equal(env.MAIL_ENABLED,'false');assert.equal(env.WHATSAPP_ENABLED,'false');return {listen:()=>{listen++;}};}};
   if(name==='../scripts/verificar-web.cjs')return {verificar:async()=>{await pending;if(result==='error')throw Error('detalle ficticio privado');return {ok:result==='aprobado'};}};
   throw Error('Import no previsto');
  }});
  assert.equal(listen,0);resolve();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.equal(listen,result==='aprobado'?1:0);assert.equal(disconnect,result==='aprobado'?0:1);assert.equal(process.exitCode,result==='aprobado'?0:1);
  assert.ok(!messages.join('').includes('detalle ficticio privado'));
 }
});
