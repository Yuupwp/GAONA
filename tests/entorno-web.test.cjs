const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {own}=require('../api/scripts/entorno-web.cjs');
const root=path.resolve(__dirname,'..');
const config={version:1,habilitado:false,remitente:'gaona.proyint1@gmail.com',destinatarios:['ficticio@example.test']};
function lectura(answers){
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'api/scripts/web-local-privado.cjs'),'utf8'),{module,Buffer,console:{log(){}},process:{stdin:{isTTY:true},stderr:{isTTY:true},getuid:()=>123},require(name){
  if(name==='node:fs')return {constants:{},openSync:()=>1,fstatSync:()=>({isFile:()=>true,uid:123,mode:0o600}),readFileSync:()=>Buffer.from(JSON.stringify(config)),closeSync(){}};
  if(name==='node:child_process')return {spawnSync:(binary,args)=>{
   const pre=`import getpass,json\nanswers=iter(json.loads(${JSON.stringify(JSON.stringify(answers))}))\ngetpass.getpass=lambda *args: next(answers)\n`;
   return spawnSync(binary,['-c',pre+args[1]],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});
  }};
  if(name==='tsx/cjs')return {};
  if(name==='../src/correo-ensayo-local')return {validarConfiguracionEnsayo:v=>v};return require(name);
 }});
 return module.exports.credenciales('/directorio-ficticio');
}
test('Supervisor local: confirmación correcta y datos sintéticos pasan sin SMTP ni credenciales reales',()=>{
 const r=lectura(['AUTORIZO ENSAYO SMTP LOCAL','ficticio@example.test','usuario000-rnx','ClaveFicticia000-rnx']);
 assert.equal(r.destinatario,'ficticio@example.test');assert.equal(r.usuario,'usuario000-rnx');
});
test('Supervisor local: errores privados distinguen confirmación de datos y destinatario, sin revelar valores',()=>{
 for(const [answers,code] of [
  [['NO'],'SMTP_CONFIRMACION'],
  [['AUTORIZO ENSAYO SMTP LOCAL','ficticio@example.test','','ClaveFicticia'],'SMTP_DATOS_INVALIDOS'],
  [['AUTORIZO ENSAYO SMTP LOCAL','ficticio@example.test','usuario','xkeysib-ficticia'],'SMTP_DATOS_INVALIDOS'],
  [['AUTORIZO ENSAYO SMTP LOCAL','ficticio@example.test','usuario','ficticia\r\n'],'SMTP_DATOS_INVALIDOS'],
  [['AUTORIZO ENSAYO SMTP LOCAL','no-autorizado@example.test','usuario','ClaveFicticia'],'SMTP_DESTINO_NO_AUTORIZADO']
 ])assert.throws(()=>lectura(answers),e=>e.message.startsWith(code+':')&&!e.message.includes('ClaveFicticia'));
});
test('supervisor solo identifica procesos del directorio GAONA y escucha local',()=>{
 assert.equal(own({args:['/usr/bin/node',path.join(root,'api/src/web-local.ts')],cwd:root},'api'),true);
 assert.equal(own({args:['node','/otro-proyecto/api.js'],cwd:root},'api'),false);
 assert.equal(own({args:['python3','-m','http.server','5500','--bind','127.0.0.1','--directory','Página'],cwd:root},'frontend'),true);
 assert.equal(own({args:['python3','-m','http.server','5500','--bind','127.0.0.1','--directory','/otro/proyecto'],cwd:root},'frontend'),false);
 const directory=path.join(os.homedir(),'.local/state/gaona-web5c/postgres');
 assert.equal(own({args:['/usr/lib/postgresql/17/bin/postgres','-D',directory,'-h','127.0.0.1']},'postgres'),true);
 assert.equal(own({args:['/usr/lib/postgresql/17/bin/postgres','-D','/otro/cluster','-h','127.0.0.1']},'postgres'),false);
});
test('supervisor rechaza producción y ensayo sin terminal privada antes de iniciar servicios',()=>{
 const entry=path.join(root,'api/scripts/entorno-web.cjs');
 for(const [mode,env,pattern] of [['iniciar',{NODE_ENV:'production'},/producción rechazada/],['brevo',{NODE_ENV:'development'},/terminal privada/]]){
  const r=spawnSync(process.execPath,[entry,mode],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,pattern);
 }
});

test('ensayo futuro: sesión ligada al origen, un solo SMTP simulado y ninguna reanudación automática',async()=>{
 const {apiRequire}=require('./pdf-harness.cjs');const {randomUUID}=require('node:crypto');
 const {crearEnsayoCorreoLocal}=apiRequire('./src/correo-ensayo-local');const {configurarSmtp}=apiRequire('./src/solicitud-correo');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-sesion-ficticia-'));let calls=0;
 const options=configurarSmtp({MAIL_ENABLED:'true',SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_FROM:config.remitente,SMTP_USER:'usuario-ficticio',SMTP_PASSWORD:'clave-ficticia'}).opciones;
 const factory=()=>{calls++;const stream=apiRequire('nodemailer').createTransport({streamTransport:true,buffer:true});return {sendMail:async m=>{const info=await stream.sendMail(m);return {accepted:info.envelope.to,rejected:[],messageId:info.messageId};},close:()=>stream.close()};};
 const record=()=>({id:randomUUID(),cliente:{correo:config.destinatarios[0]}});
 const message=d=>({messageId:`<solicitud-${d.id}@gmail.com>`,from:{address:config.remitente},to:{address:d.cliente.correo},envelope:{from:config.remitente,to:[d.cliente.correo]},attachments:[{filename:'ficticio.pdf',content:Buffer.from('%PDF-ficticio')}]});
 try{
  const s=randomUUID(),trial=crearEnsayoCorreoLocal(dir,'smtp',config,factory,s),a=record(),b=record();
  await trial.politica.registrar(a,true);await trial.politica.registrar(b,true);
  const first=trial.fabrica(options);await first.sendMail(message(a));first.close();
  await assert.rejects(trial.fabrica(options).sendMail(message(b)));assert.equal(calls,1);
  const changed=crearEnsayoCorreoLocal(dir,'smtp',config,factory,randomUUID());assert.equal(await changed.politica.registrar(b,false),false);
  await assert.rejects(changed.fabrica(options).sendMail(message(b)));assert.equal(calls,1);
 }finally{fs.rmSync(dir,{recursive:true});}
});
