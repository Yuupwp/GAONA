const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const root = fs.realpathSync(path.resolve(__dirname, '../..'));
const directory = path.join(os.homedir(), '.gaona-local', createHash('sha256').update(root).digest('hex').slice(0, 16));
const runtimeFile = path.join(directory, 'runtime.json');
const controlFile = path.join(directory, 'servicios.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const token = () => randomBytes(32).toString('hex');
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG'].includes(k)));
function privateRead(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))) throw Error('Archivo local inseguro');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(file, value, exclusive = false) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function runtime() {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))) throw Error('Directorio local inseguro');
  const value = privateRead(runtimeFile);
  if (value.root !== root || value.version !== 1 || value.estado !== 'listo' || !Number.isInteger(value.pgPort) || value.pgPort < 1024 || value.pgPort === 5432 || value.pgPort > 65535) throw Error('Inicialización local incompleta o de otra instalación; no se sobrescriben datos');
  for (const k of ['adminPassword','webPassword','idempotencia','acceso','control']) if (!/^[a-f0-9]{64}$/.test(value[k])) throw Error('Claves locales inválidas');
  const data = path.join(directory, 'postgres');
  if (fs.lstatSync(data).isSymbolicLink()) throw Error('Directorio PostgreSQL inseguro');
  return value;
}
function config() {
  const file = path.join(root, 'api/desarrollo-local.json');
  const c = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (Object.keys(c).some(k => !['apiPort','frontendPort','pgBin'].includes(k))) throw Error('Configuración local desconocida');
  const r = { apiPort: 3000, frontendPort: 5500, ...c };
  for (const p of [r.apiPort, r.frontendPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw Error('Puerto inválido');
  if (r.apiPort === r.frontendPort) throw Error('Los puertos web deben ser distintos');
  return r;
}
function pgBin(c) {
  const found = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8', env: baseEnv() });
  const bin = c.pgBin || process.env.PG_BIN || found.stdout?.trim();
  if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw Error('Instala PostgreSQL 17 y sus herramientas; configura pgBin en api/desarrollo-local.json si no están en PATH');
  const version = spawnSync(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' });
  if (!/PostgreSQL\) 17\./.test(version.stdout || '')) throw Error('Se requiere PostgreSQL 17');
  return bin;
}
function pgEnv(s, database = 'gaona_desarrollo_local') {
  return { ...baseEnv(), PGHOST: '127.0.0.1', PGPORT: String(s.pgPort), PGUSER: 'gaona_local_admin', PGDATABASE: database,
    PGPASSFILE: path.join(directory, 'pgpass'), PGCONNECT_TIMEOUT: '3' };
}
function run(s, name, args, input, extra = {}) {
  const result = spawnSync(path.join(s.pgBin, name), args, { env: { ...pgEnv(s), ...extra }, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw Error(`Falló ${name}; no se muestran argumentos ni configuración privada`);
  return result.stdout;
}
function sql(s, text) { return run(s, 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At'], text); }
function pgStart(s) { run(s, 'pg_ctl', ['-D', path.join(directory, 'postgres'), '-l', path.join(directory, 'postgres.log'), '-w', 'start']); }
function pgStop(s) { run(s, 'pg_ctl', ['-D', path.join(directory, 'postgres'), '-m', 'fast', '-w', 'stop']); }
function pgActive(s) { return spawnSync(path.join(s.pgBin, 'pg_ctl'), ['-D', path.join(directory, 'postgres'), 'status'], { env: pgEnv(s), stdio: 'ignore' }).status === 0; }
function available(port) {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Error(`Puerto ${port} ocupado; no se detiene ningún proceso. Cambia api/desarrollo-local.json`))); server.listen(port, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); }); });
}
async function prepare() {
  const c = config();
  if (fs.existsSync(directory)) { runtime(); console.log('Instalación ya preparada; datos y claves conservados.'); return; }
  const bin = pgBin(c);
  const s = { version: 1, root, estado: 'preparando', pgBin: bin, pgPort: await available(0), adminPassword: token(), webPassword: token(), idempotencia: token(), acceso: token(), control: token() };
  if (s.pgPort === 5432) throw Error('Se rechaza el puerto de PostgreSQL habitual');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  write(runtimeFile, s, true);
  fs.writeFileSync(path.join(directory, 'pgpass'), `127.0.0.1:${s.pgPort}:*:gaona_local_admin:${s.adminPassword}\n`, { mode: 0o600, flag: 'wx' });
  const pwfile = path.join(directory, 'init-password');
  fs.writeFileSync(pwfile, s.adminPassword, { mode: 0o600, flag: 'wx' });
  let started = false;
  try {
    run(s, 'initdb', ['-D', path.join(directory, 'postgres'), '-U', 'gaona_local_admin', '--auth=scram-sha-256', '--pwfile', pwfile, '--encoding=UTF8', '--locale=C', '--no-instructions']);
    fs.unlinkSync(pwfile);
    fs.appendFileSync(path.join(directory, 'postgres/postgresql.conf'), `\nlisten_addresses='127.0.0.1'\nport=${s.pgPort}\nunix_socket_directories=''\nlogging_collector=off\nlog_statement='none'\nlog_min_error_statement='panic'\n`);
    pgStart(s); started = true;
    run(s, 'createdb', ['gaona_desarrollo_local'], undefined, { PGDATABASE: 'postgres' });
    sql(s, 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
    sql(s, fs.readFileSync(path.join(root, 'tests/fixtures/supabase-estructura.sql'), 'utf8'));
    run(s, 'psql', ['-X', '-v', 'ON_ERROR_STOP=1'], fs.readFileSync(path.join(root, 'api/propuestas/web/01-instalacion.sql'), 'utf8'), { PGOPTIONS: '-c gaona.web3_fk_restrict_aprobado=si' });
    sql(s, fs.readFileSync(path.join(root, 'api/propuestas/web/02-permisos.sql'), 'utf8'));
    const sha = value => createHash('sha256').update(Buffer.from(value, 'hex')).digest('hex');
    sql(s, `CREATE ROLE gaona_desarrollo_web LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${s.webPassword}';
      GRANT gaona_web_publico TO gaona_desarrollo_web WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
      UPDATE gaona_mensajeria.configuracion SET idempotencia_huella='${sha(s.idempotencia)}',acceso_huella='${sha(s.acceso)}' WHERE id=1;`);
    s.estado = 'listo'; write(runtimeFile, s);
    console.log('PostgreSQL 17 independiente preparado, SCRAM y rol web restringido; catálogo vacío; claves privadas conservadas fuera del proyecto.');
  } finally { if (started) pgStop(s); }
}
async function control(mode) {
  const s = runtime();
  let saved;
  try { saved = privateRead(controlFile); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const r = await fetch(`http://127.0.0.1:${saved.port}/${mode}`, { method: mode === 'detener' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${s.control}` }, signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw Error();
    const info = await r.json();
    if (info.instalacion !== createHash('sha256').update(root).digest('hex')) throw Error();
    return info;
  } catch { return null; }
}
async function health(c) {
  for (const p of ['/salud', '/productos']) { const r = await fetch(`http://127.0.0.1:${c.apiPort}${p}`, { signal: AbortSignal.timeout(1500) }); if (!r.ok) throw Error('API no disponible'); const data = await r.json(); if (p === '/salud' ? data.ok !== true : !Array.isArray(data)) throw Error('Respuesta API inválida'); }
  for (const p of ['/clientes','/empleados']) if ((await fetch(`http://127.0.0.1:${c.apiPort}${p}`)).status !== 404) throw Error('Ruta administrativa expuesta');
  if (!(await fetch(`http://127.0.0.1:${c.frontendPort}/Catalogo.html`)).ok) throw Error('Frontend no disponible');
}
async function worker() {
  const s = runtime(), c = config();
  const lock = path.join(directory, 'supervisor.lock');
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  let api, server, controller, stopping = false, started = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    if (api && api.exitCode === null) { api.kill('SIGTERM'); await Promise.race([new Promise(r => api.once('exit',r)), delay(10000)]); if (api.exitCode === null && api.signalCode === null) throw Error('API no confirmó su cierre; se conservan datos y PostgreSQL'); }
    server?.closeAllConnections(); if (server?.listening) await new Promise(r => server.close(r));
    controller?.closeAllConnections(); if (controller?.listening) await new Promise(r => controller.close(r));
    if (started && pgActive(s)) pgStop(s);
    fs.unlinkSync(lock); process.exit(0);
  };
  try {
    await available(c.apiPort); await available(c.frontendPort);
    if (pgActive(s)) throw Error('Este clúster ya está activo fuera del supervisor; no se adopta ni se detiene');
    pgStart(s); started = true;
    server = http.createServer((req,res) => {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      let name; try { name = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
      if (name === '/config.js') { res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(`const API_URL = "http://127.0.0.1:${c.apiPort}";`);return; }
      if (name === '/') name='/Catalogo.html';
      const base = path.join(root,'Página'), file=path.resolve(base,'.'+name);
      if (!file.startsWith(base+path.sep) || name.split('/').some(p=>p.startsWith('.'))) { res.writeHead(403).end();return; }
      try { const real=fs.realpathSync(file);if (!real.startsWith(fs.realpathSync(base)+path.sep)||!fs.statSync(real).isFile()) throw Error();
        const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else fs.createReadStream(real).pipe(res);
      } catch { res.writeHead(404).end(); }
    });
    await new Promise((r,j)=>{server.once('error',j);server.listen(c.frontendPort,'127.0.0.1',r);});
    api = spawn(process.execPath,['--require',require.resolve('tsx/cjs'),path.join(root,'api/src/desarrollo-local.ts')],{cwd:root,env:{...baseEnv(),NODE_ENV:'development',GAONA_DESARROLLO_DIR:directory},stdio:['ignore','ignore','pipe']});
    api.stderr.on('data',()=>console.error('La API comunicó un diagnóstico; usa verificar sin mostrar configuración privada.'));
    api.once('error',()=>void stop());api.once('exit',()=>{if(!stopping)void stop();});
    for(let i=0;;i++){try{await health(c);break;}catch{if(i>=60)throw Error('No se confirmó el arranque local');await delay(150);}}
    const info=()=>({instalacion:createHash('sha256').update(root).digest('hex'),estado:'activo',postgres:true,smtp_real:false,catalogo:`http://127.0.0.1:${c.frontendPort}/Catalogo.html`,formulario:`http://127.0.0.1:${c.frontendPort}/cotizacion.html`});
    controller=http.createServer(async(req,res)=>{
      const received=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+s.control);
      if(received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(403).end();return;}
      if(req.url==='/estado'&&req.method==='GET'){let checked=true;try{await health(c);}catch{checked=false;}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...info(),estado:checked?'activo':'degradado',comprobaciones:checked}));return;}
      if(req.url==='/detener'&&req.method==='POST'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(info()));setTimeout(()=>void stop(),50);return;}
      res.writeHead(404).end();
    });
    await new Promise(r=>controller.listen(0,'127.0.0.1',r));write(controlFile,{port:controller.address().port,pid:process.pid});
    process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
  } catch(e) {console.error(e.message);await stop();}
}
async function main() {
  if(process.versions.node.split('.')[0]!=='24')throw Error('Activa Node.js 24 en esta terminal; no se requiere una ruta personal de nvm');
  if(process.env.NODE_ENV&&process.env.NODE_ENV!=='development')throw Error('Ejecutor exclusivo de desarrollo; producción rechazada');
  const mode=process.argv[2];
  if(mode==='verificar-correo'){
    if(process.argv.length!==4)throw Error('Indica la ruta de un archivo privado SMTP; no pases credenciales como argumentos');
    const file=path.resolve(process.argv[3]);const info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.uid!==process.getuid()||(info.mode&0o077))))throw Error('Archivo SMTP inseguro; exige permisos 600');
    const values=require('dotenv').parse(fs.readFileSync(file));
    require('tsx/cjs');const cfg=require('../src/solicitud-correo').configurarSmtp({...values,MAIL_ENABLED:'true'});
    if(!cfg||cfg.opciones.host!=='smtp-relay.brevo.com'||cfg.opciones.port!==587||cfg.opciones.secure!==false||cfg.opciones.requireTLS!==true||cfg.opciones.tls?.rejectUnauthorized!==true||/^xkeysib-/i.test(values.SMTP_PASSWORD||''))throw Error('Configuración Brevo incompleta o inválida');
    console.log('Formato Brevo válido; STARTTLS obligatorio y certificados validados. No se abrió una conexión SMTP ni se habilitaron envíos.');return;
  }
  if(process.argv.length!==3)throw Error('Usa preparar|verificar|iniciar|estado|detener|reiniciar');
  if(mode==='preparar')return prepare();
  if(mode==='worker')return worker();
  if(!['verificar','iniciar','estado','detener','reiniciar'].includes(mode))throw Error('Modo no disponible; este ejecutor nunca habilita SMTP real');
  const s=runtime(), c=config();
  if(mode==='verificar'){
    pgBin({pgBin:s.pgBin});require.resolve('tsx/cjs');
    if(typeof require('@prisma/client').Prisma.Decimal!=='function')throw Error('Genera el cliente Prisma con npm --prefix api run prisma:generar');
    const started=!pgActive(s);if(started)pgStart(s);
    try{
      const checked=run(s,'psql',['-X','-v','ON_ERROR_STOP=1','-At'],`SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)
        AND current_user='gaona_desarrollo_web' AND current_database()='gaona_desarrollo_local'
        AND NOT has_table_privilege(current_user,'public.usuarios','SELECT')
        AND NOT has_table_privilege(current_user,'public.inventario','SELECT')
        AND NOT has_table_privilege(current_user,'public.pagos','INSERT')
        AND EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id=1 AND version=2)
        FROM pg_roles WHERE rolname=current_user;`,{PGUSER:'gaona_desarrollo_web',PGPASSWORD:s.webPassword});
      if(checked.trim()!=='t')throw Error('Permisos PostgreSQL locales incorrectos');
      console.log('Configuración y conexión local válidas; PostgreSQL 17; rol restringido y persistencia comprobados; claves privadas; sin SMTP real.');
    }finally{if(started)pgStop(s);}return;
  }
  if(mode==='estado'){console.log(JSON.stringify(await control('estado')||{estado:pgActive(s)||fs.existsSync(path.join(directory,'supervisor.lock'))?'no_verificado':'detenido',smtp_real:false},null,2));return;}
  if(mode==='detener'||mode==='reiniciar'){
    const active=await control('estado');
    if(active){if(!await control('detener'))throw Error('No se confirmó la parada');for(let i=0;i<150&&fs.existsSync(path.join(directory,'supervisor.lock'));i++)await delay(100);if(fs.existsSync(path.join(directory,'supervisor.lock')))throw Error('Parada pendiente; no se fuerza');}
    else if(pgActive(s)||fs.existsSync(path.join(directory,'supervisor.lock')))throw Error('No se identifica el supervisor activo; no se detienen procesos por PID');
    if(mode==='detener'){console.log('Servicios de esta instalación detenidos; datos y claves conservados.');return;}
  }
  const active=await control('estado');if(active){console.log(JSON.stringify(active,null,2));return;}
  await available(c.apiPort);await available(c.frontendPort);
  const log=fs.openSync(path.join(directory,'servicios.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|(fs.constants.O_NOFOLLOW||0),0o600);
  const child=spawn(process.execPath,[__filename,'worker'],{cwd:root,env:{...baseEnv(),NODE_ENV:'development'},detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
  for(let i=0;i<100;i++){await delay(150);const result=await control('estado');if(result){console.log(JSON.stringify(result,null,2));return;}}
  throw Error('No se confirmó el arranque; revisa el diagnóstico saneado en el directorio privado de esta instalación');
}
module.exports={root,directory,runtime,config,privateRead,pgEnv,sql,control};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
