const fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),file=path.join(root,'api/.env');
function main(){
 if(process.versions.node.split('.')[0]!=='24')throw Object.assign(Error('NODE_VERSION'),{codigo:'NODE_VERSION'});
 if(process.argv.length!==3||!['claves','parametros'].includes(process.argv[2]))throw Error('Usa claves|parametros con Node 24');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let text;
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('api/.env requiere permisos 600');text=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
 const values=require('dotenv').parse(text);
 if(process.argv[2]==='claves'){
  for(const name of ['SOLICITUD_IDEMPOTENCY_KEY','SOLICITUD_PDF_KEY']){
   if(values[name]){if(!/^[a-f0-9]{64}$/i.test(values[name]))throw Error('Clave existente inválida; se conserva sin reemplazar');continue;}
   const line=`${name}=${randomBytes(32).toString('hex')}`;
   text=new RegExp(`^${name}=.*$`,'m').test(text)?text.replace(new RegExp(`^${name}=.*$`,'m'),line):text+'\n'+line+'\n';
  }
  const temp=file+'.temporal-'+process.pid;fs.writeFileSync(temp,text,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);
  console.log('Claves conservadas o generadas privadamente. Compártelas por canal seguro para esta única instalación compartida; nunca regenerarlas por integrante.');return;
 }
 for(const k of ['SOLICITUD_IDEMPOTENCY_KEY','SOLICITUD_PDF_KEY'])if(!/^[a-f0-9]{64}$/i.test(values[k]||''))throw Error('Faltan claves estables');
 if(!/^[a-f0-9-]{36}$/.test(values.SUPABASE_AUTH_UID||''))throw Error('Falta UID técnico autorizado');
 const hash=k=>createHash('sha256').update(Buffer.from(k,'hex')).digest('hex');
 console.log(JSON.stringify({backend_uid:values.SUPABASE_AUTH_UID,idempotencia_huella:hash(values.SOLICITUD_IDEMPOTENCY_KEY),acceso_huella:hash(values.SOLICITUD_PDF_KEY)},null,2));
}
try{main();}catch(error){console.error(error.codigo==='NODE_VERSION'?'Preparación rechazada: se requiere Node.js 24. Ejecuta nvm use 24 y repite el comando.':'Preparación rechazada; revisa permisos, UID y claves privadas. No se muestran secretos.');process.exitCode=1;}
