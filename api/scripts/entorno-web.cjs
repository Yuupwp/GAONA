const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync,spawn}=require('node:child_process');
const {esProductoEnsayo}=require('./catalogo-local.cjs');
const root=path.resolve(__dirname,'../..');
const directory=path.join(os.homedir(),'.local/state/gaona-web5c');
const socket=path.join(directory,'supervisor.sock');
const session='gaona-web5c';
const stateFile=path.join(directory,'supervisor.json');
const pauseFile=path.join(directory,'supervisor-api-pausada');
const pg='/usr/lib/postgresql/17/bin';
const env={HOME:os.homedir(),PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',NODE_ENV:'development'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fail=message=>{throw Error(message);};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function runtime(){
 const d=fs.lstatSync(directory);if(d.isSymbolicLink()||!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o077))fail('Directorio local inseguro');
 const fd=fs.openSync(path.join(directory,'runtime.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(s.uid!==process.getuid()||(s.mode&0o077)||!s.isFile())fail('Configuración local insegura');
 const r=JSON.parse(fs.readFileSync(fd));if(r.version!==1||!Number.isInteger(r.port)||r.port<1024||r.port>65535||r.port===5432)fail('Puerto PostgreSQL local inválido');return r;}finally{fs.closeSync(fd);}
}
function proc(pid){
 try{return {pid,start:fs.readFileSync(`/proc/${pid}/stat`,'utf8').slice(fs.readFileSync(`/proc/${pid}/stat`,'utf8').lastIndexOf(')')+2).split(' ')[19],
 args:fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean),cwd:fs.readlinkSync(`/proc/${pid}/cwd`)};}catch{return null;}
}
function own(p,kind){
 if(!p)return false;
 if(kind==='postgres')return p.args[0]===path.join(pg,'postgres')&&p.args.includes(path.join(directory,'postgres'))&&p.args.includes('127.0.0.1');
 if(kind==='api')return p.args.includes(path.join(root,'api/src/web-local.ts'))&&p.cwd===root;
 if(kind==='frontend'){
  const i=p.args.indexOf('--directory');return p.args.includes('http.server')&&p.args.includes('5500')&&i>=0&&
   path.resolve(p.cwd,p.args[i+1])===path.join(root,'Página')&&p.args.includes('127.0.0.1');
 }
 return false;
}
function listener(port){
 const r=spawnSync('/usr/bin/ss',['-ltnp',`sport = :${port}`],{env,encoding:'utf8'});if(r.status!==0)fail('No se pudo inspeccionar el puerto');
 const lines=r.stdout.trim().split('\n').slice(1);if(!lines.length)return null;
 if(lines.length!==1||!lines[0].includes(`127.0.0.1:${port}`))fail(`Puerto ${port} ocupado fuera de la interfaz local prevista`);
 const pid=Number(lines[0].match(/pid=(\d+)/)?.[1]);if(!pid)fail(`No se identifica el proceso del puerto ${port}`);return proc(pid);
}
function pgProcess(){try{return proc(Number(fs.readFileSync(path.join(directory,'postgres/postmaster.pid'),'utf8').split('\n')[0]));}catch{return null;}}
function tmux(args){return spawnSync('/usr/bin/tmux',['-S',socket,...args],{env,encoding:'utf8'});}
function running(){return tmux(['has-session','-t',session]).status===0;}
function saved(){
 try{const fd=fs.openSync(stateFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(s.uid!==process.getuid()||(s.mode&0o077))fail('Registro del supervisor inseguro');return JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function save(s){const fd=fs.openSync(stateFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(s));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(2500)});if(r.status!==200)fail('Respuesta local no válida');return r.json();}
async function health(){
 const a=await json('http://127.0.0.1:3000/salud');const products=await json('http://127.0.0.1:3000/productos');
 if(a.ok!==true||!Array.isArray(products)||products.some(p=>typeof p.id!=='string'||esProductoEnsayo(p.id)))fail('API o catálogo distintos del entorno web local');
 for(const route of ['/clientes','/empleados']){const r=await fetch('http://127.0.0.1:3000'+route,{signal:AbortSignal.timeout(2500)});if(r.status!==404)fail('Ruta administrativa expuesta');}
 const r=await fetch('http://127.0.0.1:5500/Catalogo.html',{signal:AbortSignal.timeout(2500)});if(r.status!==200||(await r.text()).indexOf('productos.js')<0)fail('Frontend no válido');
}
async function stopProcess(p,kind){
 if(!p)return;const now=proc(p.pid);if(!now)return;
 if(now.start!==p.start||!own(now,kind))fail(`Se rechazó detener un proceso ajeno: ${kind}`);
 if(kind==='postgres'){
 const r=runtime();const result=spawnSync(path.join(pg,'pg_ctl'),['-D',path.join(directory,'postgres'),'-m','fast','-w','stop'],{env:{...env,PGHOST:'127.0.0.1',PGPORT:String(r.port),PGUSER:'gaona_web5c_admin',PGDATABASE:'gaona_web5c_aislada'},encoding:'utf8',timeout:15000});
 if(result.status!==0)fail('PostgreSQL no confirmó su parada ordenada');return;
 }
 process.kill(p.pid,'SIGTERM');
 for(let n=0;n<150;n++){const current=proc(p.pid);if(!current||current.start!==p.start)return;await delay(100);}
 fail(`El servicio ${kind} no terminó ordenadamente; no se fuerza su cierre`);
}
async function shutdown(s){
 for(const [kind,port] of [['api',3000],['frontend',5500]]){const p=listener(port);if(p){if(!own(p,kind))fail(`No se detiene ${kind}: proceso ajeno`);s[kind]=p;}}
 for(const kind of ['api','frontend','postgres'])await stopProcess(s[kind],kind);
 s.estado='detenido';save(s);
}
async function worker(){
 const s={version:1,estado:'iniciando',supervisor:proc(process.pid)};save(s);
 const created=new Set();
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;try{await shutdown(s);process.exit(0);}catch{console.error('Parada incompleta: revisa estado; no se cierran procesos ajenos');process.exit(1);}};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const start=(kind,binary,args)=>{
  created.add(kind);
  const log=fs.openSync(path.join(directory,`supervisor-${kind}.log`),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  const child=spawn(binary,args,{cwd:root,env,stdio:['ignore',log,log]});fs.closeSync(log);
  child.on('error',()=>{console.error(`No se pudo iniciar ${kind}`);void stop();});
  return child;
 };
 try{
  runtime();let p=pgProcess();
  if(p){if(!own(p,'postgres'))fail('PostgreSQL pertenece a otro entorno');s.postgres=p;}
  else{start('postgres',process.execPath,[path.join(root,'api/scripts/web-local.cjs'),'postgres']);for(let i=0;i<100&&!own(pgProcess(),'postgres');i++)await delay(100);s.postgres=pgProcess();if(!own(s.postgres,'postgres'))fail('PostgreSQL no inició');}
  save(s);
  for(const [kind,port,binary,args] of [
   ['api',3000,process.execPath,[path.join(root,'api/scripts/web-local.cjs'),'api']],
   ['frontend',5500,'/usr/bin/python3',['-m','http.server','5500','--bind','127.0.0.1','--directory',path.join(root,'Página')]]]){
   p=listener(port);
   if(p&&!own(p,kind))fail(`Puerto ${port} ocupado por otro proyecto: no se detiene`);
   if(p&&kind==='api'){
    const flags=fs.readFileSync(`/proc/${p.pid}/environ`,'utf8').split('\0');
    if(flags.includes('GAONA_WEB_LOCAL_SMTP=confirmado'))fail('API SMTP activa: no se adopta una sesión real');
   }
   if(!p){start(kind,binary,args);for(let i=0;i<100;i++){p=listener(port);if(p)break;await delay(100);}}
   if(!own(p,kind))fail(`No se pudo iniciar ${kind}`);s[kind]=p;save(s);
  }
  for(let i=0;;i++){try{await health();break;}catch(e){if(i===30)throw e;await delay(200);}}
  s.estado='activo';save(s);
  let checking=false;
  setInterval(async()=>{
   if(stopping||checking)return;checking=true;
   try{
    let api=listener(3000);
    if(api&&!own(api,'api'))fail('Un proceso ajeno ocupa la API; no se modifica');
    if(!api&&!fs.existsSync(pauseFile)){
     start('api',process.execPath,[path.join(root,'api/scripts/web-local.cjs'),'api']);
     for(let i=0;i<50;i++){await delay(100);api=listener(3000);if(api)break;}
    }
    if(own(api,'api'))s.api=api;
    s.estado=fs.existsSync(pauseFile)?'ensayo_privado_o_pausa':'activo';
    for(const kind of ['postgres','frontend']){const p=proc(s[kind].pid);if(!p||p.start!==s[kind].start)s.estado='degradado';}
    save(s);
   }catch{s.estado='degradado';save(s);}finally{checking=false;}
  },2000);
 }catch(e){
  console.error(e.message);stopping=true;
  for(const kind of ['api','frontend','postgres'])if(created.has(kind)){
   const p=kind==='postgres'?pgProcess():listener(kind==='api'?3000:5500);
   if(own(p,kind))await stopProcess(p,kind);
  }
  s.estado='error';save(s);process.exit(1);
 }
}
async function status(){
 runtime();const p=pgProcess(),a=listener(3000),f=listener(5500);
 let ok=false;try{await health();ok=true;}catch{}
 const smtp=own(a,'api')&&fs.readFileSync(`/proc/${a.pid}/environ`,'utf8').split('\0').includes('GAONA_WEB_LOCAL_SMTP=confirmado');
 const s=saved();console.log(JSON.stringify({supervisor:running(),estado:s?.estado??'sin_supervisor',postgres:own(p,'postgres')?p.pid:null,api:own(a,'api')?a.pid:null,frontend:own(f,'frontend')?f.pid:null,comprobaciones:ok?'correctas':'pendientes',smtp_real:smtp,catalogo:'http://127.0.0.1:5500/Catalogo.html',formulario:'http://127.0.0.1:5500/cotizacion.html'},null,2));
}
async function main(){
 if(process.env.NODE_ENV&&process.env.NODE_ENV!=='development')fail('Supervisor exclusivo de desarrollo: producción rechazada');
 if(process.argv.length!==3)fail('Se requiere un único modo del supervisor');
 if(process.versions.node.split('.')[0]!=='24')fail('Se requiere Node 24');
 const mode=process.argv[2];if(mode==='worker')return worker();runtime();
 if(mode==='brevo'){
  if(!process.stdin.isTTY||!process.stderr.isTTY)fail('El ensayo requiere tu terminal privada; no se admiten credenciales desde automatización');
  if(!running())fail('Inicia primero el entorno simulado');await health();
  const fd=fs.openSync(pauseFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.closeSync(fd);
  let child;
  const signal=()=>child?.kill('SIGINT');
  process.once('SIGINT',signal);process.once('SIGTERM',signal);
  try{
   await stopProcess(listener(3000),'api');
   child=spawn(process.execPath,[path.join(root,'api/scripts/web-local.cjs'),'api-smtp'],{cwd:root,env,stdio:'inherit'});
   await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Ensayo terminado con error: revisa el código seguro mostrado en tu terminal')));});
  }finally{
   if(fs.existsSync(pauseFile))fs.unlinkSync(pauseFile);process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
   let restored=false;
   for(let i=0;i<100;i++){try{await health();console.log('Ensayo terminado; entorno restaurado en simulación.');restored=true;break;}catch{await delay(200);}}
   if(!restored)fail('Comprueba el estado del supervisor antes de continuar');
  }
  return;
 }
 if(mode==='estado')return status();
 if(mode==='detener'||mode==='reiniciar'){
  const s=saved();if(s&&running()){
   const p=proc(s.supervisor.pid);if(!p||p.start!==s.supervisor.start||!p.args.includes(__filename)||!p.args.includes('worker'))fail('No se identifica el supervisor');
   process.kill(p.pid,'SIGTERM');for(let i=0;i<200&&running();i++)await delay(100);if(running())fail('Supervisor aún activo; no se fuerza su cierre');
  }else if(s&&s.estado!=='detenido'){await shutdown(s);}
  if(mode==='detener'){console.log('Entorno web local detenido ordenadamente; datos conservados.');return;}
 }
 if(mode==='iniciar'||mode==='reiniciar'){
  if(running()){await health();return status();}
  if(fs.existsSync(pauseFile))fs.unlinkSync(pauseFile);
  for(const [kind,port] of [['api',3000],['frontend',5500]]){const p=listener(port);if(p&&!own(p,kind))fail(`Puerto ${port} de otro proyecto: no se modifica`);}
  const result=tmux(['new-session','-d','-s',session,'-n','servicios',[process.execPath,__filename,'worker'].map(quote).join(' ')]);
  if(result.status!==0)fail('No se pudo crear el supervisor tmux');
  for(let i=0;i<150;i++){await delay(200);const s=saved();if(s?.estado==='activo')return status();if(!running())break;}
  fail('El entorno no confirmó su arranque; consulta estado y los logs privados del supervisor');
 }
 fail('Uso: entorno-web.sh iniciar|estado|detener|reiniciar|brevo');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={own,proc,quote};
