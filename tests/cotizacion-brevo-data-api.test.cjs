const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const {gateway,env,req,urlLocal}=require('./data-api-fixture.cjs');
process.env.SOLICITUD_PDF_KEY=env.SOLICITUD_PDF_KEY;
const {crearClienteDataApi,crearPersistenciaDataApi,crearEnsayoDataApi}=req('./src/data-api');
const {crearApiWeb}=req('./src/api-web');
const {fabricaCotizacionesBrevo}=require('../api/scripts/smtp-compartido.cjs');
const available=!!process.env.GAONA_DATA_API_TEST_ADMIN_URL,sha=b=>createHash('sha256').update(b).digest('hex');
const mail={SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'ficticio',SMTP_PASSWORD:'clave-ficticia',SMTP_FROM:'gaona@example.test'};
async function seed(db){const id=randomUUID();await db.categoria.create({data:{id,nombre:'Catálogo aislado '+id}});const products=await Promise.all([['Puerta catálogo aislado','347.25',3],['Ventana catálogo aislado','1120.30',2]].map(async([nombre,precio,cantidad])=>{const p=await db.producto.create({data:{id:randomUUID(),idCategoria:id,nombre,precioDesde:precio}});return{idProducto:p.id,cantidad};}));return{cliente:{nombre:'Cliente',apellido:'Cotización aislada',telefono:'+15555550101',correo:'recepcion-'+id.slice(0,8)+'@example.test'},descripcion:'Cotización de catálogo aislado',whatsappConsentimiento:false,productos:products};}
async function open(g,data,mode='smtp',network,general=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-brevo-cotizacion-')),cfg={...g.env,...mail,MAIL_ENABLED:'true',WEB_CORREO_MODO:mode};
 const client=crearClienteDataApi(cfg,{fetch:g.fetch}),store=crearPersistenciaDataApi(cfg,client);let calls=0,mime,attachment;
 const create=options=>{assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.port,587);const stream=req('nodemailer').createTransport({streamTransport:true,buffer:true});return{async sendMail(message){calls++;assert.deepEqual(message.envelope.to,[message.to.address]);attachment=Buffer.from(message.attachments[0].content);const r=await stream.sendMail(message);mime=r.message;if(network)throw Object.assign(Error('Error ficticio sin datos privados'),{code:'ESOCKET'});return{accepted:[message.to.address],rejected:[],messageId:r.messageId,response:'250 simulado'};},close(){stream.close();}};};
 const transport=crearEnsayoDataApi(dir,client,mode==='smtp'?{modo:'smtp',destinatario:general?undefined:data.cliente.correo,fabrica:fabricaCotizacionesBrevo(cfg,create)}:{});
 const server=http.createServer(crearApiWeb(undefined,cfg,false,transport.fabrica,transport.politica,{catalogo:()=>client.catalogo(),persistencia:store}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 return{client,store,base,post:(key,body=data,origin='http://127.0.0.1:5500')=>fetch(base+'/solicitudes',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)}),calls:()=>calls,mime:()=>mime,pdf:()=>attachment,
 async close(){server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('Brevo Data API: actualización mínima preserva todas las filas históricas y ACL',{skip:!available},async()=>{
 const g=await gateway();try{
  const data=await seed(g.db),client=crearClienteDataApi(g.env,{fetch:g.fetch}),store=crearPersistenciaDataApi(g.env,client);const old=await store.registrar(randomUUID(),data,undefined);await store.documento(old.comprobante);
  const snapshot=async()=>sha(JSON.stringify(await g.db.$queryRaw`SELECT jsonb_build_object('configuracion',(SELECT jsonb_agg(to_jsonb(t)) FROM public.gaona_web_configuracion t),'registros',(SELECT jsonb_agg(to_jsonb(t) ORDER BY clave) FROM public.gaona_web_registros t),'documentos',(SELECT jsonb_agg(to_jsonb(t) ORDER BY solicitud_id) FROM public.gaona_web_documentos t),'correos',(SELECT jsonb_agg(to_jsonb(t) ORDER BY solicitud_id) FROM public.gaona_web_correos t)) AS historial`));const before=await snapshot();
  const security=async()=>JSON.stringify(await g.db.$queryRaw`SELECT jsonb_build_object('tablas',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'),'funciones',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('public.gaona_web_operacion(text,jsonb)'::regprocedure,'gaona_web_interno.operacion(text,jsonb)'::regprocedure)),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r)) AS permisos`);const previousSecurity=await security();
  await g.db.$executeRawUnsafe('ALTER TABLE public.gaona_web_correos DROP CONSTRAINT gaona_web_correos_modo_check');await g.db.$executeRawUnsafe("ALTER TABLE public.gaona_web_correos ADD CONSTRAINT gaona_web_correos_modo_check CHECK(modo='simulado')");
  const url=new URL(urlLocal(process.env.GAONA_DATA_API_TEST_ADMIN_URL)),bin=process.env.PG_BIN||'/usr/lib/postgresql/17/bin';
  const result=spawnSync(path.join(bin,'psql'),['-X','-v','ON_ERROR_STOP=1','-f',path.resolve(__dirname,'../api/propuestas/data-api/05-correo-real.sql')],{env:{PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:url.port,PGUSER:'gaona_local_admin',PGDATABASE:'gaona_data_api_aislada'},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(await snapshot(),before);assert.equal(await security(),previousSecurity);assert.equal((await client.operacion('verificar')).correo_version,2);
  const privileges=await g.db.$queryRaw`SELECT has_any_column_privilege('authenticated','public.gaona_web_correos','INSERT,UPDATE') AS dml`;assert.equal(privileges[0].dml,false);
 }finally{await g.close();}
});
test('Brevo Data API: productos y precios de catálogo, destinatario persistido y mismo PDF SHA-256',{skip:!available},async()=>{
 const g=await gateway();let api;try{
  const data=await seed(g.db);api=await open(g,data);assert.equal(await api.store.disponible(),true);const key=randomUUID(),responses=await Promise.all([api.post(key),api.post(key),api.post(key)]);for(const response of responses)assert.equal(response.status,201);const records=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(records.map(r=>r.id)).size,1);const r=records[0];
  assert.deepEqual([r.estimado.subtotal,r.estimado.iva,r.estimado.total],['3282.35','525.18','3807.53']);assert.equal(r.correo.modo,'smtp');assert.equal(r.correo.estado,'aceptado');
  const pdfResponse=await fetch(api.base+'/solicitudes/pdf',{method:'POST',headers:{Origin:'http://127.0.0.1:5500','Content-Type':'application/json'},body:JSON.stringify({token:r.pdf.token})});assert.equal(pdfResponse.status,200);const pdf=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(sha(pdf),sha(api.pdf()));
  const encoded=api.mime().toString().split(/Content-Type: application\/pdf/i)[1].split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g,'');assert.equal(sha(Buffer.from(encoded,'base64')),sha(pdf));
  const text=spawnSync('pdftotext',['-','-'],{input:pdf});assert.equal(text.status,0);assert.match(text.stdout.toString(),/Puerta catálogo aislado/);assert.match(text.stdout.toString(),/Ventana catálogo aislado/);
  const rows=await g.db.$queryRaw`SELECT modo,destinatario,intentos,estado,adjunto_sha256,(SELECT pdf_sha256 FROM public.gaona_web_documentos WHERE solicitud_id=${r.id}) AS documento_sha FROM public.gaona_web_correos WHERE solicitud_id=${r.id}`;
  assert.deepEqual(rows[0],{modo:'smtp',destinatario:data.cliente.correo,intentos:1,estado:'aceptado',adjunto_sha256:sha(pdf),documento_sha:sha(pdf)});
  assert.equal((await api.post(key)).status,201);assert.equal(api.calls(),1);
  assert.equal((await api.post(randomUUID(),{...data,cliente:{...data.cliente,correo:'no-autorizado@example.test'}})).status,403);
  assert.equal((await api.post(randomUUID(),data,'https://otro.invalid')).status,403);assert.equal((await fetch(api.base+'/clientes')).status,404);assert.equal(g.counters.external,0);
 }finally{if(api)await api.close();await g.close();}
});
test('Brevo Data API: repetir una cotización simulada durante SMTP conserva su modo y no la envía',{skip:!available},async()=>{
 const g=await gateway();let sim,real;try{
  const data=await seed(g.db),key=randomUUID();sim=await open(g,data,'simulado');const old=await(await sim.post(key)).json();assert.equal(old.correo.estado,'simulado');await sim.close();sim=undefined;
  const before=await g.db.$queryRaw`SELECT to_jsonb(c) AS fila FROM public.gaona_web_correos c WHERE solicitud_id=${old.id}`;
  real=await open(g,data);const repeated=await(await real.post(key)).json();assert.equal(repeated.id,old.id);assert.equal(repeated.correo.modo,'simulado');assert.equal(repeated.correo.estado,'simulado');assert.equal(real.calls(),0);assert.deepEqual(await g.db.$queryRaw`SELECT to_jsonb(c) AS fila FROM public.gaona_web_correos c WHERE solicitud_id=${old.id}`,before);
  const pendingKey=randomUUID(),simStore=crearPersistenciaDataApi(g.env,crearClienteDataApi(g.env,{fetch:g.fetch})),pending=await simStore.registrar(pendingKey,data,undefined);
  assert.equal(await real.store.correo.reclamar(pending.comprobante.id),null);const replay=await(await real.post(pendingKey)).json();assert.equal(replay.correo.modo,'simulado');assert.equal(real.calls(),0);
  const untouched=await g.db.$queryRaw`SELECT modo,intentos,estado FROM public.gaona_web_correos WHERE solicitud_id=${pending.comprobante.id}`;assert.deepEqual(untouched[0],{modo:'simulado',intentos:0,estado:'pendiente'});
 }finally{if(sim)await sim.close();if(real)await real.close();await g.close();}
});
test('Brevo Data API: estado incierto y reinicio no reintentan; el modo simulado no reclama correo real',{skip:!available},async()=>{
 const g=await gateway();let api,restarted;try{
  const data=await seed(g.db),key=randomUUID();api=await open(g,data,'smtp',true);const r=await(await api.post(key)).json();assert.equal(r.correo.estado,'no_confirmado');assert.equal(api.calls(),1);await api.close();api=undefined;
  restarted=await open(g,data);const again=await(await restarted.post(key)).json();assert.equal(again.id,r.id);assert.equal(again.correo.estado,'no_confirmado');assert.equal(restarted.calls(),0);
  const sim=crearPersistenciaDataApi(g.env,crearClienteDataApi(g.env,{fetch:g.fetch}));assert.equal(await sim.correo.reclamar(r.id),null);
  const rows=await g.db.$queryRaw`SELECT modo,intentos,estado FROM public.gaona_web_correos WHERE solicitud_id=${r.id}`;assert.deepEqual(rows[0],{modo:'smtp',intentos:1,estado:'no_confirmado'});
 }finally{if(api)await api.close();if(restarted)await restarted.close();await g.close();}
});

test('Brevo Data API: transporte general toma cada destinatario del registro sin lista fija',{skip:!available},async()=>{
 const g=await gateway();let api;try{
  const data=await seed(g.db);api=await open(g,data,'smtp',false,true);
  const other={...data,cliente:{...data.cliente,correo:'otra-cuenta-'+randomUUID().slice(0,8)+'@example.test'}};
  const records=[];for(const body of [data,other]){const response=await api.post(randomUUID(),body);assert.equal(response.status,201);records.push(await response.json());}
  assert.equal(api.calls(),2);for(let i=0;i<records.length;i++){
   const row=await g.db.$queryRaw`SELECT destinatario,modo,intentos FROM public.gaona_web_correos WHERE solicitud_id=${records[i].id}`;
   assert.deepEqual(row[0],{destinatario:[data,other][i].cliente.correo,modo:'smtp',intentos:1});
  }
 }finally{if(api)await api.close();await g.close();}
});
