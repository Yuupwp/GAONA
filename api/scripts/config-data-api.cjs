const { URL } = require('node:url');
const project='kvuvetijtldpamrfslsg';
function validarDataApi(env) {
 const fail=()=>{throw Object.assign(Error('WEB_DATA_API: Configura URL GAONA, clave publicable, cuenta técnica, UID y claves estables en api/.env privado'),{seguro:true});};
 if(env.SUPABASE_URL!==`https://${project}.supabase.co`||env.SUPABASE_AUTH_EMAIL!=='gaona.proyint1@gmail.com'||!env.SUPABASE_AUTH_PASSWORD||env.SUPABASE_AUTH_PASSWORD.length>2048||/[\r\n\0]/.test(env.SUPABASE_AUTH_PASSWORD)||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(env.SUPABASE_AUTH_UID||''))fail();
 const key=env.SUPABASE_PUBLISHABLE_KEY||'';
 if(!/^sb_publishable_[A-Za-z\d_-]+$/.test(key)){
  try{const parts=key.split('.');const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());if(parts.length!==3||claims.role!=='anon'||claims.ref!==project)fail();}catch{fail();}
 }
 if(env.SOLICITUD_STORAGE!=='data-api'||![env.SOLICITUD_IDEMPOTENCY_KEY,env.SOLICITUD_PDF_KEY].every(k=>/^[a-f\d]{64}$/i.test(k||'')))fail();
 return new URL(env.SUPABASE_URL).origin;
}
module.exports={validarDataApi};
