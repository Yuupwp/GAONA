const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {apiRequire,valid,fixture}=require('./pdf-harness.cjs');
const {crearEnsayoCorreoLocal,validarConfiguracionEnsayo}=apiRequire('./src/correo-ensayo-local');
const {crearApiWeb}=apiRequire('./src/api-web');
const {configurarSmtp}=apiRequire('./src/solicitud-correo');
const smtp={NODE_ENV:'development',MAIL_ENABLED:'true',SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'usuario-ficticio',SMTP_PASSWORD:'clave-ficticia',SMTP_FROM:'gaona.proyint1@gmail.com'};
const config={version:1,habilitado:false,remitente:smtp.SMTP_FROM,destinatarios:['permitido@example.test']};
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'gaona-correo-local-'));
const data=(correo='permitido@example.test')=>({id:randomUUID(),cliente:{...valid.cliente,correo}});
const message=(d)=>({messageId:`<solicitud-${d.id}@gmail.com>`,from:{address:smtp.SMTP_FROM},to:{address:d.cliente.correo},envelope:{from:smtp.SMTP_FROM,to:[d.cliente.correo]},subject:'Prueba ficticia',attachments:[{filename:'prueba.pdf',content:Buffer.from('%PDF-ficticio')} ]});

test('Correo local: lista privada exclusiva del ensayo, máximo tres y deshabilitada por defecto',()=>{
 assert.deepEqual(validarConfiguracionEnsayo(config),config);
 for(const c of [{...config,habilitado:true},{...config,destinatarios:[]},{...config,destinatarios:Array(4).fill('uno@example.test')},{...config,destinatarios:['*']},{...config,destinatarios:['uno@example.test','uno@example.test']},{...config,remitente:'otro@example.test'}])assert.throws(()=>validarConfiguracionEnsayo(c));
});

test('Correo local: simulación permite cualquier dominio válido y distingue MIME de SMTP',async()=>{
 const dir=temporary();try{
  const e=crearEnsayoCorreoLocal(dir,'simulado');
  for(const correo of ['ficticio@gmail.com','ficticio@outlook.com','ficticio@yahoo.com','ficticio@empresa.example']){
   const d=data(correo);assert.equal(e.politica.permitir(correo),true);
   assert.equal(await e.politica.registrar(d,true),true);
   const t=e.fabrica(configurarSmtp(smtp).opciones);await t.sendMail(message(d));t.close();
   assert.deepEqual(await e.politica.presentar(d,{estado:'aceptado'}),{estado:'simulado',modo:'simulado'});
   assert.ok(fs.readFileSync(path.join(dir,`correo-simulado-${d.id}.eml`),'utf8').includes('To: '+correo));
   assert.equal(fs.statSync(path.join(dir,`correo-simulado-${d.id}.eml`)).mode&0o777,0o600);
  }
 }finally{fs.rmSync(dir,{recursive:true});}
});

test('Correo local: ensayo usa destinatario exacto y reserva durable, nunca reintenta incluso tras reinicio',async()=>{
 const dir=temporary();let calls=0;
 try{
  const factory=options=>{calls++;assert.equal(options.requireTLS,true);assert.equal(options.dnsTimeout,10000);const stream=apiRequire('nodemailer').createTransport({streamTransport:true,buffer:true});return {sendMail:async m=>{const r=await stream.sendMail(m);return {accepted:r.envelope.to,rejected:[],messageId:r.messageId};},close:()=>stream.close()};};
  const d=data(),e=crearEnsayoCorreoLocal(dir,'smtp',config,factory);await e.politica.registrar(d,true);
  const t=e.fabrica(configurarSmtp(smtp).opciones);await t.sendMail(message(d));t.close();assert.equal(calls,1);
  const again=crearEnsayoCorreoLocal(dir,'smtp',config,factory);
  await assert.rejects(again.fabrica(configurarSmtp(smtp).opciones).sendMail(message(d)));assert.equal(calls,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,`intento-smtp-${d.id}.json`))).maximo,1);
  const denied=data('no-autorizado@example.test');assert.equal(e.politica.permitir(denied.cliente.correo),false);
  assert.equal(await e.politica.registrar(denied,true),false);
  await assert.rejects(e.fabrica(configurarSmtp(smtp).opciones).sendMail(message(denied)));assert.equal(calls,1);
  const changed={...d,cliente:{...d.cliente,correo:'no-autorizado@example.test'}};
  await assert.rejects(e.fabrica(configurarSmtp(smtp).opciones).sendMail(message(changed)));assert.equal(calls,1);
 }finally{fs.rmSync(dir,{recursive:true});}
});

test('Correo local: una simulación antigua conserva su origen al cambiar de modo y no se convierte en envío real',async()=>{
 const dir=temporary();try{
  const d=data();fs.writeFileSync(path.join(dir,`correo-simulado-${d.id}.eml`),'MIME ficticio',{mode:0o600});
  const e=crearEnsayoCorreoLocal(dir,'smtp',config,()=>{throw Error('No debe crear transporte');});
  assert.equal(await e.politica.registrar(d,false),false);
  assert.deepEqual(await e.politica.presentar(d,{estado:'aceptado'}),{estado:'simulado',modo:'simulado'});
  const desconocido=data();assert.equal(await e.politica.registrar(desconocido,false),false);
  assert.deepEqual(await e.politica.presentar(desconocido,{estado:'aceptado'}),{estado:'no_confirmado',modo:'desconocido'});
 }finally{fs.rmSync(dir,{recursive:true});}
});

test('Correo local: API rechaza correo no autorizado y campo antirrobot antes del registro',async()=>{
 const dir=temporary();let writes=0;
 const db={producto:{findMany:async()=>fixture},solicitud:{create:async()=>{writes++;return {id:randomUUID(),creadoEn:new Date()};}}};
 const e=crearEnsayoCorreoLocal(dir,'smtp',config,()=>{throw Error('Sin red');});
 const app=crearApiWeb(db,smtp,false,e.fabrica,e.politica),server=http.createServer(app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [body,status] of [[valid,403],[{...valid,cliente:{...valid.cliente,correo:config.destinatarios[0]},sitioWeb:'https://bot.invalid'},400]]){
   const r=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});assert.equal(r.status,status);
  }assert.equal(writes,0);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true});}
});

test('Correo local: entrada de secretos requiere terminal y no acepta canal sin eco ausente',()=>{
 const r=spawnSync(process.execPath,['-e',`require('./api/scripts/web-local-privado.cjs').configurar('/inexistente')`],{cwd:path.resolve(__dirname,'..'),env:{PATH:process.env.PATH},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/terminal local interactiva/);
});

test('WEB definitivo preparado: backend valida cliente.correo de cualquier dominio, fija mensaje y conserva límites',async()=>{
 let writes=0,calls=0;const messages=[];
 const db={producto:{findMany:async()=>fixture},solicitud:{create:async query=>{writes++;assert.ok(query.data.cliente.create.correo);return {id:randomUUID(),creadoEn:new Date()};}}};
 const factory=()=>{const stream=apiRequire('nodemailer').createTransport({streamTransport:true,buffer:true});return {sendMail:async message=>{calls++;messages.push(message);const info=await stream.sendMail(message);return {accepted:info.envelope.to,rejected:[]};},close:()=>stream.close()};};
 const app=crearApiWeb(db,smtp,false,factory),server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const correo of ['cliente@gmail.com','cliente@outlook.com','cliente@yahoo.com','cliente@empresa.example']){
   const body={...valid,cliente:{...valid.cliente,correo},from:'intruso@example.test',to:'otro@example.test',subject:'AJENO',attachments:[{path:'/etc/passwd'}]};
   const r=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
   assert.equal(r.status,201);const receipt=await r.json();assert.equal(receipt.correo.estado,'aceptado');
   const m=messages.at(-1);assert.deepEqual(m.envelope.to,[correo]);assert.equal(m.from.address,smtp.SMTP_FROM);assert.equal(m.subject,`GAONA | Solicitud de cotización - ${receipt.id}`);assert.ok(Buffer.isBuffer(m.attachments[0].content));assert.equal(m.attachments[0].path,undefined);
  }
  const invalid=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...valid,cliente:{...valid.cliente,correo:'no-es-correo'}})});assert.equal(invalid.status,400);assert.equal(writes,4);assert.equal(calls,4);
 }finally{await new Promise(r=>server.close(r));}
});
