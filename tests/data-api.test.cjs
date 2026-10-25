const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {gateway,env,uid,req}=require('./data-api-fixture.cjs');
process.env.SOLICITUD_PDF_KEY=env.SOLICITUD_PDF_KEY;
const {crearClienteDataApi,crearPersistenciaDataApi,crearEnsayoDataApi}=req('./src/data-api');
const {crearApiWeb}=req('./src/api-web');
const {crearEnsayoCorreoLocal}=req('./src/correo-ensayo-local');
const sha=b=>createHash('sha256').update(b).digest('hex');
const available=!!process.env.GAONA_DATA_API_TEST_ADMIN_URL;
const input=()=>({cliente:{nombre:'Cliente ficticio',apellido:'Data API aislada',telefono:'+15555550101',correo:'recepcion@example.test'},descripcion:'PRUEBA AISLADA '+randomUUID(),whatsappConsentimiento:false,productos:[{idProducto:'data-api-aislado',cantidad:2}]});
async function seed(db){await db.categoria.upsert({where:{id:'data-api-aislada'},create:{id:'data-api-aislada',nombre:'PRUEBA AISLADA'},update:{}});await db.producto.upsert({where:{id:'data-api-aislado'},create:{id:'data-api-aislado',idCategoria:'data-api-aislada',nombre:'PRODUCTO FICTICIO SOLO PRUEBAS',precioDesde:'125.50'},update:{activo:true,precioDesde:'125.50'}});}
function client(g){return crearClienteDataApi(g.env,{fetch:g.fetch,ahora:g.ahora});}
test('Data API: rechaza secretos elevados, proyecto ajeno y configuración incompleta sin conectar',()=>{
 const {validarDataApi}=require('../api/scripts/config-data-api.cjs');
 for(const patch of [{SUPABASE_PUBLISHABLE_KEY:'sb_secret_no_permitido'},{SUPABASE_URL:'https://otro.supabase.co'},{SUPABASE_AUTH_UID:''},{SOLICITUD_PDF_KEY:''}])assert.throws(()=>validarDataApi({...env,...patch}),/WEB_DATA_API/);
});
test('Data API: sesión de identidad exclusiva, renovación única concurrente y cero llamadas SMTP', {skip:!available},async()=>{
 const g=await gateway();try{
  const c=client(g);await seed(g.db);await Promise.all([c.catalogo(),c.catalogo(),c.catalogo()]);assert.deepEqual(g.contar(),{passwords:1,refreshes:0});
  g.avanzar();await Promise.all([c.catalogo(),c.catalogo(),c.catalogo()]);assert.deepEqual(g.contar(),{passwords:1,refreshes:1});assert.equal(g.counters.external,0);
  g.otraIdentidad();await assert.rejects(client(g).catalogo(),/No se pudo confirmar/);
 }finally{await g.close();}
});
test('Data API: RLS niega otra identidad, anon y operaciones administrativas; rol y datos previos intactos',{skip:!available},async()=>{
 const g=await gateway();try{
  await g.db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true)`;
   assert.equal((await tx.$queryRaw`SELECT count(*) AS n FROM public.gaona_web_configuracion`)[0].n,0n);
   assert.equal((await tx.$queryRaw`SELECT count(*) AS n FROM public.productos`)[0].n,0n);
   assert.equal((await tx.$queryRaw`SELECT count(*) AS n FROM public.clientes`)[0].n,0n);
  });
  await assert.rejects(g.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true)`;return tx.$queryRaw`SELECT public.gaona_web_operacion('verificar','{}'::jsonb)`;}),e=>e.meta?.code==='42501');
  for(const role of ['authenticated','anon','service_role']){
   const rows=await g.db.$queryRaw`SELECT has_table_privilege(${role},'public.gaona_web_registros','TRUNCATE') AS truncar,has_table_privilege(${role},'public.gaona_web_documentos','DELETE') AS borrar`;
   assert.equal(rows[0].truncar,false);assert.equal(rows[0].borrar,false);
  }
  await assert.rejects(g.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE anon');return tx.$queryRaw`SELECT public.gaona_web_operacion('verificar','{}'::jsonb)`;}));
  assert.deepEqual(await g.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${uid},true)`;return tx.$queryRaw`SELECT correo FROM public.usuarios`;}),[]);
  const f=await g.db.$queryRaw`SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='gaona_web_operacion'`;assert.equal(f[0].prosecdef,false);
  const roles=await g.db.$queryRaw`SELECT rolcanlogin,rolbypassrls,rolsuper FROM pg_roles WHERE rolname='authenticated'`;assert.deepEqual(roles[0],{rolcanlogin:false,rolbypassrls:false,rolsuper:false});
 }finally{await g.close();}
});
test('Data API: solo la RPC puede escribir; DML directo, escalamiento y suplantación denegados',{skip:!available},async()=>{
 const g=await gateway();try{
  const asRole=(role,statement,identity=uid)=>g.db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET LOCAL ROLE '+role);
   await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${identity},true)`;
   return tx.$queryRawUnsafe(statement);
  });
  for(const [table,column]of [['gaona_web_configuracion','version'],['gaona_web_registros','huella'],['gaona_web_documentos','intentos'],['gaona_web_correos','intentos']]){
   for(const sql of [`INSERT INTO public.${table} DEFAULT VALUES`,`UPDATE public.${table} SET ${column}=${column}`,`DELETE FROM public.${table}`,`TRUNCATE public.${table}`]){
    await assert.rejects(asRole('authenticated',sql),e=>e.meta?.code==='42501');
   }
  }
  for(const table of ['gaona_web_registros','gaona_web_documentos','gaona_web_correos'])await assert.rejects(asRole('authenticated',`SELECT * FROM public.${table}`),e=>e.meta?.code==='42501');
  for(const role of ['anon','service_role'])await assert.rejects(asRole(role,`SELECT gaona_web_interno.operacion('verificar','{}'::jsonb)`),e=>e.meta?.code==='42501');
  await assert.rejects(asRole('authenticated',`SELECT gaona_web_interno.operacion('verificar','{}'::jsonb)`,'00000000-0000-4000-8000-000000000002'),e=>e.meta?.code==='42501');
  await assert.rejects(asRole('authenticated',`SELECT public.gaona_web_operacion('verificar','{}'::jsonb)`,''),e=>e.meta?.code==='42501');
  await assert.rejects(asRole('authenticated',`SELECT public.gaona_web_operacion('operacion_arbitraria','{}'::jsonb)`),e=>e.meta?.code==='42501');
  await assert.rejects(asRole('authenticated',`CREATE FUNCTION gaona_web_interno.intruso() RETURNS int LANGUAGE sql AS 'SELECT 1'`),e=>e.meta?.code==='42501');
  await assert.rejects(asRole('authenticated',`ALTER TABLE public.gaona_web_correos DISABLE ROW LEVEL SECURITY`),e=>e.meta?.code==='42501');
  const membership=await g.db.$queryRaw`SELECT pg_has_role('authenticated','gaona_local_admin','MEMBER') AS miembro`;assert.equal(membership[0].miembro,false);
  const funcs=await g.db.$queryRaw`SELECT n.nspname,p.prosecdef,p.proconfig,pg_has_role('authenticated',p.proowner,'MEMBER') AS propietario FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE(n.nspname='gaona_web_interno' AND p.proname='operacion') OR(n.nspname='public' AND p.proname='gaona_web_operacion') ORDER BY n.nspname`;
  assert.deepEqual(funcs.map(f=>[f.nspname,f.prosecdef,f.propietario]),[['gaona_web_interno',true,false],['public',false,false]]);
  for(const f of funcs)assert.deepEqual(f.proconfig,['search_path=pg_catalog, pg_temp']);
  const guarded=await g.db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${uid},true)`;
   await tx.$executeRawUnsafe('CREATE TEMP TABLE gaona_web_configuracion(id int,backend_uid uuid)');
   await tx.$executeRawUnsafe('CREATE TEMP TABLE productos(id text)');
   return tx.$queryRaw`SELECT public.gaona_web_operacion('verificar','{}'::jsonb) AS resultado`;
  });assert.equal(guarded[0].resultado.seguridad,true);
  for(const table of ['clientes','solicitudes','solicitud_detalles']){
   await assert.rejects(asRole('authenticated',`INSERT INTO public.${table}(id) VALUES ('intruso')`),e=>e.meta?.code==='42501');
   assert.deepEqual(await asRole('authenticated',`SELECT id FROM public.${table}`),[]);
  }
  assert.equal(g.counters.external,0);
 }finally{await g.close();}
});
test('Data API: verificación bloquea permisos directos residuales y políticas compartidas inesperadas',{skip:!available},async()=>{
 const g=await gateway();try{
  const run=async mutate=>{
   await assert.rejects(g.db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(mutate);
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${uid},true)`;
    const r=await tx.$queryRaw`SELECT public.gaona_web_operacion('verificar','{}'::jsonb) AS resultado`;
    assert.equal(r[0].resultado.seguridad,false);throw Error('ROLLBACK_PRUEBA_AISLADA');
   }),/ROLLBACK_PRUEBA_AISLADA/);
  };
  await run('GRANT UPDATE(intentos) ON public.gaona_web_correos TO authenticated');
  await run('CREATE POLICY permiso_inesperado ON public.clientes FOR INSERT TO authenticated WITH CHECK(true)');
  assert.equal(await crearPersistenciaDataApi(g.env,client(g)).disponible(),true);
 }finally{await g.close();}
});
test('Data API: RPC atómica, concurrencia, idempotencia tras reinicio y PDF canónico SHA-256',{skip:!available},async()=>{
 const g=await gateway();try{
  await seed(g.db);const c=client(g),store=crearPersistenciaDataApi(g.env,c);assert.equal(await store.disponible(),true);const data=input(),key=randomUUID();
  const before=await g.db.solicitud.count();const results=await Promise.all(Array.from({length:6},()=>store.registrar(key,data,undefined)));assert.equal(new Set(results.map(r=>r.comprobante.id)).size,1);
  const first=results[0].comprobante;assert.deepEqual([first.estimado.subtotal,first.estimado.iva,first.estimado.total],['251.00','40.16','291.16']);
  const pdfs=await Promise.all([store.documento(first),store.documento(first),store.documento(first)]);assert.equal(new Set(pdfs.map(sha)).size,1);
  const restarted=crearPersistenciaDataApi(g.env,client(g));assert.equal((await restarted.registrar(key,data,undefined)).comprobante.id,first.id);assert.equal(sha(await restarted.documento(first)),sha(pdfs[0]));
  await assert.rejects(restarted.registrar(key,{...data,descripcion:'otro contenido'},undefined),e=>e.codigo===409);
  assert.equal(await g.db.solicitud.count(),before+1);
  const rows=await g.db.$queryRaw`SELECT (SELECT count(*) FROM public.gaona_web_registros WHERE solicitud_id=${first.id}) AS registros,(SELECT intentos FROM public.gaona_web_documentos WHERE solicitud_id=${first.id}) AS intentos`;
  assert.equal(rows[0].registros,1n);assert.equal(rows[0].intentos,1);
  const core=await g.db.solicitud.findUnique({where:{id:first.id},include:{detalles:true,cliente:true}});assert.equal(core.origen,'WEB');assert.equal(core.detalles.length,1);assert.equal(core.cliente.correo,data.cliente.correo);
  await g.db.$transaction(async tx=>{await tx.solicitudDetalle.deleteMany({where:{idSolicitud:first.id}});await tx.solicitud.delete({where:{id:first.id}});await tx.cliente.delete({where:{id:core.idCliente}});});
  assert.equal((await restarted.registrar(key,data,undefined)).comprobante.id,first.id);assert.equal(sha(await restarted.documento(first)),sha(pdfs[0]));
  assert.equal(await g.db.solicitud.count(),before);
  await assert.rejects(g.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${uid},true)`;return tx.$executeRaw`UPDATE public.gaona_web_documentos SET pdf_sha256=${'0'.repeat(64)} WHERE solicitud_id=${first.id}`;}));
 }finally{await g.close();}
});
test('Data API: rollback completo cuando falla una parte del registro y precio no controlado por cliente',{skip:!available},async()=>{
 const g=await gateway();try{
  await seed(g.db);const c=client(g),store=crearPersistenciaDataApi(g.env,c);const data=input();data.cliente.correo='x';
  const before=await g.db.$queryRaw`SELECT count(*) AS n FROM public.gaona_web_registros`;
  await assert.rejects(store.registrar(randomUUID(),data,undefined));assert.deepEqual(await g.db.$queryRaw`SELECT count(*) AS n FROM public.gaona_web_registros`,before);
  await assert.rejects(c.operacion('registrar',{clave:'f'.repeat(64),huella:'d'.repeat(64),origen:'a'.repeat(64),datos:input(),comprobante:{id:randomUUID(),cliente:input().cliente,estimado:{productos:[{idProducto:'data-api-aislado',cantidad:2,precioUnitario:'0.01',importe:'0.02'}],subtotal:'0.02',iva:'0.00',total:'0.02'}}}),e=>e.codigo===400);
 }finally{await g.close();}
});
test('Data API: formulario, PDF y correo Stream Transport usan el mismo documento y destinatario',{skip:!available},async()=>{
 const g=await gateway();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-data-api-correo-'));fs.chmodSync(dir,0o700);let api,front,browser;
 try{
  await seed(g.db);const c=client(g),store=crearPersistenciaDataApi(g.env,c),transport=crearEnsayoDataApi(dir,c);
  const mail={...g.env,MAIL_ENABLED:'true',SMTP_HOST:'smtp.simulado.invalid',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'ficticio',SMTP_PASSWORD:'ficticia',SMTP_FROM:'gaona@example.test'};
  api=http.createServer(crearApiWeb(undefined,mail,false,transport.fabrica,transport.politica,{catalogo:()=>c.catalogo(),persistencia:store}));await new Promise(r=>api.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+api.address().port;
  front=http.createServer(req('express')().use(req('express').static(path.join(__dirname,'../Página'))));await new Promise(r=>front.listen(0,'127.0.0.1',r));
  const {chromium}=req('playwright');browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});const page=await browser.newPage({acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:`const API_URL=${JSON.stringify(base)};`}));
  await page.goto('http://127.0.0.1:'+front.address().port+'/cotizacion.html?producto=data-api-aislado');await page.waitForFunction(()=>document.querySelector('[name="producto"]')?.value==='data-api-aislado');
  const data=input();data.cliente.correo='navegador-ficticio-'+randomUUID().slice(0,8)+'@example.test';for(const [name,value]of Object.entries(data.cliente))await page.locator(`[name="${name}"]`).fill(value);await page.locator('[name="cantidad"]').fill('2');
  const wait=page.waitForResponse(r=>r.url()===base+'/solicitudes'&&r.request().method()==='POST');await page.locator('#submitQuote').click();const response=await wait;assert.equal(response.status(),201);const record=await response.json();assert.ok(!JSON.stringify(record).includes(env.SUPABASE_PUBLISHABLE_KEY));assert.ok(!JSON.stringify(record).includes(env.SUPABASE_AUTH_PASSWORD));assert.equal(response.request().headers().authorization,undefined);
  try { await page.getByText('Simulación local completada: correo y PDF preparados. No se envió ningún mensaje externo.',{exact:true}).waitFor(); } catch { const state=await g.db.$queryRaw`SELECT estado,intentos,codigo_error FROM public.gaona_web_correos WHERE solicitud_id=${record.id}`;throw Error(JSON.stringify({estado_interfaz:await page.locator('#mailStatus').textContent(),state,registro:record.correo})); }
  const waitPdf=page.waitForEvent('download');await page.locator('#downloadPdf').click();const download=await waitPdf;const pdf=fs.readFileSync(await download.path());
  const mime=fs.readFileSync(path.join(dir,`correo-simulado-${record.id}.eml`),'utf8');assert.ok(mime.includes('To: '+data.cliente.correo));
  const encoded=mime.split(/Content-Type: application\/pdf/i)[1].split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g,'');assert.equal(sha(Buffer.from(encoded,'base64')),sha(pdf));
  const jobs=await g.db.$queryRaw`SELECT intentos,modo FROM public.gaona_web_correos WHERE solicitud_id=${record.id}`;assert.deepEqual(jobs[0],{intentos:1,modo:'simulado'});
  assert.equal((await fetch(base+'/clientes')).status,404);assert.equal((await fetch(base+'/empleados')).status,404);
  const denied=await fetch(base+'/solicitudes/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"token":"invalido"}'});assert.equal(denied.status,403);assert.deepEqual(errors,[]);assert.equal(g.counters.external,0);
 }finally{if(browser)await browser.close();for(const s of [api,front])if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}await g.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Data API: respaldo y restauración aislada conservan documentos, cotizaciones y RPC',{skip:!available},async()=>{
 const g=await gateway(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-data-api-respaldo-'));fs.chmodSync(dir,0o700);
 try{
  const url=new URL(process.env.GAONA_DATA_API_TEST_ADMIN_URL),bin=process.env.PG_BIN||spawnSync('pg_config',['--bindir'],{encoding:'utf8'}).stdout.trim();
  const pgEnv={PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:url.port,PGUSER:'gaona_local_admin',PGDATABASE:'gaona_data_api_aislada'};
  const backup=path.join(dir,'respaldo.dump');let r=spawnSync(path.join(bin,'pg_dump'),['-Fc','-f',backup],{env:pgEnv,encoding:'utf8'});assert.equal(r.status,0);fs.chmodSync(backup,0o600);
  r=spawnSync(path.join(bin,'createdb'),['gaona_data_api_restaurada'],{env:pgEnv,encoding:'utf8'});assert.equal(r.status,0);
  r=spawnSync(path.join(bin,'pg_restore'),['--exit-on-error','--no-owner','-d','gaona_data_api_restaurada',backup],{env:pgEnv,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const query="SELECT count(*)::text||':'||coalesce(string_agg(pdf_sha256,',' ORDER BY solicitud_id),'') FROM public.gaona_web_documentos";
  const original=spawnSync(path.join(bin,'psql'),['-XAt','-c',query],{env:pgEnv,encoding:'utf8'});const restored=spawnSync(path.join(bin,'psql'),['-XAt','-c',query],{env:{...pgEnv,PGDATABASE:'gaona_data_api_restaurada'},encoding:'utf8'});assert.equal(restored.status,0);assert.equal(restored.stdout,original.stdout);
 }finally{await g.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Data API: una respuesta 401 no repite automáticamente una operación de escritura',async()=>{
 let auths=0,operations=0;const token=['e30',Buffer.from(JSON.stringify({sub:uid,role:'authenticated',iss:env.SUPABASE_URL+'/auth/v1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'ficticio'].join('.');
 const c=crearClienteDataApi(env,{fetch:async url=>{
  if(String(url).includes('/auth/v1/token')){auths++;return new Response(JSON.stringify({access_token:token,refresh_token:'renovacion-ficticia',user:{id:uid}}),{status:200});}
  operations++;return new Response('{}',{status:401});
 }});
 await assert.rejects(c.operacion('registrar',{clave:'a'.repeat(64)}));assert.equal(auths,1);assert.equal(operations,1);
});
test('Data API: respuesta perdida y otro backend recuperan el folio sin perder ni repetir el correo simulado',{skip:!available},async()=>{
 const g=await gateway(),dirs=[];let server;
 try{
  await seed(g.db);const c=client(g),store=crearPersistenciaDataApi(g.env,c),data=input(),key=randomUUID();data.cliente.correo='recuperacion-ficticia-'+randomUUID().slice(0,8)+'@example.test';
  const original=await store.registrar(key,data,undefined);
  const open=async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-data-api-reinicio-'));dirs.push(dir);const transport=crearEnsayoDataApi(dir,c);
   server=http.createServer(crearApiWeb(undefined,{...g.env,MAIL_ENABLED:'true',SMTP_HOST:'smtp.simulado.invalid',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'ficticio',SMTP_PASSWORD:'ficticia',SMTP_FROM:'gaona@example.test'},false,transport.fabrica,transport.politica,{catalogo:()=>c.catalogo(),persistencia:store}));await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};
  const post=base=>fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(data)});
  let response=await post(await open());assert.equal(response.status,201);let record=await response.json();assert.equal(record.id,original.comprobante.id);assert.equal(record.correo.estado,'simulado');
  server.closeAllConnections();await new Promise(r=>server.close(r));server=undefined;
  response=await post(await open());assert.equal(response.status,201);record=await response.json();assert.equal(record.id,original.comprobante.id);assert.equal(record.correo.estado,'simulado');
  assert.equal(fs.readdirSync(dirs[0]).filter(p=>p.endsWith('.eml')).length,1);assert.equal(fs.readdirSync(dirs[1]).filter(p=>p.endsWith('.eml')).length,0);
  const jobs=await g.db.$queryRaw`SELECT intentos FROM public.gaona_web_correos WHERE solicitud_id=${record.id}`;assert.equal(jobs[0].intentos,1);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await g.close();for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});}
});
