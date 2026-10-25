const {spawn}=require('node:child_process');
const path=require('node:path');
const [mode,directory]=process.argv.slice(2);
if(mode==='padre'){
 if(!process.stdin.isTTY||!process.stderr.isTTY)process.exit(4);
 const child=spawn(process.execPath,[__filename,'lector',directory],{stdio:'inherit',env:{PATH:process.env.PATH,HOME:process.env.HOME,TERM:'xterm-256color'}});
 child.once('exit',code=>{process.exitCode=code??1;});
}else{
 try{
  const v=require('../../api/scripts/web-local-privado.cjs').credenciales(directory);
  const child=spawn(process.execPath,[path.join(__dirname,'smtp-terminal-receptor.cjs')],{stdio:['inherit','inherit','inherit','ipc'],env:{PATH:process.env.PATH}});
  require('../../api/scripts/canal-smtp-local.cjs').entregarConfiguracion(child,v,2000);
  child.once('exit',code=>{console.log(v.clave===''&&v.usuario===''?'PTY_ORIGEN_LIMPIO':'PTY_ORIGEN_FALLO');process.exitCode=code??1;});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
