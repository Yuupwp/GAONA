const assert=require('node:assert/strict'),path=require('node:path');
const {laboratorio,data,sha}=require('./smtp-permanente-fixture.cjs');
const {req}=require('./data-api-fixture.cjs');
(async()=>{
 const lab=laboratorio(),api=await lab.abrir();
 api.app.use(req('express').static(path.resolve(__dirname,'../Página')));
 const browser=await req('playwright').chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{
  const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.origin!==api.base)return route.abort();
   if(url.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:`const API_URL = ${JSON.stringify(api.base)};`});
   if(request.method()==='POST'){const response=await route.fetch({headers:{...request.headers(),origin:'http://127.0.0.1:5500'}});return route.fulfill({response});}
   return route.continue();
  });
  await page.goto(api.base+'/Catalogo.html');await page.locator('a.quote-button').first().click();
  await page.waitForFunction(()=>document.querySelector('[name="producto"]')?.value==='aislado');
  const input=data('recepcion@outlook.com');for(const [name,value]of Object.entries({...input.cliente,cantidad:'2'}))await page.locator(`[name="${name}"]`).fill(value);
  const response=page.waitForResponse(r=>r.url()===api.base+'/solicitudes'&&r.request().method()==='POST');await page.locator('#submitQuote').click();const r=await response;assert.equal(r.status(),201);const record=await r.json();
  await page.locator('#quoteSuccess:visible').waitFor();assert.equal(record.correo.modo,'smtp');assert.ok(['pendiente','aceptado'].includes(record.correo.estado));
  await page.waitForFunction(()=>document.getElementById('mailStatus').textContent.includes('aceptó el mensaje'));
  const status=await(await api.post('/solicitudes/correo/estado',{token:record.pdf.token})).json();assert.equal(status.estado,'aceptado');assert.equal(record.estimado.total,'805.62');assert.equal(api.calls(),1);
  assert.match(await page.locator('#quoteSuccess').textContent(),/acept|SMTP/i);assert.equal(await page.locator('#whatsappConsentimiento,#whatsappHint').count(),0);
  const downloading=page.waitForEvent('download');await page.locator('#downloadPdf').click();const download=await downloading;assert.equal(await download.failure(),null);const pdf=require('node:fs').readFileSync(await download.path());
  assert.equal(sha(pdf),sha(lab.mensajes[0].message.attachments[0].content));assert.equal(lab.mensajes[0].message.to.address,input.cliente.correo);assert.deepEqual(errors,[]);
  console.log('PASS: Chromium catálogo → formulario → RPC simulada → PDF canónico → Brevo con Stream Transport, destinatario correcto y estado aceptado sin afirmar entrega. Cero conexiones SMTP externas.');
 }finally{await browser.close();await api.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
