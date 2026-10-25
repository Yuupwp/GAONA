const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
function validarEntorno(env){
 let u;try{u=new URL(env.WEB_DATABASE_URL);}catch{throw Error('WEB6_URL: Se requiere WEB_DATABASE_URL explícita');}
 const fail=()=>{throw Error('WEB6_CONFIG: Conexión o TLS no autorizados para la verificación');};
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.username||u.pathname.length<2||!env.WEB_DATABASE_ROLE||!/^[a-z][a-z0-9_]{0,62}$/.test(env.WEB_DATABASE_ROLE))fail();
 const local=env.GAONA_WEB6_LOCAL==='POSTGRES_AISLADO'&&u.hostname==='127.0.0.1'&&u.port&&u.port!=='5432'&&u.pathname==='/gaona_web3_aislada';
 const permitidos=new Set(['sslmode','sslaccept','sslcert','schema','pgbouncer','connection_limit','connect_timeout','pool_timeout','socket_timeout','statement_cache_size']);
 if(!local){for(const key of u.searchParams.keys())if(!permitidos.has(key)||u.searchParams.getAll(key).length!==1)fail();if(u.searchParams.has('schema')&&u.searchParams.get('schema')!=='public')fail();}
 if(!local&&(u.searchParams.get('sslmode')!=='require'||u.searchParams.get('sslaccept')!=='strict'))fail();
 if(!local){const ca=u.searchParams.get('sslcert');if(!ca||!path.isAbsolute(ca)||!fs.statSync(ca).isFile())fail();}
 if(decodeURIComponent(u.username).split('.')[0]!==env.WEB_DATABASE_ROLE||['postgres','service_role','supabase_admin'].includes(env.WEB_DATABASE_ROLE))fail();
 return {url:u.toString(),rol:env.WEB_DATABASE_ROLE,local};
}
async function verificar(env){
 const c=validarEntorno(env),{PrismaClient}=require('@prisma/client');
 const db=new PrismaClient({datasources:{db:{url:c.url}},log:[]});
 try{
  const rows=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const rows=await tx.$queryRawUnsafe(fs.readFileSync(path.join(__dirname,'../propuestas/web/06-auditoria-efectiva.sql'),'utf8'));
   const keys=[env.SOLICITUD_IDEMPOTENCY_KEY,env.SOLICITUD_PDF_KEY];
   rows[0].auditoria.claves_backend=false;
   if(env.SOLICITUD_STORAGE==='postgres'&&keys.every(k=>/^[a-f\d]{64}$/i.test(k??''))){
    const [id,access]=keys.map(k=>createHash('sha256').update(Buffer.from(k,'hex')).digest('hex'));
    const match=await tx.$queryRaw`SELECT idempotencia_huella=${id} AND acceso_huella=${access} AS valido FROM gaona_mensajeria.configuracion WHERE id=1 AND version=2`;
    rows[0].auditoria.claves_backend=match[0]?.valido===true;
   }
   return rows;
  },{timeout:15000});
  const r=rows[0]?.auditoria;if(!r)throw Error('WEB6_AUDITORIA');
  const fallos=Object.entries(r).filter(([key,v])=>!['identidad','sesion','tls'].includes(key)&&v!==true).map(([key])=>key);
  if(r.identidad!==c.rol||r.sesion!==c.rol)fallos.push('identidad_esperada');
  if(!c.local&&!r.tls)fallos.push('tls');
  return {ok:fallos.length===0,local:c.local,identidad:r.identidad,tls:r.tls,fallos};
 }finally{await db.$disconnect();}
}
if(require.main===module)verificar(process.env).then(r=>{console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}).catch(()=>{console.error('WEB6_VERIFICACION: No se pudo validar la conexión restringida; no se muestran credenciales ni detalles internos');process.exitCode=1;});
module.exports={validarEntorno,verificar};
