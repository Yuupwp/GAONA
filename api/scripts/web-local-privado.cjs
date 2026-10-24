const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function privado(directory, name) {
    const fd=fs.openSync(path.join(directory,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
        const s=fs.fstatSync(fd);
        if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077))throw Error();
        return JSON.parse(fs.readFileSync(fd));
    } finally {fs.closeSync(fd);}
}
function interactivo(code) {
    if(!process.stdin.isTTY||!process.stderr.isTTY)throw Error('SMTP_TERMINAL: Se requiere una terminal local interactiva; no se aceptan secretos por argumentos');
    const result=spawnSync('/usr/bin/python3',['-c',`import getpass,json,warnings,sys
warnings.simplefilter('error',getpass.GetPassWarning)
def texto_terminal(value):
    inicio='\\x1b[200~'
    fin='\\x1b[201~'
    if value.startswith(inicio) and value.endswith(fin):
        return value[len(inicio):-len(fin)]
    return value
def oculto(prompt):
    try:
        return texto_terminal(getpass.getpass(prompt))
    except (EOFError,KeyboardInterrupt,getpass.GetPassWarning,OSError):
        raise SystemExit(24) from None
${code}`],{env:{PATH:'/usr/bin:/bin'},stdio:['inherit','pipe','inherit'],encoding:'utf8',maxBuffer:8192});
    if(result.error)throw Error('SMTP_ENTRADA_PROCESO: No se pudo iniciar la lectura privada');
    if(result.status!==0)throw Error(result.status===21?'SMTP_CONFIRMACION: Confirmación no recibida':result.status===22?
        'SMTP_DATOS_INVALIDOS: Datos SMTP vacíos, demasiado largos, con controles o API key en lugar de clave SMTP':'SMTP_ENTRADA_CANCELADA: Lectura privada cancelada o sin terminal segura');
    try{return JSON.parse(result.stdout);}catch{throw Error('SMTP_ENTRADA_FORMATO: La lectura privada no produjo un resultado válido');}
}
function configurar(directory) {
    const value=interactivo(`emails=[]
for i in range(3):
    v=oculto('Destinatario autorizado '+str(i+1)+' (vacío para terminar, sin eco): ').strip()
    if not v: break
    emails.append(v)
print(json.dumps(dict(version=1,habilitado=False,remitente='gaona.proyint1@gmail.com',destinatarios=emails)))`);
    require('tsx/cjs');
    require('../src/correo-ensayo-local').validarConfiguracionEnsayo(value);
    const fd=fs.openSync(path.join(directory,'destinatarios.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try {fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    console.log('Lista privada guardada fuera del repositorio. SMTP real permanece deshabilitado.');
}
function credenciales(directory) {
    require('tsx/cjs');
    let config;
    try{config=require('../src/correo-ensayo-local').validarConfiguracionEnsayo(privado(directory,'destinatarios.json'));}
    catch{throw Error('SMTP_LISTA_INVALIDA: Revisa existencia, permisos y formato de la lista privada');}
    console.log(JSON.stringify({remitente:config.remitente,destinatarios:config.destinatarios,maximo_intentos_por_solicitud:1,maximo_envios_por_sesion:1,reintentos:false,duracion_minutos:30}));
    const value=interactivo(`if oculto('Escribe AUTORIZO ENSAYO SMTP LOCAL para iniciar esta sesión: ').strip() != 'AUTORIZO ENSAYO SMTP LOCAL': raise SystemExit(21)
d=oculto('Destinatario autorizado para esta única prueba (sin eco): ').strip()
u=oculto('Usuario SMTP de Brevo (sin eco): ')
p=oculto('Clave SMTP de Brevo (sin eco, no API key): ')
if not u or not p or len(u)>320 or len(p)>2048 or any(ord(c) in (0,10,13) for c in u+p) or p.lower().startswith('xkeysib-'): raise SystemExit(22)
print(json.dumps(dict(usuario=u,clave=p,destinatario=d)))`);
    if(!config.destinatarios.includes(value.destinatario))throw Error('SMTP_DESTINO_NO_AUTORIZADO: El destinatario no pertenece a la lista privada');
    return value;
}
module.exports={configurar,credenciales};
