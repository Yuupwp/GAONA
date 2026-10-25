const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {activar}=require('../api/scripts/activar-smtp-web.cjs');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-activar-smtp-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const calls=[];return{calls,shared:{directory,root:directory,entorno(real){assert.equal(real,true);return{WEB_CORREO_MODO:'smtp'};},config:()=>({apiPort:3000,frontendPort:5500}),async verificar(){calls.push('verificar');},async control(action){calls.push(action);return{smtp_real:false};},async worker(env,stop){calls.push('smtp');assert.equal(env.WEB_SMTP_DESTINATARIO,'recepcion@example.test');stop();}}};}
test('SMTP web: contrato no instalado o confirmación cancelada conservan los servicios simulados',async t=>{
 const {shared,calls}=fixture(t);const reject={...shared,async verificar(){throw Error('WEB_SMTP_PERSISTENCIA');}};
 await assert.rejects(activar(reject,{terminal:true}),/WEB_SMTP_PERSISTENCIA/);assert.deepEqual(calls,[]);
 const answers=['recepcion@example.test','NO AUTORIZO'];await assert.rejects(activar(shared,{terminal:true,preguntar:async()=>answers.shift()}),/WEB_SMTP_CONFIRMACION/);assert.deepEqual(calls,['verificar','estado']);
});
test('SMTP web: activación manual y cierre restauran la simulación, sin SMTP ni procesos reales',async t=>{
 const {shared,calls}=fixture(t),answers=['recepcion@example.test','ACTIVAR BREVO PARA COTIZACIONES NUEVAS'];
 await activar(shared,{terminal:true,preguntar:async()=>answers.shift(),restaurar(){calls.push('simulado');return{status:0};}});
 assert.deepEqual(calls,['verificar','estado','detener','smtp','simulado']);
});
