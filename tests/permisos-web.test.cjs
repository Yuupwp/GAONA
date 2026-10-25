const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {apiRequire,sembrar,datos}=require('./web-postgres-lab.cjs');
const {verificar,validarEntorno}=require('../api/scripts/verificar-web.cjs');
const {PrismaClient}=apiRequire('@prisma/client');
const {registrarSolicitud}=apiRequire('./src/solicitud-registro');
const configured=Boolean(process.env.GAONA_WEB3_TEST_DATABASE_URL&&process.env.GAONA_WEB3_TEST_ADMIN_URL);
const local=(name,fn)=>test(name,{skip:!configured},fn);
let owner,db,products,env;
before(async()=>{
 if(!configured)return;
 const u=new URL(process.env.GAONA_WEB3_TEST_ADMIN_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/gaona_web3_aislada');assert.equal(u.username,'gaona_local_admin');assert.ok(u.port&&u.port!=='5432');
 owner=new PrismaClient({datasources:{db:{url:u.toString()}},log:[]});
 await owner.$executeRawUnsafe('CREATE ROLE gaona_web6_pruebas LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
 await owner.$executeRawUnsafe('GRANT gaona_web_publico TO gaona_web6_pruebas WITH INHERIT TRUE, SET FALSE, ADMIN FALSE');
 u.username='gaona_web6_pruebas';env={WEB_DATABASE_URL:u.toString(),WEB_DATABASE_ROLE:u.username,GAONA_WEB6_LOCAL:'POSTGRES_AISLADO',SOLICITUD_STORAGE:'postgres',SOLICITUD_IDEMPOTENCY_KEY:'c'.repeat(64),SOLICITUD_PDF_KEY:'e'.repeat(64)};
 db=new PrismaClient({datasources:{db:{url:u.toString()}},log:[]});products=await sembrar(owner);
});
after(async()=>{await db?.$disconnect();await owner?.$disconnect();});

test('Permisos PostgreSQL: verificador no usa URL administrativa de respaldo y exige TLS estricto fuera del laboratorio',()=>{
 for(const e of [{DATABASE_URL:'postgresql://postgres@remote.invalid/postgres'},
  {WEB_DATABASE_URL:'postgresql://postgres@remote.invalid/postgres',WEB_DATABASE_ROLE:'postgres'},
  {WEB_DATABASE_URL:'postgresql://gaona_web_publico_login@remote.invalid/postgres?sslmode=require',WEB_DATABASE_ROLE:'gaona_web_publico_login'},
  {WEB_DATABASE_URL:'postgresql://gaona_web_publico_login@remote.invalid/postgres?sslmode=require&sslaccept=accept_invalid_certs',WEB_DATABASE_ROLE:'gaona_web_publico_login'},
  {WEB_DATABASE_URL:'postgresql://gaona_web6_pruebas@remote.invalid:5555/gaona_web3_aislada',WEB_DATABASE_ROLE:'gaona_web6_pruebas',GAONA_WEB6_LOCAL:'POSTGRES_AISLADO'}])assert.throws(()=>validarEntorno(e));
});
local('Permisos PostgreSQL: auditoría efectiva de identidad, RLS, columnas, huellas y denegaciones en transacción de lectura',async()=>{
 const r=await verificar(env);assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.fallos,[]);assert.equal(r.identidad,'gaona_web6_pruebas');
});
local('Permisos PostgreSQL: políticas PUBLIC permisivas no amplían catálogo ni origen administrativo para el rol web',async()=>{
 await owner.$executeRawUnsafe('CREATE POLICY web6_adversaria_catalogo ON public.productos FOR SELECT TO PUBLIC USING(true)');
 await owner.$executeRawUnsafe('CREATE POLICY web6_adversaria_solicitud ON public.solicitudes TO PUBLIC USING(true) WITH CHECK(true)');
 try{
  const visible=await db.producto.findMany({where:{id:{in:products.map(p=>p.id)}},select:{id:true}});
  assert.deepEqual(visible.map(p=>p.id).sort(),products.slice(0,2).map(p=>p.id).sort());
  const c=await owner.cliente.create({data:{nombre:'FICTICIO',apellido:'Permisos simulados',telefono:'0000000000'}});
  const escritorio=await owner.solicitud.create({data:{idCliente:c.id,origen:'ESCRITORIO'}});
  assert.deepEqual(await db.solicitud.findMany({where:{id:escritorio.id},select:{id:true}}),[]);
  await assert.rejects(db.solicitud.create({data:{idCliente:c.id,origen:'ESCRITORIO'},select:{id:true}}));
  await assert.rejects(db.solicitud.create({data:{idCliente:c.id,estado:'EN_REVISION'},select:{id:true}}));
  assert.equal((await owner.solicitud.findUnique({where:{id:escritorio.id}})).origen,'ESCRITORIO');
 }finally{
  await owner.$executeRawUnsafe('DROP POLICY web6_adversaria_catalogo ON public.productos');
  await owner.$executeRawUnsafe('DROP POLICY web6_adversaria_solicitud ON public.solicitudes');
 }
});
local('Permisos PostgreSQL: altas Prisma por columnas operan y futuros campos administrativos no reciben INSERT',async()=>{
 const record=await db.$transaction(tx=>registrarSolicitud(tx,datos(products)));assert.ok(record.id);
 await owner.$executeRawUnsafe('ALTER TABLE public.solicitudes ADD COLUMN web6_campo_administrativo text');
 try{
  assert.equal((await db.$queryRaw`SELECT has_column_privilege(current_user,'public.solicitudes','web6_campo_administrativo','INSERT') AS permitido`)[0].permitido,false);
  const r=await verificar(env);assert.equal(r.ok,true,JSON.stringify(r));
 }finally{await owner.$executeRawUnsafe('ALTER TABLE public.solicitudes DROP COLUMN web6_campo_administrativo');}
});
local('Permisos PostgreSQL: privilegios PUBLIC indebidos y SECURITY DEFINER accesible bloquean la auditoría sin cambiar otros roles',async()=>{
 await owner.$executeRawUnsafe('GRANT SELECT ON public.usuarios TO PUBLIC');
 try{const r=await verificar(env);assert.equal(r.ok,false);assert.ok(r.fallos.includes('columnas_minimas'));}
 finally{await owner.$executeRawUnsafe('REVOKE SELECT ON public.usuarios FROM PUBLIC');}
 await owner.$executeRawUnsafe('CREATE FUNCTION public.web6_adversaria_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$');
 try{const r=await verificar(env);assert.equal(r.ok,false);assert.ok(r.fallos.includes('sin_definer_accesible'));}
 finally{await owner.$executeRawUnsafe('DROP FUNCTION public.web6_adversaria_definer()');}
});
local('Permisos PostgreSQL: detalles fuera de rango, medición real y productos ocultos se rechazan por permisos o RLS',async()=>{
 const c=await owner.cliente.create({data:{nombre:'FICTICIO',apellido:'Permisos simulados',telefono:'0000000000'}});
 const s=await owner.solicitud.create({data:{idCliente:c.id,origen:'WEB'}});
 await owner.$executeRawUnsafe('CREATE POLICY web6_adversaria_detalles ON public.solicitud_detalles TO PUBLIC USING(true) WITH CHECK(true)');
 try{
  for(const data of [{cantidad:1000},{cantidad:1,idProducto:products[2].id},{cantidad:1,medidasReales:'reservado'}]){
   await assert.rejects(db.solicitudDetalle.create({data:{idSolicitud:s.id,idProducto:products[0].id,...data},select:{id:true}}));
  }
 }finally{await owner.$executeRawUnsafe('DROP POLICY web6_adversaria_detalles ON public.solicitud_detalles');}
});
local('Permisos PostgreSQL: cuarentena exige aprobación, cierra herencia y conserva los registros históricos',async()=>{
 const parsed=new URL(process.env.GAONA_WEB3_TEST_ADMIN_URL),file=path.resolve(__dirname,'../api/propuestas/web/07-cuarentena.sql');
 const pgEnv={PATH:process.env.PATH,PGHOST:parsed.hostname,PGPORT:parsed.port,PGUSER:parsed.username,PGDATABASE:parsed.pathname.slice(1)};
 const run=options=>spawnSync('/usr/lib/postgresql/17/bin/psql',['-X','-v','ON_ERROR_STOP=1','-f',file],{env:{...pgEnv,...options},encoding:'utf8'});
 const before=await owner.solicitud.count();assert.notEqual(run({}).status,0);
 assert.equal(run({PGOPTIONS:'-c gaona.web6_cuarentena_aprobada=si'}).status,0);
 try{
  assert.equal((await owner.$queryRaw`SELECT has_table_privilege('gaona_web_publico_login','gaona_mensajeria.documentos','SELECT') AS acceso`)[0].acceso,false);
  assert.equal(await owner.solicitud.count(),before);
 }finally{await owner.$executeRawUnsafe('GRANT gaona_web_publico TO gaona_web_publico_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE');}
});
local('Permisos PostgreSQL: preflight compara solo metadatos y detecta deriva de tipos sin cambiar el esquema compartido',async()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../api/propuestas/web/00-compatibilidad.sql'),'utf8');
 const read=await owner.$queryRawUnsafe(sql);assert.deepEqual(read[0].compatibilidad.columnas_incompatibles,[]);assert.deepEqual(read[0].compatibilidad.enums_ausentes,[]);assert.equal(read[0].compatibilidad.rls_compartido,true);
 await assert.rejects(owner.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE public.productos ALTER COLUMN "precioDesde" TYPE numeric(14,2)');
  const drift=await tx.$queryRawUnsafe(sql);assert.ok(drift[0].compatibilidad.columnas_incompatibles.some(r=>r.tabla==='productos'&&r.columna==='precioDesde'));
  throw Error('REVERTIR_DERIVA_FICTICIA');
 }),/REVERTIR_DERIVA_FICTICIA/);
 assert.deepEqual((await owner.$queryRawUnsafe(sql))[0].compatibilidad.columnas_incompatibles,[]);
});
