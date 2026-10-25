const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const source = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gaona-instalacion-'));
const root = path.join(work, 'proyecto');
const home = path.join(work, 'home');
fs.mkdirSync(home, { mode: 0o700 });
fs.mkdirSync(root,{recursive:true});
const indexed=spawnSync('git',['ls-files','--cached','-z'],{cwd:source,encoding:'utf8'});
assert.equal(indexed.status,0,'La instalación limpia requiere el inventario preparado de Git');
for(const name of indexed.stdout.split('\0').filter(Boolean)){
 assert.ok(!path.isAbsolute(name)&&!name.split('/').includes('..'));
 assert.ok(!name.split('/').some(n=>n==='node_modules'||n==='.env'||n==='desarrollo-local.json'||n==='desarrollo-compartido.json'));
 const file=path.join(source,name),target=path.join(root,name);assert.ok(fs.lstatSync(file).isFile());fs.mkdirSync(path.dirname(target),{recursive:true});
 const content=spawnSync('git',['show',':'+name],{cwd:source,maxBuffer:16*1024*1024});assert.equal(content.status,0);fs.writeFileSync(target,content.stdout,{mode:fs.statSync(file).mode&0o777});
}
const env = { PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, PG_BIN: process.env.PG_BIN, NODE_ENV: 'development' };
const sha = b => createHash('sha256').update(b).digest('hex');
const delay = ms => new Promise(r=>setTimeout(r,ms));
let browser, local, started=false;
function cmd(binary,args,options={}) {
  const r=spawnSync(binary,args,{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024,...options});
  if(r.status!==0)throw Error(`Falló ${path.basename(binary)} ${args.slice(0,2).join(' ')}: ${r.stderr||r.stdout}`);
  return r.stdout;
}
const run = mode => cmd(process.execPath,[path.join(root,'api/scripts/desarrollo-local.cjs'),mode]);
const port=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
(async()=>{
 try {
  const apiPort=await port(),frontendPort=await port();
  fs.writeFileSync(path.join(root,'api/desarrollo-local.json'),JSON.stringify({apiPort,frontendPort,pgBin:process.env.PG_BIN||''}),{mode:0o600});
  cmd(process.platform==='win32'?'npm.cmd':'npm',['run','web:instalar']);
  cmd(process.platform==='win32'?'npm.cmd':'npm',['--prefix','api','run','typecheck']);
  console.log('PASS: copia sin .env ni node_modules originales; npm ci y Prisma generate; TypeScript.');
  cmd(process.platform==='win32'?'npm.cmd':'npm',['run','web:configurar']);
  assert.equal(fs.statSync(path.join(root,'api/.env')).mode&0o777,0o600);
  const normal=spawnSync(process.execPath,[path.join(root,'api/scripts/entorno-compartido.cjs'),'verificar'],{cwd:root,env,encoding:'utf8'});assert.equal(normal.status,1);assert.match(normal.stderr,/WEB_DATA_API/);
  console.log('PASS: comandos web sin PostgreSQL habitual; plantilla privada creada; configuración incompleta rechazada antes de conectar.');
  run('preparar');run('preparar');run('verificar');
  const oldHome=process.env.HOME;process.env.HOME=home;
  local=require(path.join(root,'api/scripts/desarrollo-local.cjs'));process.env.HOME=oldHome;
  const saved=fs.readFileSync(path.join(local.directory,'runtime.json'));
  run('iniciar');started=true;run('iniciar');
  const base=`http://127.0.0.1:${apiPort}`,front=`http://127.0.0.1:${frontendPort}`;
  assert.deepEqual(await (await fetch(base+'/productos')).json(),[]);
  const req=createRequire(path.join(root,'api/package.json'));
  const {chromium}=req('playwright');
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({acceptDownloads:true});
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')route.continue();else{external.push(u.hostname);route.abort();}});
  await page.goto(front+'/Catalogo.html');await page.getByText('Por el momento no hay productos disponibles.').waitFor();
  await page.goto(front+'/cotizacion.html');assert.equal(await page.locator('#submitQuote').isDisabled(),true);
  assert.equal(await page.locator('#whatsappConsentimiento, #whatsappHint').count(),0);
  const state=JSON.parse(saved);
  const ownerSql=text=>{
    const r=spawnSync(path.join(state.pgBin,'psql'),['-X','-v','ON_ERROR_STOP=1','-At'],{env:{...env,PGHOST:'127.0.0.1',PGPORT:String(state.pgPort),PGUSER:'gaona_local_admin',PGDATABASE:'gaona_desarrollo_local',PGPASSFILE:path.join(local.directory,'pgpass')},input:text,encoding:'utf8'});
    assert.equal(r.status,0,'SQL aislado válido');return r.stdout.trim();
  };
  assert.equal(ownerSql("SELECT count(*) FROM public.productos"),'0');
  ownerSql(`INSERT INTO public.categorias(id,nombre) VALUES ('aislado','PRUEBA AUTOMATIZADA AISLADA');
    INSERT INTO public.productos(id,"idCategoria",nombre,"precioDesde") VALUES ('aislado','aislado','PRUEBA AUTOMATIZADA AISLADA',125.50);`);
  assert.equal(ownerSql("SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname='gaona_desarrollo_web'"),'f');
  await page.goto(front+'/Catalogo.html');await page.locator('a.quote-button').first().click();
  await page.waitForFunction(()=>document.querySelector('[name="producto"]')?.value==='aislado');
  for(const [name,value]of Object.entries({nombre:'Cliente ficticio',apellido:'Instalación aislada',telefono:'+15555550101',correo:'recepcion@example.test',cantidad:'2'}))await page.locator(`[name="${name}"]`).fill(value);
  const response=page.waitForResponse(r=>r.url()===base+'/solicitudes'&&r.request().method()==='POST');
  await page.locator('#submitQuote').click();const res=await response;assert.equal(res.status(),201);const record=await res.json();
  await page.locator('#quoteSuccess:visible').waitFor();await page.getByText('Simulación local completada: correo y PDF preparados. No se envió ningún mensaje externo.',{exact:true}).waitFor();
  assert.deepEqual([record.estimado.subtotal,record.estimado.iva,record.estimado.total],['251.00','40.16','291.16']);assert.equal(record.correo.modo,'simulado');const mail=await(await fetch(base+'/solicitudes/correo/estado',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:record.pdf.token})})).json();assert.equal(mail.estado,'simulado');
  const pdfRequest=token=>fetch(base+'/solicitudes/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  assert.equal((await pdfRequest('invalido')).status,403);
  const downloadWait=page.waitForEvent('download');await page.locator('#downloadPdf').click();const download=await downloadWait;assert.equal(await download.failure(),null);
  const pdf=fs.readFileSync(await download.path());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  let mime;
  for(let i=0;i<60;i++){try{mime=fs.readFileSync(path.join(local.directory,`correo-simulado-${record.id}.eml`),'utf8');break;}catch{await delay(100);}}
  assert.match(mime,/To: recepcion@example.test/);assert.ok(!mime.includes('marinpatricio449'));
  const part=mime.split(/Content-Type: application\/pdf/i)[1];assert.ok(part);const encoded=part.split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g,'');assert.equal(sha(Buffer.from(encoded,'base64')),sha(pdf));
  const info=JSON.parse(ownerSql(`SELECT json_build_object('solicitudes',(SELECT count(*) FROM public.solicitudes),'sha',(SELECT pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id='${record.id}'),'intentos',(SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id='${record.id}'))`));
  assert.equal(info.solicitudes,1);assert.equal(info.sha,sha(pdf));assert.equal(info.intentos,1);
  const original=res.request();const input=original.postData();const key=original.headers()['idempotency-key'];
  run('reiniciar');assert.deepEqual(fs.readFileSync(path.join(local.directory,'runtime.json')),saved);
  const duplicate=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:input});assert.equal(duplicate.status,201);const repeated=await duplicate.json();assert.equal(repeated.id,record.id);
  const after=await pdfRequest(record.pdf.token);assert.equal(after.status,200);assert.equal(sha(Buffer.from(await after.arrayBuffer())),sha(pdf));
  assert.equal(ownerSql('SELECT count(*) FROM public.solicitudes'),'1');assert.equal(ownerSql('SELECT intentos FROM gaona_mensajeria.correos'),'1');
  assert.ok(!fs.readdirSync(local.directory).some(p=>p.startsWith('intento-smtp-')));
  assert.deepEqual(errors,[]);
  assert.equal((await fetch(base+'/clientes')).status,404);assert.equal((await fetch(base+'/empleados')).status,404);
  const fake=path.join(work,'brevo-privado');fs.writeFileSync(fake,'SMTP_HOST=smtp-relay.brevo.com\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=usuario-ficticio\nSMTP_PASSWORD=clave-ficticia\nSMTP_FROM=remitente@example.test\n',{mode:0o600});
  cmd(process.execPath,[path.join(root,'api/scripts/desarrollo-local.cjs'),'verificar-correo',fake]);
  const collision=net.createServer();const blocker=await port();await new Promise(r=>collision.listen(blocker,'127.0.0.1',r));
  run('detener');started=false;
  fs.writeFileSync(path.join(root,'api/desarrollo-local.json'),JSON.stringify({apiPort:blocker,frontendPort,pgBin:state.pgBin}),{mode:0o600});
  const refused=spawnSync(process.execPath,[path.join(root,'api/scripts/desarrollo-local.cjs'),'iniciar'],{cwd:root,env,encoding:'utf8'});assert.notEqual(refused.status,0);assert.match(refused.stderr,/ocupado/);assert.ok(collision.listening);await new Promise(r=>collision.close(r));
  fs.writeFileSync(path.join(root,'api/desarrollo-local.json'),JSON.stringify({apiPort,frontendPort,pgBin:state.pgBin}),{mode:0o600});
  run('iniciar');started=true;
  const stopped=spawnSync(path.join(state.pgBin,'pg_ctl'),['-D',path.join(local.directory,'postgres'),'-m','fast','-w','stop'],{env,encoding:'utf8'});assert.equal(stopped.status,0);
  assert.equal(JSON.parse(run('estado')).estado,'degradado');
  run('detener');started=false;run('iniciar');started=true;run('detener');started=false;
  console.log('PASS: Chromium en instalación limpia; catálogo vacío inicial; formulario con datos SOLO aislados; totales 251.00 + 40.16 = 291.16; PDF protegido y SHA-256 MIME; idempotencia tras reinicio; SCRAM/rol restringido; SMTP simulado; Brevo validado sin red; puertos ajenos preservados; parada y nuevo arranque.');
  console.log('Copia de prueba y evidencias conservadas: '+work);
 } finally {
  if(browser)await browser.close();
  if(started)try{run('detener');}catch{console.error('Revisa el supervisor de la copia aislada; no se fuerza su cierre');}
 }
})().catch(e=>{console.error(e.message);console.error('Diagnóstico conservado: '+work);process.exitCode=1;});
