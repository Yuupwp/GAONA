const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {recibirConfiguracion,entregarConfiguracion}=require('../api/scripts/canal-smtp-local.cjs');
for(const scenario of ['normal','pegado','incorrecta','ajeno','cancelar','eof'])test('SMTP TTY real anidada: '+scenario,()=>{
 const r=spawnSync('/usr/bin/python3',[path.join(__dirname,'fixtures/smtp-terminal-pty.py'),process.execPath,path.resolve(__dirname,'..'),scenario],{env:{PATH:process.env.PATH,HOME:require('node:os').homedir()},encoding:'utf8',timeout:18000});
 assert.equal(r.status,0);const result=JSON.parse(r.stdout);
 assert.equal(result.timeout,false);assert.equal(result.password_visible,false);assert.equal(result.echo_oculto,true);assert.equal(result.echo_restaurado,true);assert.equal(result.lista_conservada,true);
 if(['normal','pegado'].includes(scenario)){assert.equal(result.exit,0);assert.equal(result.recibido,true);assert.equal(result.origen_limpio,true);assert.equal(result.prompts,4);}
 else{assert.notEqual(result.exit,0);assert.equal(result.recibido,false);if(scenario==='incorrecta')assert.equal(result.confirmacion_rechazada,true);if(scenario==='ajeno')assert.equal(result.destinatario_rechazado,true);}
});
test('IPC SMTP privado rechaza ausencia, mensaje inválido y silencio sin revelar datos',async()=>{
 await assert.rejects(recibirConfiguracion({},20),e=>e.code==='SMTP_CONFIGURACION');
 for(const sendBad of [true,false]){
  const canal=new EventEmitter();canal.connected=true;canal.send=()=>{if(sendBad)setImmediate(()=>canal.emit('message',{tipo:'incorrecto',valor:'dato-ficticio'}));};
  await assert.rejects(recibirConfiguracion(canal,20),e=>e.code==='SMTP_CONFIGURACION'&&!e.message.includes('dato-ficticio'));
 }
});
