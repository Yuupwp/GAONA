const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {laboratorio,config,mail,data,sha}=require('./smtp-permanente-fixture.cjs');
const root=path.resolve(__dirname,'..');
function entorno(t){
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-smtp-config-'));fs.mkdirSync(path.join(work,'api/scripts'),{recursive:true});
 for(const p of ['entorno-compartido.cjs','config-data-api.cjs','smtp-compartido.cjs','brevo-diagnostico.cjs'])fs.copyFileSync(path.join(root,'api/scripts',p),path.join(work,'api/scripts',p));
 fs.symlinkSync(path.join(root,'api/src'),path.join(work,'api/src'),'junction');fs.symlinkSync(path.join(root,'api/node_modules'),path.join(work,'api/node_modules'),'junction');
 const shared=require(path.join(work,'api/scripts/entorno-compartido.cjs'));
 const put=patch=>fs.writeFileSync(path.join(work,'api/.env'),Object.entries({...config,...patch}).filter(([,v])=>v!==undefined).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
 t.after(()=>fs.rmSync(work,{recursive:true,force:true}));return{shared,put};
}
test('SMTP permanente: activación exclusiva desde .env, simulación por defecto y secretos solo backend',t=>{
 const {shared,put}=entorno(t);
 for(const value of ['false',undefined]){put({MAIL_ENABLED:value,SMTP_PASSWORD:''});const env=shared.entorno();assert.equal(env.MAIL_ENABLED,'false');assert.equal(env.SMTP_PASSWORD,undefined);assert.equal(env.WEB_CORREO_MODO,undefined);}
 put({MAIL_ENABLED:'true',DATABASE_URL:'no-utilizar',DIRECT_URL:'no-utilizar',WEB_SMTP_DESTINATARIO:'fijo@example.test'});
 const env=shared.entorno();assert.equal(env.MAIL_ENABLED,'true');assert.equal(env.SMTP_PASSWORD,mail.SMTP_PASSWORD);assert.equal(env.WEB_CORREO_MODO,'smtp');assert.equal(env.WEB_SMTP_SESION,undefined);assert.equal(env.WEB_SMTP_DESTINATARIO,undefined);assert.equal(env.DATABASE_URL,undefined);assert.equal(env.DIRECT_URL,undefined);
 assert.deepEqual(shared.config(env),{apiPort:3000,frontendPort:5500});assert.throws(()=>shared.config({...env,WEB_PORT:'3001'}),/WEB_SMTP_ORIGEN/);
 const timed=shared.entorno(true);assert.equal(timed.WEB_SMTP_SESION,'temporal');
 const source=fs.readFileSync(path.join(root,'api/scripts/entorno-compartido.cjs'),'utf8');assert.match(source,/if\(env.WEB_SMTP_SESION==='temporal'\)timer=setTimeout/);
});
test('SMTP permanente: credenciales faltantes o inválidas y booleanos incorrectos rechazan el arranque sin red',t=>{
 const {shared,put}=entorno(t);
 for(const patch of [{SMTP_USER:''},{SMTP_PASSWORD:''},{SMTP_FROM:'incorrecto'},{SMTP_HOST:'smtp.gmail.com'},{SMTP_PORT:'465'},{SMTP_SECURE:'true'},{SMTP_PASSWORD:'xkeysib-no-es-smtp'},{MAIL_ENABLED:'TRUE'},{NODE_ENV:'production'}]){put(patch);assert.throws(()=>shared.entorno(),/SMTP_|WEB_/);}
});
test('SMTP permanente: cotización concurrente, PDF canónico SHA-256, destinatario persistido y reinicio sin duplicados',async()=>{
 const lab=laboratorio();let api=await lab.abrir();try{
  const key=randomUUID(),body=data('recepcion@protonmail.com');
  const responses=await Promise.all([api.post('/solicitudes',body,key),api.post('/solicitudes',body,key)]);for(const r of responses)assert.equal(r.status,201);
  const records=await Promise.all(responses.map(r=>r.json())),r=records[0];assert.equal(records[1].id,r.id);assert.equal(lab.registros.size,1);assert.equal(api.calls(),1);assert.equal(r.correo.estado,'aceptado');assert.equal(r.correo.modo,'smtp');
  assert.deepEqual([r.estimado.subtotal,r.estimado.iva,r.estimado.total],['694.50','111.12','805.62']);
  const pdf=Buffer.from(await(await api.post('/solicitudes/pdf',{token:r.pdf.token})).arrayBuffer());const saved=lab.registros.get(r.id);
  assert.equal(sha(pdf),saved.documento.sha);assert.equal(sha(pdf),sha(lab.mensajes[0].message.attachments[0].content));assert.equal(saved.correo.destinatario,body.cliente.correo);assert.equal(saved.correo.intentos,1);
  const mime=lab.mensajes[0].mime.toString(),encoded=mime.split(/Content-Type: application\/pdf/i)[1].split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g,'');assert.equal(sha(Buffer.from(encoded,'base64')),sha(pdf));assert.ok(!mime.includes(mail.SMTP_PASSWORD));
  assert.equal((await api.post('/solicitudes/pdf',{token:'invalido'})).status,403);assert.equal((await fetch(api.base+'/clientes')).status,404);assert.equal((await fetch(api.base+'/empleados')).status,404);
  await api.close();api=await lab.abrir();const replay=await(await api.post('/solicitudes',body,key)).json();assert.equal(replay.id,r.id);assert.equal(api.calls(),0);
  for(const correo of ['recepcion@gmail.com','recepcion@outlook.com','recepcion@empresa.example']){const response=await api.post('/solicitudes',data(correo),randomUUID());assert.equal(response.status,201);assert.equal((await response.json()).correo.estado,'aceptado');}
  assert.equal(api.calls(),3);assert.deepEqual(lab.mensajes.map(m=>m.message.to.address),[body.cliente.correo,'recepcion@gmail.com','recepcion@outlook.com','recepcion@empresa.example']);
 }finally{await api.close();}
});
test('SMTP permanente: los simulados históricos y los resultados inciertos no se reenvían',async()=>{
 const lab=laboratorio(),body=data('recepcion@example.test'),oldKey=randomUUID();let api=await lab.abrir({...config,MAIL_ENABLED:'false',WEB_CORREO_MODO:undefined});
 try{
  const old=await(await api.post('/solicitudes',body,oldKey)).json();assert.equal(old.correo.estado,'simulado');await api.close();api=await lab.abrir();
  const repeated=await(await api.post('/solicitudes',body,oldKey)).json();assert.equal(repeated.id,old.id);assert.equal(repeated.correo.estado,'simulado');assert.equal(api.calls(),0);
  await api.close();api=await lab.abrir(config,true);const key=randomUUID(),uncertain=await(await api.post('/solicitudes',body,key)).json();assert.equal(uncertain.correo.estado,'no_confirmado');assert.equal(api.calls(),1);await api.close();api=await lab.abrir();
  assert.equal((await(await api.post('/solicitudes',body,key)).json()).correo.estado,'no_confirmado');assert.equal(api.calls(),0);assert.equal(lab.registros.get(uncertain.id).correo.intentos,1);
 }finally{await api.close();}
});
