const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {apiRequire,fixture}=require('./pdf-harness.cjs');
const {crearApiWeb}=apiRequire('./src/api-web');
const {crearEnsayoCorreoLocal,guardiaOrigenEnsayo}=apiRequire('./src/correo-ensayo-local');
const express=apiRequire('express'),nodemailer=apiRequire('nodemailer');
const sha=v=>createHash('sha256').update(v).digest('hex');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gaona-ensayo-browser-'));
 let writes=0,calls=0,last;
 const allowed='cuenta-autorizada@example.test';
 const env={NODE_ENV:'development',MAIL_ENABLED:'true',SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'usuario-ficticio',SMTP_PASSWORD:'clave-ficticia',SMTP_FROM:'gaona.proyint1@gmail.com'};
 const db={producto:{findMany:async query=>fixture.filter(p=>!query.where.id||query.where.id.in.includes(p.id))},solicitud:{create:async query=>{writes++;assert.equal(query.data.cliente.create.correo,allowed);return {id:randomUUID(),creadoEn:new Date()};}}};
 const trial=crearEnsayoCorreoLocal(dir,'smtp',{version:1,habilitado:false,remitente:env.SMTP_FROM,destinatarios:[allowed]},()=>{
  const stream=nodemailer.createTransport({streamTransport:true,buffer:true});
  return {sendMail:async message=>{calls++;const info=await stream.sendMail(message);last={message,raw:info.message};return {accepted:info.envelope.to,rejected:[],messageId:info.messageId};},close:()=>stream.close()};
 });
 const app=express();app.use(guardiaOrigenEnsayo(true));app.use(crearApiWeb(db,env,false,trial.fabrica,trial.politica));app.use(express.static(path.resolve(__dirname,'../Página')));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await apiRequire('playwright').chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.name));
 try{
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
   if(u.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:`const API_URL=${JSON.stringify(base)};`});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:5500/cotizacion.html?producto=simulado-1');
  await page.waitForFunction(()=>document.querySelector('[name="producto"]')?.value==='simulado-1');
  for(const [name,value] of Object.entries({nombre:'Cliente',apellido:'Ficticio',telefono:'0000000000',correo:'no-autorizado@example.test'}))await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('#submitQuote').click();await page.locator('#quoteError:visible').waitFor();
  assert.match(await page.locator('#quoteError').textContent(),/no está autorizado/);assert.equal(writes,0);assert.equal(calls,0);
  await page.locator('[name="correo"]').fill(allowed);
  const wait=page.waitForResponse(r=>r.url()===base+'/solicitudes'&&r.request().method()==='POST');
  await page.locator('#submitQuote').click();const response=await wait;assert.equal(response.status(),201);const receipt=await response.json();
  await page.waitForFunction(()=>document.querySelector('#mailStatus').textContent.includes('aceptó el mensaje'));
  assert.match(await page.locator('#mailStatus').textContent(),/entrega final todavía no está confirmada/);
  assert.equal(writes,1);assert.equal(calls,1);assert.deepEqual(last.message.envelope.to,[allowed]);
  const download=page.waitForEvent('download');await page.locator('#downloadPdf').click();const pdf=await fs.readFile(await (await download).path());
  assert.equal(sha(pdf),sha(last.message.attachments[0].content));
  assert.ok(!last.raw.toString().includes(env.SMTP_PASSWORD));
  const missingOrigin=await fetch(base+'/solicitudes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(missingOrigin.status,403);
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium: ensayo SMTP inyectado con Stream Transport, rechazo de dirección ajena sin registro, destinatario exacto, aceptación distinta de entrega, PDF SHA-256 y origen restringido; cero SMTP externo.');
 }finally{await page.close();await browser.close();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true});}
})().catch(e=>{console.error('Fallo ensayo Chromium:',e.name,e.stack?.match(/web-local-correo\.browser\.cjs:\d+:\d+/g)?.join(' '));process.exitCode=1;});
