const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {createInterface}=require('node:readline/promises');
require('tsx/cjs');
const nodemailer=require('nodemailer');
const {Prisma}=require('@prisma/client');
const {configurarSmtp,crearServicioCorreo}=require('../src/solicitud-correo');
const {correoValido}=require('../src/solicitud-correo-validacion');
const {calcularEstimado}=require('../src/solicitud-estimado');
const {generarSolicitudPdf}=require('../src/solicitud-pdf');
const {observarTransporte}=require('./brevo-diagnostico.cjs');
const root=path.resolve(__dirname,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{seguro:true});};
function privado(file,directory=false){
 const s=fs.lstatSync(file);
 if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile())||s.uid!==process.getuid()||(s.mode&0o077))fail('SMTP_PRIVADO: Archivo o directorio inseguro');
}
function leer(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077))fail('SMTP_PRIVADO: Archivo inseguro');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function guardar(file,value){
 const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
function configurar(env){
 if(env.NODE_ENV&&env.NODE_ENV!=='development')fail('SMTP_PRODUCCION: Ensayo exclusivo de desarrollo');
 if(env.SMTP_HOST!=='smtp-relay.brevo.com'||env.SMTP_PORT!=='587'||env.SMTP_SECURE!=='false'||/^xkeysib-/i.test(env.SMTP_PASSWORD||''))fail('SMTP_BREVO: Revisa host, puerto, STARTTLS y tipo de clave');
 const value={NODE_ENV:'development',MAIL_ENABLED:'true',WHATSAPP_ENABLED:'false',...Object.fromEntries(['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'].map(k=>[k,env[k]]))};
 if(!configurarSmtp(value))fail('SMTP_CONFIGURACION: Revisa SMTP_USER, SMTP_PASSWORD y SMTP_FROM sin mostrar sus valores');
 return value;
}
function entorno(file=path.join(root,'api/.env')){return configurar(require('dotenv').parse(leer(file)));}
function fabricaBrevo(env,destinatario,crear=opciones=>nodemailer.createTransport(opciones),observar=()=>{}){
 const config=configurarSmtp(configurar(env));
 if(!correoValido.safeParse(destinatario).success)fail('SMTP_DESTINATARIO: Se requiere exactamente una dirección válida');
 return ()=>{
  let usado=false,transporte;
  return {async sendMail(mensaje){
   if(usado)fail('SMTP_INTENTO: No se permiten reintentos');usado=true;
   if(mensaje.to?.address!==destinatario||mensaje.from?.address!==config.from||mensaje.cc||mensaje.bcc||mensaje.replyTo||
    JSON.stringify(mensaje.envelope)!==JSON.stringify({from:config.from,to:[destinatario]})||mensaje.attachments?.length!==1||
    !Buffer.isBuffer(mensaje.attachments[0].content)||mensaje.attachments[0].content.subarray(0,5).toString()!=='%PDF-'||
    mensaje.attachments[0].content.length>2097152||mensaje.attachments[0].path||mensaje.attachments[0].href||mensaje.raw)fail('SMTP_MENSAJE: Destino o adjunto no autorizado');
   const options={...config.opciones,dnsTimeout:10000,connectionTimeout:15000};
   transporte=crear(options);
   return observarTransporte(transporte,options,destinatario,()=>{},observar).transporte.sendMail(mensaje);
  },close(){transporte?.close();}};
 };
}
function fabricaCotizacionesBrevo(env,crear){
 configurar(env);
 return ()=>{
  let transporte,usado=false;
  return {async sendMail(mensaje){
   if(usado)fail('SMTP_INTENTO: No se permiten reintentos');usado=true;
   transporte=fabricaBrevo(env,mensaje.to?.address,crear)();return transporte.sendMail(mensaje);
  },close(){transporte?.close();}};
 };
}
async function preparar(base,env,destinatario){
 env=configurar(env);if(!correoValido.safeParse(destinatario).success)fail('SMTP_DESTINATARIO: Dirección no válida');
 fs.mkdirSync(base,{recursive:true,mode:0o700});privado(base,true);
 const relative=path.relative(root,fs.realpathSync(base));if(relative!=='..'&&!relative.startsWith('..'+path.sep))fail('SMTP_PRIVADO: Las pruebas deben permanecer fuera del repositorio');
 const id=randomUUID(),dir=path.join(base,id);fs.mkdirSync(dir,{mode:0o700});
 const data={id,fecha:new Date().toISOString(),cliente:{nombre:'Cliente ficticio',apellido:'Prueba SMTP',telefono:'+15555550101',correo:destinatario},descripcion:'PRUEBA FICTICIA SMTP. Sin pedido comercial.',
  estimado:calcularEstimado([{idProducto:'prueba-ficticia',cantidad:2}],[{id:'prueba-ficticia',nombre:'Producto ficticio de prueba',precioDesde:new Prisma.Decimal('125.50')}])};
 const pdf=await generarSolicitudPdf(data);let mime,calls=0;
 const servicio=crearServicioCorreo(env,fabricaBrevo(env,destinatario,options=>{
  if(!options.requireTLS||!options.tls.rejectUnauthorized)fail('SMTP_TLS: Configuración insegura');
  const stream=nodemailer.createTransport({streamTransport:true,buffer:true});
  return {async sendMail(message){calls++;const r=await stream.sendMail(message);mime=r.message;return {accepted:[destinatario],rejected:[],messageId:r.messageId};},close(){stream.close();}};
 }));
 if((await servicio(data,'127.0.0.1',async()=>pdf)).estado!=='aceptado')fail('SMTP_SIMULACION: Simulación rechazada');
 await servicio(data,'127.0.0.1',async()=>pdf);
 if(calls!==1||!mime||!mime.includes(Buffer.from(destinatario)))fail('SMTP_SIMULACION: MIME o idempotencia inválidos');
 const resumen={version:1,id,remitente:env.SMTP_FROM,destinatario,asunto:`GAONA | Solicitud de cotización - ${id}`,pdf:`GAONA-Solicitud-${id}.pdf`,total:data.estimado.total,sha256:sha(pdf),comprobante_sha256:sha(JSON.stringify(data)),mime_sha256:sha(mime),intentos_reales:0};
 guardar(path.join(dir,'comprobante.json'),JSON.stringify(data));guardar(path.join(dir,'documento.pdf'),pdf);guardar(path.join(dir,'mensaje-simulado.eml'),mime);
 guardar(path.join(dir,'resumen.json'),JSON.stringify(resumen));return {dir,resumen};
}
async function enviar(dir,env,confirmacion,crear,observar){
 privado(dir,true);const resumen=JSON.parse(leer(path.join(dir,'resumen.json'))),data=JSON.parse(leer(path.join(dir,'comprobante.json'))),pdf=leer(path.join(dir,'documento.pdf'));
 env=configurar(env);
 if(confirmacion!==`AUTORIZO UN ENVIO SMTP ${resumen.id}`)fail('SMTP_CONFIRMACION: No se recibió la autorización exacta');
 if(!/^[a-f\d-]{36}$/.test(resumen.id)||path.basename(dir)!==resumen.id||resumen.asunto!==`GAONA | Solicitud de cotización - ${resumen.id}`||resumen.pdf!==`GAONA-Solicitud-${resumen.id}.pdf`||resumen.total!==data.estimado.total||data.id!==resumen.id||data.cliente.correo!==resumen.destinatario||env.SMTP_FROM!==resumen.remitente||sha(JSON.stringify(data))!==resumen.comprobante_sha256||sha(pdf)!==resumen.sha256||sha(leer(path.join(dir,'mensaje-simulado.eml')))!==resumen.mime_sha256||resumen.intentos_reales!==0)fail('SMTP_INTEGRIDAD: Se conserva la prueba sin enviarla');
 try{guardar(path.join(dir,'intento-reservado.json'),JSON.stringify({id:resumen.id,intentos:1,fecha:new Date().toISOString()}));}catch(e){if(e.code==='EEXIST')fail('SMTP_INTENTO: Ya existe una reserva; no se reenvía');throw e;}
 let diagnostico;
 const factory=fabricaBrevo(env,resumen.destinatario,crear,d=>{diagnostico={...d};observar?.(d);});
 const result=await crearServicioCorreo(env,factory)(data,'127.0.0.1',async()=>pdf);
 const registro={id:resumen.id,estado:result.estado,intentos:1,entrega:'no_verificada',diagnostico};guardar(path.join(dir,'resultado.json'),JSON.stringify(registro));return registro;
}
async function main(){
 if(process.versions.node.split('.')[0]!=='24')fail('SMTP_NODE: Activa Node.js 24');
 const mode=process.argv[2];if(!['simular','prueba','enviar'].includes(mode)||process.argv.length!==(mode==='enviar'?4:3))fail('SMTP_USO: Usa simular|prueba|enviar ID');
 if(!process.stdin.isTTY||!process.stdout.isTTY)fail('SMTP_TERMINAL: Se requiere una terminal privada interactiva');
 const env=entorno(),base=path.join(os.homedir(),'.gaona-smtp-pruebas',sha(root).slice(0,16));
 fs.mkdirSync(path.dirname(base),{recursive:true,mode:0o700});privado(path.dirname(base),true);
 const rl=createInterface({input:process.stdin,output:process.stdout});let dir,resumen;
 try{
  if(mode==='enviar'){
   if(!/^[a-f\d-]{36}$/.test(process.argv[3]))fail('SMTP_ID: Identificador inválido');
   dir=path.join(base,process.argv[3]);privado(base,true);privado(dir,true);resumen=JSON.parse(leer(path.join(dir,'resumen.json')));
  }else{
   const to=(await rl.question('Único correo que controlas o cuyo propietario autorizó la prueba: ')).trim();
   ({dir,resumen}=await preparar(base,env,to));
  }
  console.log(JSON.stringify(resumen,null,2));
  if(mode==='simular'){console.log(`Sin envíos. Para autorizar después: npm run web:smtp:enviar -- ${resumen.id}`);return;}
  const confirmation=await rl.question(`Se permitirá un solo intento, sin Supabase ni reintentos. Escribe AUTORIZO UN ENVIO SMTP ${resumen.id}: `);
  const result=await enviar(dir,env,confirmation);console.log(JSON.stringify({prueba:result.id,estado:result.estado,intentos:result.intentos,entrega:result.entrega}));
 }finally{rl.close();}
}
module.exports={configurar,entorno,fabricaBrevo,fabricaCotizacionesBrevo,preparar,enviar};
if(require.main===module)main().catch(e=>{console.error(e.seguro?e.message:'SMTP_PRUEBA: Operación detenida; conserva la prueba y no reintentes automáticamente. No se muestran secretos');process.exitCode=1;});
