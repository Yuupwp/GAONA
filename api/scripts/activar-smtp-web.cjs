require('tsx/cjs');
const {createInterface}=require('node:readline/promises');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fail=message=>{throw Object.assign(Error(message),{seguro:true});};
async function activar(shared,dependencies={}){
 if(!(dependencies.terminal??(process.stdin.isTTY&&process.stdout.isTTY)))fail('WEB_SMTP_TERMINAL: Se requiere una terminal privada interactiva');
 const env=shared.entorno(true),config=shared.config(env);
 if(config.apiPort!==3000||config.frontendPort!==5500)fail('WEB_SMTP_ORIGEN: El ensayo requiere API 3000 y frontend 5500 en 127.0.0.1');
 await shared.verificar(env);
 const current=await shared.control('estado');if(!current||current.smtp_real)fail('WEB_SMTP_ESTADO: Inicia primero el entorno habitual en simulación');
 const rl=dependencies.preguntar?null:createInterface({input:process.stdin,output:process.stdout});
 const preguntar=dependencies.preguntar||(prompt=>rl.question(prompt));let destinatario,confirmation;
 try{
  destinatario=(await preguntar('Único destinatario autorizado para esta sesión de pruebas: ')).trim();
  if(!require('../src/solicitud-correo-validacion').correoValido.safeParse(destinatario).success)fail('WEB_SMTP_DESTINATARIO: Dirección no válida');
  confirmation=await preguntar(`Nuevas cotizaciones a ${destinatario}, máximo un intento por solicitud. Escribe ACTIVAR BREVO PARA COTIZACIONES NUEVAS: `);
 }finally{rl?.close();}
 if(confirmation!=='ACTIVAR BREVO PARA COTIZACIONES NUEVAS')fail('WEB_SMTP_CONFIRMACION: Activación cancelada; se conserva la simulación');
 if(!await shared.control('detener'))fail('WEB_SMTP_PARADA: No se confirmó la parada del supervisor propio');
 const lock=path.join(shared.directory,'supervisor.lock');for(let i=0;i<150&&fs.existsSync(lock);i++)await delay(100);
 if(fs.existsSync(lock))fail('WEB_SMTP_PARADA: No se liberó el entorno propio; no se fuerza ningún proceso');
 env.WEB_SMTP_DESTINATARIO=destinatario;
 const ready=()=>console.log('SMTP local activo hasta Ctrl+C o un máximo de 15 minutos. Mantén esta terminal abierta y registra una cotización NUEVA en http://127.0.0.1:5500/cotizacion.html.');
 try{await new Promise((resolve,reject)=>{shared.worker(env,resolve,ready).catch(reject);});}
 finally{
  const restore=dependencies.restaurar||(()=>spawnSync(process.execPath,[path.join(shared.root,'api/scripts/entorno-compartido.cjs'),'iniciar'],{stdio:'inherit',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','LANG','USERPROFILE','SystemRoot','TEMP','TMP'].includes(k)))}));
  const result=restore();if(result?.status!==0)fail('WEB_SMTP_RESTAURACION: Ejecuta npm run web:iniciar para restaurar simulación');
  console.log('Sesión SMTP cerrada; entorno restaurado en simulación.');
 }
}
module.exports={activar};
