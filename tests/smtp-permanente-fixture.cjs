const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto');
const {env,req}=require('./data-api-fixture.cjs');
process.env.SOLICITUD_PDF_KEY=env.SOLICITUD_PDF_KEY;
const {crearAplicacionDataApi}=req('./src/desarrollo-compartido');
const sha=b=>createHash('sha256').update(b).digest('hex');
const mail={SMTP_HOST:'smtp-relay.brevo.com',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'usuario-ficticio',SMTP_PASSWORD:'clave-ficticia',SMTP_FROM:'gaona@example.test'};
const config={...env,...mail,MAIL_ENABLED:'true',WEB_CORREO_MODO:'smtp',WEB_HOST:'127.0.0.1',WEB_PORT:'3000'};
const data=correo=>({cliente:{nombre:'Cliente ficticio',apellido:'Prueba aislada',telefono:'+15555550101',correo},productos:[{idProducto:'aislado',cantidad:2}],descripcion:'Ensayo automatizado sin red externa'});
function laboratorio(){
 const registros=new Map(),claves=new Map(),mensajes=[];
 const productos=[{id:'aislado',nombre:'Producto de catálogo simulado',precioDesde:'347.25',descripcion:null,imagenUrl:null,categoria:{nombre:'Pruebas aisladas'}}];
 const client={catalogo:async()=>productos,async operacion(accion,a={}){
  const row=registros.get(a.id);
  if(accion==='verificar')return{version:1,seguridad:true,uid:env.SUPABASE_AUTH_UID,modo:'simulado',correo_version:2,modos_correo:['simulado','smtp'],idempotencia_huella:sha(Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY,'hex')),acceso_huella:sha(Buffer.from(env.SOLICITUD_PDF_KEY,'hex'))};
  if(['buscar','registrar'].includes(accion)){
   const old=claves.get(a.clave);if(old){if(old.huella!==a.huella)throw Error('Contenido distinto');return{comprobante:old.comprobante,repetido:true};}
   if(accion==='buscar')return null;
   const r={comprobante:a.comprobante,huella:a.huella,documento:{estado:'pendiente',comprobante:a.comprobante,intentos:0},correo:{modo:a.correo_modo,destinatario:a.comprobante.cliente.correo,estado:'pendiente',intentos:0}};
   claves.set(a.clave,r);registros.set(a.comprobante.id,r);return{comprobante:a.comprobante,repetido:false};
  }
  if(!row)throw Error('Registro inexistente');
  if(accion==='documento_leer')return row.documento;
  if(accion==='documento_reclamar'){if(row.documento.estado!=='pendiente')return false;Object.assign(row.documento,{estado:'generando',reserva:a.reserva});return true;}
  if(accion==='documento_guardar'){if(row.documento.reserva!==a.reserva)return false;Object.assign(row.documento,{estado:'disponible',pdf:a.pdf,sha:a.sha});return true;}
  const c=row.correo;
  if(accion==='correo_origen')return{modo:c.modo,destinatario:c.destinatario};
  if(accion==='correo_estado')return ['preparando','enviando'].includes(c.estado)?'pendiente':c.estado;
  if(accion==='correo_reclamar'){if(c.modo!==a.correo_modo||c.estado!=='pendiente'||c.intentos)return null;Object.assign(c,{estado:'preparando',reserva:a.reserva});return{solicitud_id:a.id,destinatario:c.destinatario,mensaje_id:`<solicitud-${a.id}@example.test>`,reserva:a.reserva};}
  if(accion==='correo_iniciar'){if(c.modo!==a.correo_modo||c.reserva!==a.reserva||c.estado!=='preparando'||c.intentos||row.documento.sha!==a.sha)return false;Object.assign(c,{estado:'enviando',intentos:1,adjunto_sha256:a.sha});return true;}
  if(accion==='correo_finalizar'){if(c.reserva!==a.reserva||c.modo!==a.correo_modo)throw Error('Reserva inválida');Object.assign(c,{estado:a.estado,codigo:a.codigo});return null;}
  throw Error('Operación no simulada');
 }};
 async function abrir(cfg=config,incierto=false){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-smtp-permanente-'));let calls=0;
  const crear=options=>{
   if(!options.requireTLS||!options.tls.rejectUnauthorized||options.logger||options.debug||options.host!=='smtp-relay.brevo.com'||options.port!==587)throw Error('Transporte inseguro');
   const stream=req('nodemailer').createTransport({streamTransport:true,buffer:true});
   return{async sendMail(message){calls++;const out=await stream.sendMail(message);mensajes.push({message,mime:out.message});if(incierto)throw Object.assign(Error('Fallo ficticio'),{code:'ESOCKET'});return{accepted:out.envelope.to,rejected:[],messageId:out.messageId,response:'250 simulación'};},close(){stream.close();}};
  };
  const app=crearAplicacionDataApi(cfg,dir,client,crear),server=http.createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body,key)=>fetch(base+route,{method:'POST',headers:{Origin:'http://127.0.0.1:5500','Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  return{app,base,post,calls:()=>calls,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
 }
 return{client,registros,mensajes,abrir};
}
module.exports={laboratorio,config,mail,data,sha};
