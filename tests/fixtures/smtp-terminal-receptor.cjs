const {recibirConfiguracion}=require('../../api/scripts/canal-smtp-local.cjs');
recibirConfiguracion(process,2000).then(v=>{
 const ok=v.destinatario==='ficticio@example.test'&&v.usuario==='usuario-ficticio'&&v.clave==='ClaveFicticia000';
 v.usuario='';v.clave='';
 console.log(ok?'PTY_RECEPTOR_OK':'PTY_RECEPTOR_FALLO');process.exitCode=ok?0:1;
}).catch(()=>{console.log('PTY_RECEPTOR_RECHAZADO');if(process.connected)process.disconnect();process.exitCode=1;});
