const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {apiRequire}=require('./pdf-harness.cjs');
const {PrismaClient}=apiRequire('@prisma/client');
const {verificar}=require('../api/scripts/verificar-web.cjs');
const configured=Boolean(process.env.GAONA_WEB3_TEST_ADMIN_URL);
const local=(name,fn)=>test(name,{skip:!configured},fn);
let owner,directory,configuration,original,env,admin;
before(async()=>{
 if(!configured)return;
 admin=new URL(process.env.GAONA_WEB3_TEST_ADMIN_URL);assert.equal(admin.hostname,'127.0.0.1');assert.equal(admin.pathname,'/gaona_web3_aislada');assert.equal(admin.username,'gaona_local_admin');assert.ok(admin.port&&admin.port!=='5432');
 owner=new PrismaClient({datasources:{db:{url:admin.toString()}},log:[]});
 const [row]=await owner.$queryRaw`SELECT current_setting('data_directory') AS carpeta`;
 assert.match(row.carpeta,/^\/tmp\/gaona-persistencia-[^/]+\/postgres$/);
 configuration=path.join(row.carpeta,'postgresql.conf');original=fs.readFileSync(configuration);
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-conexion-tls-'));
 const run=args=>{const r=spawnSync('/usr/bin/openssl',args,{cwd:directory,encoding:'utf8'});assert.equal(r.status,0);};
 run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','2','-subj','/CN=GAONA LOCAL CA','-addext','basicConstraints=critical,CA:TRUE']);
 run(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost']);
 fs.writeFileSync(path.join(directory,'ext.cnf'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
 run(['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','2','-extfile','ext.cnf']);
 run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','incorrecta.key','-out','incorrecta.crt','-days','2','-subj','/CN=OTRA CA FICTICIA','-addext','basicConstraints=critical,CA:TRUE']);
 fs.chmodSync(path.join(directory,'server.key'),0o600);
 fs.appendFileSync(configuration,`\nssl=on\nssl_cert_file='${directory}/server.crt'\nssl_key_file='${directory}/server.key'\n`);
 await owner.$queryRaw`SELECT pg_reload_conf()`;
 for(let i=0;i<50;i++){const [r]=await owner.$queryRaw`SELECT current_setting('ssl') AS ssl`;if(r.ssl==='on')break;await new Promise(r=>setTimeout(r,100));}
 await owner.$executeRawUnsafe('CREATE ROLE gaona_web6_tls LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
 await owner.$executeRawUnsafe('GRANT gaona_web_publico TO gaona_web6_tls WITH INHERIT TRUE, SET FALSE, ADMIN FALSE');
 const u=new URL(admin);u.username='gaona_web6_tls';u.searchParams.set('sslmode','require');u.searchParams.set('sslaccept','strict');u.searchParams.set('sslcert',path.join(directory,'ca.crt'));
 env={WEB_DATABASE_URL:u.toString(),WEB_DATABASE_ROLE:u.username,SOLICITUD_STORAGE:'postgres',SOLICITUD_IDEMPOTENCY_KEY:'c'.repeat(64),SOLICITUD_PDF_KEY:'e'.repeat(64)};
});
after(async()=>{
 if(owner&&original){fs.writeFileSync(configuration,original);await owner.$queryRaw`SELECT pg_reload_conf()`;}
 await owner?.$disconnect();if(directory)fs.rmSync(directory,{recursive:true});
});
local('Conexión TLS: Prisma conecta con CA ficticia confiable, certificado y rol restringido',async()=>{
 const r=await verificar(env);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.tls,true);assert.equal(r.local,false);
});
local('Conexión TLS: CA incorrecta se rechaza sin rebajar certificados ni cambiar la conexión',async()=>{
 const u=new URL(env.WEB_DATABASE_URL);u.searchParams.set('sslcert',path.join(directory,'incorrecta.crt'));
 await assert.rejects(verificar({...env,WEB_DATABASE_URL:u.toString()}));
});
local('Conexión TLS: credencial administrativa explícita y claves distintas no superan la auditoría',async()=>{
 const u=new URL(env.WEB_DATABASE_URL);u.username=admin.username;
 const r=await verificar({...env,WEB_DATABASE_URL:u.toString(),WEB_DATABASE_ROLE:u.username});assert.equal(r.ok,false);assert.ok(r.fallos.includes('rol_restringido'));
 const mismatch=await verificar({...env,SOLICITUD_PDF_KEY:'d'.repeat(64)});assert.equal(mismatch.ok,false);assert.ok(mismatch.fallos.includes('claves_backend'));
});
