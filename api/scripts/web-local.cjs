const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const root = path.resolve(__dirname,'../..');
const directory = path.join(os.homedir(),'.local','state','gaona-web5c');
const pg = '/usr/lib/postgresql/17/bin';
const data = path.join(directory,'postgres');
const fail = () => { throw Error('Laboratorio web local no disponible; revisa los servicios locales sin reiniciar datos'); };
const sha = key => createHash('sha256').update(Buffer.from(key,'hex')).digest('hex');

function leerEstado() {
    const dir=fs.lstatSync(directory);
    if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077))fail();
    const fd=fs.openSync(path.join(directory,'runtime.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let state;
    try {
        const info=fs.fstatSync(fd);
        if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077))fail();
        state=JSON.parse(fs.readFileSync(fd));
    } finally {fs.closeSync(fd);}
    if(state.version!==1||!Number.isInteger(state.port)||state.port<1024||state.port>65535||state.port===5432||
        !/^[a-f\d]{64}$/.test(state.idempotencia)||!/^[a-f\d]{64}$/.test(state.acceso))fail();
    if(fs.lstatSync(data).isSymbolicLink()||!fs.realpathSync(data).startsWith(fs.realpathSync(directory)+path.sep))fail();
    return state;
}
function ambiente(state) {
    return {PATH:path.dirname(process.execPath)+':/usr/bin:/bin',PGHOST:'127.0.0.1',PGPORT:String(state.port),
        PGUSER:'gaona_web5c_admin',PGDATABASE:'gaona_web5c_aislada',PGCONNECT_TIMEOUT:'3'};
}
function comando(binary,args,env,input) {
    const result=spawnSync(path.join(pg,binary),args,{env,input,encoding:'utf8',maxBuffer:4*1024*1024});
    if(result.status!==0)throw Error(`Falló ${binary} en el entorno web local; no se muestran argumentos ni configuración privada`);
    return result.stdout;
}
function activo(state) {
    return spawnSync(path.join(pg,'pg_ctl'),['-D',data,'status'],{env:ambiente(state),stdio:'ignore'}).status===0;
}
async function preparar() {
    if(fs.existsSync(directory)){leerEstado();console.log('Entorno web local ya preparado; datos y claves conservados.');return;}
    const server=net.createServer();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    await new Promise(resolve=>server.close(resolve));
    if(port===5432||port<1024)fail();
    fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
    fs.mkdirSync(directory,{mode:0o700});
    const state={version:1,port,idempotencia:randomBytes(32).toString('hex'),acceso:randomBytes(32).toString('hex')};
    fs.writeFileSync(path.join(directory,'runtime.json'),JSON.stringify(state),{mode:0o600,flag:'wx'});
    const env=ambiente(state);let started=false;
    try {
        comando('initdb',['-D',data,'-U','gaona_web5c_admin','--auth=trust','--encoding=UTF8','--locale=C','--no-instructions'],env);
        comando('pg_ctl',['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${directory}`,'-w','start'],env);started=true;
        comando('createdb',['gaona_web5c_aislada'],{...env,PGDATABASE:'postgres'});
        const sql=(args,input)=>comando('psql',['-X','-v','ON_ERROR_STOP=1',...args],env,input);
        sql([],'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
        sql(['-f',path.join(root,'tests/fixtures/supabase-estructura.sql')]);
        comando('psql',['-X','-v','ON_ERROR_STOP=1','-f',path.join(root,'api/propuestas/web/01-instalacion.sql')],
            {...env,PGOPTIONS:'-c gaona.web3_fk_restrict_aprobado=si'});
        sql(['-f',path.join(root,'api/propuestas/web/02-permisos.sql')]);
        sql([],`CREATE ROLE gaona_web5c_web LOGIN IN ROLE gaona_web_publico NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
            UPDATE gaona_mensajeria.configuracion SET idempotencia_huella='${sha(state.idempotencia)}',acceso_huella='${sha(state.acceso)}' WHERE id=1;
`);
        console.log('Entorno web local preparado: PostgreSQL 17 aislado, rol restringido, sin productos de ensayo publicados y correo exclusivamente simulado.');
    } finally {if(started)comando('pg_ctl',['-D',data,'-m','fast','-w','stop'],env);}
}
async function servicio(mode) {
    const state=leerEstado();
    const real=mode==='api-smtp';
    if(mode==='postgres'&&activo(state))throw Error('PostgreSQL local ya está activo; conserva su terminal actual');
    if(mode!=='postgres'&&!activo(state))throw Error('Inicia primero PostgreSQL local en otra terminal');
    const secretos=real?require('./web-local-privado.cjs').credenciales(directory):undefined;
    const env=mode==='postgres'?ambiente(state):{
        PATH:path.dirname(process.execPath)+':/usr/bin:/bin',NODE_ENV:'development',GAONA_WEB_LOCAL:'WEB5C_POSTGRES_LOCAL',
        WEB_DATABASE_URL:`postgresql://gaona_web5c_web@127.0.0.1:${state.port}/gaona_web5c_aislada?connection_limit=3`,
        WEB_HOST:'127.0.0.1',WEB_PORT:'3000',SOLICITUD_STORAGE:'postgres',SOLICITUD_IDEMPOTENCY_KEY:state.idempotencia,
        SOLICITUD_PDF_KEY:state.acceso,MAIL_ENABLED:'false',WHATSAPP_ENABLED:'false',GAONA_WEB_LOCAL_DIR:directory,
        ...(real?{GAONA_WEB_LOCAL_SMTP:'confirmado'}:{})
    };
    const binary=mode==='postgres'?path.join(pg,'postgres'):process.execPath;
    const args=mode==='postgres'?['-D',data,'-h','127.0.0.1','-p',String(state.port),'-k',directory]:
        ['--require',require.resolve('tsx/cjs'),path.join(root,'api/src/web-local.ts')];
    const child=spawn(binary,args,{env,stdio:real?['inherit','inherit','inherit','ipc']:'inherit',cwd:root});
    if(real)require('./canal-smtp-local.cjs').entregarConfiguracion(child,secretos);
    const stop=()=>child.kill('SIGINT');
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0||['SIGINT','SIGTERM'].includes(signal)?resolve():reject(Error('Servicio web local detenido con error')));});
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
async function main() {
    if(process.argv.length!==3||process.versions.node.split('.')[0]!=='24'||(process.env.NODE_ENV&&process.env.NODE_ENV!=='development'))fail();
    const mode=process.argv[2];
    if(mode==='preparar')return preparar();
    if(['postgres','api','api-smtp'].includes(mode))return servicio(mode);
    if(mode==='configurar-correo'){leerEstado();return require('./web-local-privado.cjs').configurar(directory);}
    if(mode==='estado'){const state=leerEstado();console.log(JSON.stringify({laboratorio:'WEB-5C',postgres_activo:activo(state),api:'http://localhost:3000',smtp_real:false}));return;}
    fail();
}
if(require.main===module)main().catch(error=>{console.error(error instanceof Error&&/^(Laboratorio|Inicia primero|PostgreSQL local|Falló|Servicio web local|SMTP_[A-Z_]+:)/.test(error.message)?error.message:'Entorno web detenido por configuración local inválida');process.exitCode=1;});
