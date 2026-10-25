const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
function fixture(t) {
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-env-compartido-'));
  fs.mkdirSync(path.join(work,'api/scripts'),{recursive:true});fs.mkdirSync(path.join(work,'Página'));
  for(const p of ['entorno-compartido.cjs','verificar-web.cjs'])fs.copyFileSync(path.join(root,'api/scripts',p),path.join(work,'api/scripts',p));
  fs.symlinkSync(path.join(root,'api/node_modules'),path.join(work,'api/node_modules'),'junction');
  const ca=path.join(work,'api/ca-prueba.crt');fs.writeFileSync(ca,'CERTIFICADO FICTICIO; SOLO VALIDACION SIN RED');
  const shared=require(path.join(work,'api/scripts/entorno-compartido.cjs'));
  const url=new URL(`postgresql://web_autorizada:clave-ficticia@db.${shared.project}.supabase.co:5432/postgres`);
  url.searchParams.set('sslmode','require');url.searchParams.set('sslaccept','strict');url.searchParams.set('sslcert',ca);
  const values={WEB_DATABASE_URL:url.toString(),WEB_DATABASE_ROLE:'web_autorizada',WEB_PORT:'3000',SOLICITUD_STORAGE:'postgres',SOLICITUD_IDEMPOTENCY_KEY:'a'.repeat(64),SOLICITUD_PDF_KEY:'b'.repeat(64)};
  const put=changes=>{const v={...values,...changes};fs.writeFileSync(path.join(work,'api/.env'),Object.entries(v).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});fs.chmodSync(path.join(work,'api/.env'),0o600);};
  t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  return {work,shared,values,put,url};
}
test('Entorno compartido: falta .env y no se crea ninguna base ni configuración privada automáticamente',t=>{
  const {shared,work}=fixture(t);assert.throws(()=>shared.entorno(),/WEB_ENV_FALTA/);assert.ok(!fs.existsSync(path.join(work,'postgres')));
  assert.doesNotMatch(fs.readFileSync(path.join(root,'api/scripts/entorno-compartido.cjs'),'utf8'),/initdb|CREATE ROLE|CREATE DATABASE|pg_ctl/);
});
test('Entorno compartido: DATABASE_URL y DIRECT_URL nunca son respaldo web',t=>{
  const {shared,put}=fixture(t);put({WEB_DATABASE_URL:'',DATABASE_URL:'postgresql://administrador:privado@localhost/base',DIRECT_URL:'postgresql://administrador:privado@localhost/base'});
  assert.throws(()=>shared.entorno(),/WEB_URL_FALTA/);
});
test('Entorno compartido: bloquea identidad administrativa, proyecto ajeno, TLS débil y claves ausentes',t=>{
  const {shared,put,url}=fixture(t);
  for(const role of ['postgres','service_role','anon','authenticated','authenticator','pgbouncer','supabase_admin','pg_read_all_data']){const u=new URL(url);u.username=role;put({WEB_DATABASE_URL:u.toString(),WEB_DATABASE_ROLE:role});assert.throws(()=>shared.entorno(),/WEB_ROL/);}
  const other=new URL(url);other.hostname='db.otro-proyecto.supabase.co';put({WEB_DATABASE_URL:other.toString()});assert.throws(()=>shared.entorno(),/WEB_PROYECTO/);
  const weak=new URL(url);weak.searchParams.delete('sslaccept');put({WEB_DATABASE_URL:weak.toString()});assert.throws(()=>shared.entorno(),/WEB_TLS/);
  put({SOLICITUD_IDEMPOTENCY_KEY:''});assert.throws(()=>shared.entorno(),/WEB_PERSISTENCIA/);
});
test('Entorno compartido: lee solo .env privado, admite CA relativa y descarta conexiones administrativas y SMTP heredado',t=>{
  const {shared,put,url,work}=fixture(t);const u=new URL(url);u.searchParams.set('sslcert','ca-prueba.crt');
  put({WEB_DATABASE_URL:u.toString(),DATABASE_URL:'privado',DIRECT_URL:'privado',MAIL_ENABLED:'false',SMTP_PASSWORD:'privado',WHATSAPP_ENABLED:'true'});
  const env=shared.entorno();assert.equal(env.MAIL_ENABLED,'false');assert.equal(env.WHATSAPP_ENABLED,'false');assert.equal(env.DATABASE_URL,undefined);assert.equal(env.DIRECT_URL,undefined);assert.equal(env.SMTP_PASSWORD,undefined);
  assert.equal(new URL(env.WEB_DATABASE_URL).searchParams.get('sslcert'),path.join(work,'api/ca-prueba.crt'));
  put({MAIL_ENABLED:'true'});assert.throws(()=>shared.entorno(),/WEB_SMTP_ALMACEN/);
  fs.chmodSync(path.join(work,'api/.env'),0o644);assert.throws(()=>shared.entorno(),/WEB_ENV_PERMISOS/);
});
test('Entorno compartido: auditoría solo lectura, bloquea identidad, persistencia y permisos antes de consultar catálogo',async t=>{
  const {shared,put}=fixture(t);put();const env=shared.entorno();
  for(const check of [{restringido:false,persistencia:true},{restringido:true,persistencia:false},{restringido:true,persistencia:true}]){
    let closed=0,catalog=0,audit=0;const statements=[];
    class Client{async $transaction(fn){return fn({$executeRawUnsafe:async q=>statements.push(q),$queryRawUnsafe:async()=>[check],producto:{findMany:async()=>{catalog++;return[];}}});}async $disconnect(){closed++;}}
    await assert.rejects(shared.verificar(env,{PrismaClient:Client,verificar:async()=>{audit++;return{ok:false,fallos:['rls_compartido']};}}),/WEB_IDENTIDAD|WEB_TABLAS_FALTAN|WEB_PERMISOS/);
    assert.equal(closed,1);assert.equal(catalog,0);assert.deepEqual(statements,['SET TRANSACTION READ ONLY']);assert.equal(audit,check.restringido&&check.persistencia?1:0);
  }
});
test('Entorno compartido: consulta autorizada simulada conserva contrato dinámico, sin escrituras ni creación de estructuras',async t=>{
  const {shared,put}=fixture(t);put();const statements=[];let query;
  class Client{async $transaction(fn){return fn({$executeRawUnsafe:async q=>statements.push(q),$queryRawUnsafe:async()=>[{restringido:true,persistencia:true}],producto:{findMany:async q=>{query=q;return[];}}});}async $disconnect(){}}
  assert.deepEqual(await shared.verificar(shared.entorno(),{PrismaClient:Client,verificar:async()=>({ok:true,fallos:[]})}),{ok:true,productos:0,smtp_real:false});
  assert.deepEqual(query.where,{activo:true,tipo:'PRODUCTO'});assert.deepEqual(query.orderBy,{nombre:'asc'});assert.deepEqual(Object.keys(query.select),['id','nombre','descripcion','precioDesde','imagenUrl','categoria']);assert.deepEqual(statements,['SET TRANSACTION READ ONLY','SET TRANSACTION READ ONLY']);
});
test('Entorno compartido: frontend publica solo la dirección de la API y rechaza archivos privados',async t=>{
  const {shared,put,work}=fixture(t);put();const server=shared.frontend({apiPort:3210});
  fs.writeFileSync(path.join(work,'Página/Catalogo.html'),'<html>Catálogo</html>');
  fs.symlinkSync(path.join(work,'api/.env'),path.join(work,'Página/privado.txt'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await(await fetch(base+'/config.js')).text(),'const API_URL = "http://127.0.0.1:3210";');assert.equal((await fetch(base+'/privado.txt')).status,404);assert.equal((await fetch(base+'/.env')).status,403);
});
test('Entorno compartido: puertos ocupados fallan antes de conectar Supabase y conservan el proceso ajeno',async t=>{
  const {shared,put,work}=fixture(t);const http=require('node:http');const blocker=http.createServer((_q,r)=>r.end('servicio ajeno'));
  await new Promise(r=>blocker.listen(0,'127.0.0.1',r));t.after(()=>{blocker.closeAllConnections();blocker.close();});
  put({WEB_PORT:String(blocker.address().port)});
  const home=path.join(work,'home');fs.mkdirSync(home);
  const result=spawnSync(process.execPath,[path.join(work,'api/scripts/entorno-compartido.cjs'),'iniciar'],{env:{PATH:process.env.PATH,HOME:home},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/WEB_PUERTO_OCUPADO/);assert.doesNotMatch(result.stderr,/clave-ficticia/);assert.ok(blocker.listening);assert.ok(!fs.existsSync(path.join(home,'.gaona-web-compartida')));
});

test('Entorno compartido: configurar no requiere PostgreSQL, no genera claves de negocio y no sobrescribe .env',t=>{
  const {work}=fixture(t);fs.copyFileSync(path.join(root,'api/.env.example'),path.join(work,'api/.env.example'));
  const args=[path.join(work,'api/scripts/entorno-compartido.cjs'),'configurar'];
  const first=spawnSync(process.execPath,args,{env:{PATH:''},encoding:'utf8'});assert.equal(first.status,0);
  const file=path.join(work,'api/.env'),before=fs.readFileSync(file);assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.match(before.toString(),/^SOLICITUD_PDF_KEY=$/m);assert.match(before.toString(),/^SUPABASE_PUBLISHABLE_KEY=$/m);
  const second=spawnSync(process.execPath,args,{env:{PATH:''},encoding:'utf8'});assert.notEqual(second.status,0);assert.match(second.stderr,/WEB_EXISTE/);assert.deepEqual(fs.readFileSync(file),before);
  const scripts=require('../package.json').scripts;for(const [name,command] of Object.entries(scripts))if(name.startsWith('web:'))assert.doesNotMatch(command,/desarrollo-local|initdb|pg_ctl/);
});
