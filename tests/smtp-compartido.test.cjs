const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const smtp=require('../api/scripts/smtp-compartido.cjs');
const env={NODE_ENV:'development',SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_FROM:'gaona@example.test',SMTP_USER:'usuario-ficticio',SMTP_PASSWORD:'clave-ficticia-no-real'};
const confirmation=id=>`AUTORIZO UN ENVIO SMTP ${id}`;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-smtp-unit-'));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('SMTP independiente: configuración estricta, secretos privados y bloqueos de producción',t=>{
 for(const patch of [{NODE_ENV:'production'},{SMTP_HOST:'smtp.gmail.com'},{SMTP_PORT:'465'},{SMTP_SECURE:'true'},{SMTP_PASSWORD:'xkeysib-api-no-admitida'},{SMTP_PASSWORD:''}])assert.throws(()=>smtp.configurar({...env,...patch}),/SMTP_/);
 const base=fixture(t),file=path.join(base,'.env');fs.writeFileSync(file,Object.entries(env).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
 assert.equal(smtp.entorno(file).MAIL_ENABLED,'true');fs.chmodSync(file,0o644);assert.throws(()=>smtp.entorno(file),/SMTP_PRIVADO/);
 const alias=path.join(base,'alias');fs.symlinkSync(file,alias);assert.throws(()=>smtp.entorno(alias));
});
test('SMTP independiente: PDF, importes, destinatario único, MIME simulado y ningún cliente de base de datos',async t=>{
 const {dir,resumen}=await smtp.preparar(fixture(t),env,'recepcion@example.test');
 assert.equal(resumen.total,'291.16');assert.equal(resumen.intentos_reales,0);assert.match(resumen.id,/^[a-f\d-]{36}$/);
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'comprobante.json')));assert.deepEqual([receipt.estimado.subtotal,receipt.estimado.iva,receipt.estimado.total],['251.00','40.16','291.16']);
 const mime=fs.readFileSync(path.join(dir,'mensaje-simulado.eml'),'utf8');assert.match(mime,/To: recepcion@example.test/);assert.ok(!mime.includes(env.SMTP_PASSWORD));assert.ok(!mime.includes(env.SMTP_USER));
 const encoded=mime.split(/Content-Type: application\/pdf/i)[1].split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g,'');
 assert.deepEqual(Buffer.from(encoded,'base64'),fs.readFileSync(path.join(dir,'documento.pdf')));
 for(const f of fs.readdirSync(dir))assert.equal(fs.statSync(path.join(dir,f)).mode&0o077,0);
 const source=fs.readFileSync(path.join(root,'api/scripts/smtp-compartido.cjs'),'utf8');assert.doesNotMatch(source,/PrismaClient|crearClienteDataApi|fetch\(|DATABASE_URL|DIRECT_URL/);
 await assert.rejects(smtp.preparar(fixture(t),env,'a@example.test,b@example.test'),/SMTP_DESTINATARIO/);
});
test('SMTP independiente: consentimiento exacto y reserva exclusiva, incluso ante concurrencia y reinicio',async t=>{
 const {dir,resumen}=await smtp.preparar(fixture(t),env,'recepcion@example.test');let calls=0,created=0;
 const create=options=>{created++;assert.equal(options.host,'smtp-relay.brevo.com');assert.equal(options.port,587);assert.equal(options.secure,false);assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.logger,false);assert.equal(options.debug,false);
  return {async sendMail(message){calls++;assert.equal(message.to.address,'recepcion@example.test');assert.deepEqual(message.envelope.to,['recepcion@example.test']);return {accepted:['recepcion@example.test'],rejected:[],response:'250 aceptado ficticio'};},close(){}};};
 await assert.rejects(smtp.enviar(dir,env,'NO AUTORIZO',create),/SMTP_CONFIRMACION/);assert.equal(calls,0);assert.ok(!fs.existsSync(path.join(dir,'intento-reservado.json')));
 const results=await Promise.allSettled([smtp.enviar(dir,env,confirmation(resumen.id),create),smtp.enviar(dir,env,confirmation(resumen.id),create)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);assert.equal(created,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'resultado.json'))).entrega,'no_verificada');
 delete require.cache[require.resolve('../api/scripts/smtp-compartido.cjs')];await assert.rejects(require('../api/scripts/smtp-compartido.cjs').enviar(dir,env,confirmation(resumen.id),create),/SMTP_INTENTO/);assert.equal(calls,1);
});
test('SMTP independiente: error incierto no reintenta y diagnóstico nunca incluye mensajes sensibles',async t=>{
 const {dir,resumen}=await smtp.preparar(fixture(t),env,'recepcion@example.test');let calls=0;
 const create=()=>({async sendMail(){calls++;throw Object.assign(Error(env.SMTP_PASSWORD),{code:'ESOCKET',originalCode:'ECONNRESET',command:'AUTH',response:env.SMTP_PASSWORD});},close(){}});
 const result=await smtp.enviar(dir,env,confirmation(resumen.id),create);assert.equal(result.estado,'no_confirmado');assert.equal(result.diagnostico.codigo_error,'ESOCKET');assert.equal(result.diagnostico.codigo_original,'ECONNRESET');assert.equal(result.diagnostico.comando,'AUTH');
 assert.ok(!fs.readFileSync(path.join(dir,'resultado.json'),'utf8').includes(env.SMTP_PASSWORD));await assert.rejects(smtp.enviar(dir,env,confirmation(resumen.id),create),/SMTP_INTENTO/);assert.equal(calls,1);
});
test('SMTP independiente: comprobante alterado se rechaza antes de reservar o crear transporte',async t=>{
 const {dir,resumen}=await smtp.preparar(fixture(t),env,'recepcion@example.test');const file=path.join(dir,'comprobante.json'),data=JSON.parse(fs.readFileSync(file));data.estimado.total='0.01';fs.writeFileSync(file,JSON.stringify(data));let calls=0;
 await assert.rejects(smtp.enviar(dir,env,confirmation(resumen.id),()=>{calls++;}),/SMTP_INTEGRIDAD/);assert.equal(calls,0);assert.ok(!fs.existsSync(path.join(dir,'intento-reservado.json')));
});
test('Supervisor: activar SMTP se rechaza sin red ni cambios mientras la persistencia solo admite simulación',()=>{
 const result=spawnSync(process.execPath,['api/scripts/entorno-compartido.cjs','smtp'],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/WEB_SMTP_TERMINAL/);
 const source=fs.readFileSync(path.join(root,'api/scripts/entorno-compartido.cjs'),'utf8');assert.match(source,/MAIL_ENABLED:'false'/);
 const noTty=spawnSync(process.execPath,['api/scripts/smtp-compartido.cjs','prueba'],{cwd:root,encoding:'utf8'});assert.equal(noTty.status,1);assert.match(noTty.stderr,/SMTP_TERMINAL/);
});
