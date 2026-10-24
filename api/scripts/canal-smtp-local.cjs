const mensajeError=()=>Object.assign(Error('SMTP_CONFIGURACION: No se completó el canal privado de configuración'),{code:'SMTP_CONFIGURACION'});
function limpiar(secretos){for(const key of ['usuario','clave','destinatario'])if(secretos)secretos[key]='';}
function entregarConfiguracion(child,secretos,plazo=20000){
 let enviado=false,finished=false;
 const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);child.off('message',ready);child.off('exit',finish);child.off('error',finish);limpiar(secretos);};
 const cancelar=()=>{if(finished)return;finish();console.error(mensajeError().message);child.kill('SIGTERM');};
 const ready=message=>{
  if(message?.tipo!=='configuracion-lista'||enviado)return;
  enviado=true;
  try{child.send({tipo:'configuracion-smtp',valor:secretos},error=>{if(error)cancelar();else finish();});}catch{cancelar();}
 };
 const timer=setTimeout(cancelar,plazo);
 child.on('message',ready);child.once('exit',finish);child.once('error',finish);
 return finish;
}
function recibirConfiguracion(canal=process,plazo=20000){
 return new Promise((resolve,reject)=>{
  if(typeof canal.send!=='function'||!canal.connected){reject(mensajeError());return;}
  let complete=false;
  const finish=(error,value)=>{
   if(complete)return;complete=true;clearTimeout(timer);canal.off('message',received);canal.off('disconnect',disconnected);
   if(error)reject(mensajeError());else resolve(value);
  };
  const disconnected=()=>finish(true);
  const received=message=>{
   const v=message?.valor;
   if(message?.tipo!=='configuracion-smtp'||!v||typeof v.usuario!=='string'||!v.usuario||v.usuario.length>320||
      typeof v.clave!=='string'||!v.clave||v.clave.length>2048||/[\r\n\x00]/.test(v.usuario+v.clave)||/^xkeysib-/i.test(v.clave)||
      typeof v.destinatario!=='string'||v.destinatario.length>150){finish(true);return;}
   finish(false,v);
   if(canal.connected)canal.disconnect();
  };
  const timer=setTimeout(()=>finish(true),plazo);
  canal.on('message',received);canal.once('disconnect',disconnected);
  canal.send({tipo:'configuracion-lista'},error=>{if(error)finish(true);});
 });
}
module.exports={entregarConfiguracion,recibirConfiguracion};
