const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const root = fs.realpathSync(path.resolve(__dirname, '../..'));
const directory = path.join(os.homedir(), '.gaona-web-compartida', createHash('sha256').update(root).digest('hex').slice(0,16));
const identity = createHash('sha256').update(root).digest('hex');
const project = 'kvuvetijtldpamrfslsg';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const systemEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG'].includes(k)));
const error = (code, message) => Object.assign(new Error(`${code}: ${message}`), { seguro: true });
function privateJson(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))) throw error('WEB_PRIVADO','Archivo de control inseguro');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function write(file, value, exclusive=false) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|(exclusive?fs.constants.O_EXCL:fs.constants.O_TRUNC)|(fs.constants.O_NOFOLLOW||0),0o600);
  try {fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function entorno(smtp=false) {
  const file=path.join(root,'api/.env');
  if(!fs.existsSync(file))throw error('WEB_ENV_FALTA','Configura api/.env privado; DATABASE_URL y DIRECT_URL no configuran la API pública');
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.uid!==process.getuid()||(info.mode&0o077))))throw error('WEB_ENV_PERMISOS','api/.env requiere propietario actual y permisos 600');
  const parsed=require('dotenv').parse(fs.readFileSync(file));
  if(parsed.SOLICITUD_STORAGE==='data-api'){
    const env={...systemEnv(),...Object.fromEntries(Object.entries(parsed).filter(([k])=>['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_AUTH_EMAIL','SUPABASE_AUTH_PASSWORD','SUPABASE_AUTH_UID','WEB_HOST','WEB_PORT','SOLICITUD_STORAGE','SOLICITUD_IDEMPOTENCY_KEY','SOLICITUD_PDF_KEY'].includes(k))),NODE_ENV:'development',MAIL_ENABLED:'false',WHATSAPP_ENABLED:'false'};
    if((parsed.NODE_ENV||'development')!=='development')throw error('WEB_MODO','Este supervisor solo permite desarrollo');
    require('./config-data-api.cjs').validarDataApi(env);
    env.WEB_HOST=env.WEB_HOST||'127.0.0.1';env.WEB_PORT=env.WEB_PORT||'3000';
    if(env.WEB_HOST!=='127.0.0.1'||!/^\d+$/.test(env.WEB_PORT)||Number(env.WEB_PORT)<1024||Number(env.WEB_PORT)>65535)throw error('WEB_PUERTO','API solo en 127.0.0.1 con puerto válido');
    if(smtp){
      Object.assign(env,require('./smtp-compartido.cjs').entorno(),{WEB_CORREO_MODO:'smtp'});
      env.WEB_SMTP_DESTINATARIO=process.env.WEB_SMTP_DESTINATARIO;
    }
    return env;
  }
  if(smtp)throw error('WEB_SMTP_ALMACEN','SMTP web requiere persistencia Data API');
  if(!parsed.WEB_DATABASE_URL)throw error('WEB_URL_FALTA','Falta WEB_DATABASE_URL; no se utiliza DATABASE_URL ni DIRECT_URL como respaldo');
  if((parsed.NODE_ENV||'development')!=='development')throw error('WEB_MODO','Este supervisor solo permite desarrollo');
  const env={...systemEnv(),...Object.fromEntries(Object.entries(parsed).filter(([k])=>['WEB_DATABASE_URL','WEB_DATABASE_ROLE','WEB_HOST','WEB_PORT','SOLICITUD_STORAGE','SOLICITUD_IDEMPOTENCY_KEY','SOLICITUD_PDF_KEY'].includes(k))),NODE_ENV:'development',MAIL_ENABLED:'false',WHATSAPP_ENABLED:'false'};
  env.WEB_HOST=env.WEB_HOST||'127.0.0.1';env.WEB_PORT=env.WEB_PORT||'3000';
  if(env.WEB_HOST!=='127.0.0.1'||!/^\d+$/.test(env.WEB_PORT)||Number(env.WEB_PORT)<1024||Number(env.WEB_PORT)>65535)throw error('WEB_PUERTO','La API requiere 127.0.0.1 y un puerto entre 1024 y 65535');
  let url;
  try{url=new URL(env.WEB_DATABASE_URL);}catch{throw error('WEB_URL_INVALIDA','WEB_DATABASE_URL no es una conexión PostgreSQL válida');}
  const role=decodeURIComponent(url.username).split('.')[0];
  if(!env.WEB_DATABASE_ROLE||role!==env.WEB_DATABASE_ROLE||['postgres','service_role','anon','authenticated','authenticator','pgbouncer','supabase_admin'].includes(role)||/^(pg_|supabase_)/.test(role))throw error('WEB_ROL','Se necesita una identidad PostgreSQL web restringida, explícita y autorizada');
  const pooler=url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith('.'+project);
  if(!((url.hostname===`db.${project}.supabase.co`&&url.pathname==='/postgres')||(pooler&&url.pathname==='/postgres')))throw error('WEB_PROYECTO','La conexión no identifica el proyecto compartido GAONA autorizado');
  const cert=url.searchParams.get('sslcert');
  if(cert&&!path.isAbsolute(cert)){url.searchParams.set('sslcert',path.resolve(root,'api',cert));env.WEB_DATABASE_URL=url.toString();}
  try{require('./verificar-web.cjs').validarEntorno(env);}catch{throw error('WEB_TLS','Exige sslmode=require, sslaccept=strict, CA oficial en sslcert y rol web autorizado; no se rebaja TLS');}
  if(env.SOLICITUD_STORAGE!=='postgres'||![env.SOLICITUD_IDEMPOTENCY_KEY,env.SOLICITUD_PDF_KEY].every(k=>/^[a-f0-9]{64}$/i.test(k||'')))throw error('WEB_PERSISTENCIA','Configura persistencia postgres y las claves estables compartidas del backend; no se generan ni sustituyen automáticamente');
  return env;
}
function config(env) {
  const file=path.join(root,'api/desarrollo-compartido.json');
  const cfg=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  if(Object.keys(cfg).some(k=>k!=='frontendPort'))throw error('WEB_CONFIG','La configuración web solo admite frontendPort');
  const frontendPort=cfg.frontendPort??5500;
  if(!Number.isInteger(frontendPort)||frontendPort<1024||frontendPort>65535||frontendPort===Number(env.WEB_PORT))throw error('WEB_PUERTO','El puerto del frontend debe ser válido y distinto al de la API');
  return {apiPort:Number(env.WEB_PORT),frontendPort};
}
async function verificar(env=entorno(), dependencies={}) {
  if(env.SOLICITUD_STORAGE==='data-api'){
    require('tsx/cjs');const {crearClienteDataApi,crearPersistenciaDataApi}=require('../src/data-api');
    const client=crearClienteDataApi(env),storage=crearPersistenciaDataApi(env,client);
    if(env.WEB_CORREO_MODO==='smtp'&&(await client.operacion('verificar')).correo_version!==2)throw error('WEB_SMTP_PERSISTENCIA','Se requiere aprobar e instalar 05-correo-real.sql antes de activar SMTP');
    if(!await storage.disponible())throw error('WEB_DATA_API_PENDIENTE','La sesión, RPC, RLS, instalación o huellas no están verificadas; no se inicia la API');
    const productos=await client.catalogo();return {ok:true,productos:productos.length,smtp_real:env.WEB_CORREO_MODO==='smtp',almacenamiento:'data-api'};
  }
  const Client=dependencies.PrismaClient||require('@prisma/client').PrismaClient;
  const db=new Client({datasources:{db:{url:env.WEB_DATABASE_URL}},log:[]});
  try {
    const [check]=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe(`SELECT current_user=session_user AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) AS restringido,
        to_regclass('gaona_mensajeria.configuracion') IS NOT NULL AND to_regclass('gaona_mensajeria.registros_web') IS NOT NULL AND to_regclass('gaona_mensajeria.documentos') IS NOT NULL AND to_regclass('gaona_mensajeria.correos') IS NOT NULL AS persistencia`);
    },{timeout:15000});
    if(!check?.restringido)throw error('WEB_IDENTIDAD','La identidad conectada no cumple el perfil PostgreSQL restringido');
    if(!check.persistencia)throw error('WEB_TABLAS_FALTAN','Falta gaona_mensajeria con configuracion, registros_web, documentos o correos; se requiere decisión del equipo, no se instala automáticamente');
    const result=await (dependencies.verificar||require('./verificar-web.cjs').verificar)(env);
    if(!result.ok)throw error('WEB_PERMISOS','Auditoría pendiente: '+result.fallos.join(', '));
    const products=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.producto.findMany({where:{activo:true,tipo:'PRODUCTO'},select:{id:true,nombre:true,descripcion:true,precioDesde:true,imagenUrl:true,categoria:{select:{nombre:true}}},orderBy:{nombre:'asc'}});
    },{timeout:15000});
    return {ok:true,productos:products.length,smtp_real:false};
  }catch(e){if(e.seguro)throw e;throw error('WEB_CONEXION','No se verificó la conexión restringida, TLS o el esquema. No se muestran credenciales; solicita al equipo una conexión y permisos autorizados');}
  finally{await db.$disconnect();}
}
function state() {
  const info=fs.lstatSync(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.uid!==process.getuid()||(info.mode&0o077))))throw error('WEB_PRIVADO','Directorio de control inseguro');
  const r=privateJson(path.join(directory,'control.json'));
  if(r.root!==root||!/^[a-f0-9]{64}$/.test(r.token))throw error('WEB_PRIVADO','Control de otra instalación');
  return r;
}
async function control(mode) {
  if(!fs.existsSync(path.join(directory,'servicios.json')))return null;
  const s=state(), saved=privateJson(path.join(directory,'servicios.json'));
  try{
    const response=await fetch(`http://127.0.0.1:${saved.port}/${mode}`,{method:mode==='detener'?'POST':'GET',headers:{Authorization:'Bearer '+s.token},signal:AbortSignal.timeout(2500)});
    if(!response.ok)return null;const result=await response.json();return result.instalacion===identity?result:null;
  }catch{return null;}
}
const available=port=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(error('WEB_PUERTO_OCUPADO',`Puerto ${port} ocupado; no se modifica su proceso`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
function frontend(c) {
  return http.createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
    if(name==='/config.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(`const API_URL = "http://127.0.0.1:${c.apiPort}";`);return;}
    if(name==='/')name='/Catalogo.html';
    const base=fs.realpathSync(path.join(root,'Página')),file=path.resolve(base,'.'+name);
    if(!file.startsWith(base+path.sep)||name.split('/').some(p=>p.startsWith('.'))){res.writeHead(403).end();return;}
    try{const real=fs.realpathSync(file);if(!real.startsWith(base+path.sep)||!fs.statSync(real).isFile())throw Error();
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
      res.writeHead(200,{'Content-Type':types[path.extname(real)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else fs.createReadStream(real).pipe(res);
    }catch{res.writeHead(404).end();}
  });
}
async function worker(env=entorno(),onStopped=()=>process.exit(0),onReady=()=>{}) {
  const c=config(env);await verificar(env);
  const s=state(),lock=path.join(directory,'supervisor.lock');
  fs.writeFileSync(lock,String(process.pid),{mode:0o600,flag:'wx'});
  let api,page,controller,stopping=false,timer;
  const signal=()=>void stop();
  const stop=async()=>{
    if(stopping)return;stopping=true;
    if(api&&api.exitCode===null){api.kill('SIGTERM');await new Promise(resolve=>{const wait=setTimeout(resolve,10000);api.once('exit',()=>{clearTimeout(wait);resolve();});});if(api.exitCode===null&&api.signalCode===null)throw error('WEB_PARADA','La API no confirmó su parada; no se fuerza');}
    for(const server of [page,controller]){server?.closeAllConnections();if(server?.listening)await new Promise(r=>server.close(r));}
    clearTimeout(timer);process.off('SIGINT',signal);process.off('SIGTERM',signal);process.off('SIGHUP',signal);
    fs.unlinkSync(lock);onStopped();
  };
  try{
    await available(c.apiPort);await available(c.frontendPort);
    page=frontend(c);await new Promise((r,j)=>{page.once('error',j);page.listen(c.frontendPort,'127.0.0.1',r);});
    api=spawn(process.execPath,['--require',require.resolve('tsx/cjs'),path.join(root,'api/src/desarrollo-compartido.ts')],{cwd:root,env,stdio:['ignore','ignore','pipe']});
    api.stderr.on('data',()=>console.error('WEB_API: Arranque rechazado; ejecuta npm run web:verificar para ver el diagnóstico saneado'));
    api.once('error',()=>void stop());api.once('exit',()=>{if(!stopping)void stop();});
    const health=async()=>{const r=await fetch(`http://127.0.0.1:${c.apiPort}/salud`,{signal:AbortSignal.timeout(2000)});if(!r.ok||(await r.json()).ok!==true)throw Error();};
    for(let i=0;;i++){try{await health();break;}catch{if(i>=100)throw error('WEB_ARRANQUE','La API no confirmó su arranque');await delay(150);}}
    const info=()=>({instalacion:identity,smtp_real:env.WEB_CORREO_MODO==='smtp',catalogo:`http://127.0.0.1:${c.frontendPort}/Catalogo.html`,formulario:`http://127.0.0.1:${c.frontendPort}/cotizacion.html`});
    controller=http.createServer(async(req,res)=>{
      const received=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+s.token);
      if(received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(403).end();return;}
      if(req.url==='/estado'&&req.method==='GET'){let ok=true;try{await health();}catch{ok=false;}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...info(),estado:ok?'activo':'degradado'}));return;}
      if(req.url==='/detener'&&req.method==='POST'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...info(),estado:'deteniendo'}));setTimeout(()=>void stop(),50);return;}
      res.writeHead(404).end();
    });
    await new Promise(r=>controller.listen(0,'127.0.0.1',r));write(path.join(directory,'servicios.json'),{port:controller.address().port});onReady();
    process.once('SIGINT',signal);process.once('SIGTERM',signal);process.once('SIGHUP',signal);
    if(env.WEB_CORREO_MODO==='smtp')timer=setTimeout(signal,15*60*1000);
  }catch(e){console.error(e.seguro?e.message:'WEB_ARRANQUE: No se iniciaron los servicios; datos remotos intactos');await stop();}
}
async function main() {
  if(process.versions.node.split('.')[0]!=='24')throw error('WEB_NODE','Activa Node.js 24');
  const mode=process.argv[2];
  if(process.argv.length!==3||!['configurar','verificar','iniciar','estado','detener','reiniciar','worker','smtp'].includes(mode))throw error('WEB_USO','Usa configurar|verificar|iniciar|estado|detener|reiniciar');
  if(mode==='smtp')return require('./activar-smtp-web.cjs').activar(module.exports);
  if(mode==='configurar'){const target=path.join(root,'api/.env');fs.writeFileSync(target,fs.readFileSync(path.join(root,'api/.env.example')),{mode:0o600,flag:'wx'});console.log('api/.env creado con plantilla vacía y permisos privados; complétalo personalmente con la conexión restringida aprobada.');return;}
  if(mode==='estado'){console.log(JSON.stringify(await control('estado')||{estado:fs.existsSync(path.join(directory,'supervisor.lock'))?'no_verificado':'detenido',smtp_real:false},null,2));return;}
  if(mode==='detener'||mode==='reiniciar'){
    const current=await control('estado');if(current){if(!await control('detener'))throw error('WEB_PARADA','No se confirmó la parada');for(let i=0;i<150&&fs.existsSync(path.join(directory,'supervisor.lock'));i++)await delay(100);}
    if(fs.existsSync(path.join(directory,'supervisor.lock')))throw error('WEB_PARADA','No se identifica el supervisor; no se matan procesos ajenos');
    if(mode==='detener'){console.log('Solo los servicios de esta instalación están detenidos; Supabase intacto.');return;}
  }
  if(mode==='worker')return worker();
  const env=entorno(),c=config(env);
  if(mode==='verificar'){console.log(JSON.stringify(await verificar(env),null,2));return;}
  if(await control('estado')){console.log(JSON.stringify(await control('estado'),null,2));return;}
  await available(c.apiPort);await available(c.frontendPort);await verificar(env);
  if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700,recursive:true});
  if(!fs.existsSync(path.join(directory,'control.json')))write(path.join(directory,'control.json'),{root,token:randomBytes(32).toString('hex')},true);
  state();
  const log=fs.openSync(path.join(directory,'servicios.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|(fs.constants.O_NOFOLLOW||0),0o600);
  const child=spawn(process.execPath,[__filename,'worker'],{cwd:root,env:systemEnv(),detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
  for(let i=0;i<160;i++){await delay(200);const result=await control('estado');if(result){console.log(JSON.stringify(result,null,2));return;}}
  throw error('WEB_ARRANQUE','No se confirmó el supervisor; consulta web:verificar. No se alteraron datos remotos');
}
module.exports={entorno,config,verificar,frontend,root,directory,project,worker,control};
if(require.main===module)main().catch(e=>{console.error(e.seguro?e.message:e.code==='EEXIST'?'WEB_EXISTE: Se conserva el archivo o bloqueo existente':'WEB_CONFIGURACION: No se completó la operación; revisa la configuración privada sin mostrarla');process.exitCode=1;});
