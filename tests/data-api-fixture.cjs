const http=require('node:http');
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.join(__dirname,'../api/package.json'));req('tsx/cjs');
const {PrismaClient}=req('@prisma/client');
const uid='00000000-0000-4000-8000-000000000001';
const env={NODE_ENV:'development',SOLICITUD_STORAGE:'data-api',SUPABASE_URL:'https://kvuvetijtldpamrfslsg.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_clave_ficticia',SUPABASE_AUTH_EMAIL:'gaona.proyint1@gmail.com',SUPABASE_AUTH_PASSWORD:'clave-ficticia',SUPABASE_AUTH_UID:uid,SOLICITUD_IDEMPOTENCY_KEY:'c'.repeat(64),SOLICITUD_PDF_KEY:'e'.repeat(64),MAIL_ENABLED:'false',WHATSAPP_ENABLED:'false'};
function urlLocal(value){const u=new URL(value);if(u.hostname!=='127.0.0.1'||u.pathname!=='/gaona_data_api_aislada'||u.username!=='gaona_local_admin'||!u.port||u.port==='5432')throw Error('Se requiere la base Data API local aislada');return value;}
async function gateway(){
 const db=new PrismaClient({datasources:{db:{url:urlLocal(process.env.GAONA_DATA_API_TEST_ADMIN_URL)}},log:[]});
 let now=Date.now(),passwords=0,refreshes=0,refresh='inicial',wrong=false;
 const counters={external:0,requests:0};
 const session=()=>{const id=wrong?'00000000-0000-4000-8000-000000000002':uid;const payload={sub:id,role:'authenticated',iss:env.SUPABASE_URL+'/auth/v1',exp:Math.floor(now/1000)+3600};const access=[Buffer.from('{"alg":"ficticio"}').toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'firma-simulada'].join('.');refresh='renovacion-ficticia-'+(passwords+refreshes);return{access_token:access,refresh_token:refresh,user:{id}};};
 const server=http.createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');let text='';for await(const chunk of request){text+=chunk;if(text.length>4*1024*1024){response.writeHead(413).end();return;}}
  const send=(status,data)=>response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
  const input=text?JSON.parse(text):{};
  if(request.headers.apikey!==env.SUPABASE_PUBLISHABLE_KEY){send(401,{error:'clave inválida'});return;}
  if(url.pathname==='/auth/v1/token'){
   if(url.searchParams.get('grant_type')==='refresh_token'){if(input.refresh_token!==refresh){send(401,{error:'renovación inválida'});return;}refreshes++;}
   else{if(input.email!==env.SUPABASE_AUTH_EMAIL||input.password!==env.SUPABASE_AUTH_PASSWORD){send(401,{error:'sesión inválida'});return;}passwords++;}
   send(200,session());return;
  }
  let claims;try{claims=JSON.parse(Buffer.from((request.headers.authorization||'').split('.')[1],'base64url').toString());if(claims.role!=='authenticated'||claims.exp<=now/1000)throw Error();}catch{send(401,{error:'token inválido'});return;}
  try{
   const result=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');
    await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub',${claims.sub},true)`;
    if(url.pathname==='/rest/v1/productos'){
     return tx.$queryRaw`SELECT p.id,p.nombre,p.descripcion,p."precioDesde",p."imagenUrl",json_build_object('nombre',c.nombre) AS categoria FROM public.productos p LEFT JOIN public.categorias c ON c.id=p."idCategoria" WHERE p.activo=true AND p.tipo='PRODUCTO' ORDER BY p.nombre`;
    }
    if(url.pathname==='/rest/v1/rpc/gaona_web_operacion'){
     const [r]=await tx.$queryRaw`SELECT public.gaona_web_operacion(${input.p_accion},${JSON.stringify(input.p_args)}::jsonb) AS valor`;return r.valor;
    }
    throw Error();
   },{maxWait:10000,timeout:20000});send(200,result);
  }catch{send(403,{error:'Operación denegada; sin detalles internos'});}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 return{db,env:{...env},uid,counters,base,ahora:()=>now,avanzar:()=>{now+=3550*1000;},otraIdentidad:()=>{wrong=true;},contar:()=>({passwords,refreshes}),
  fetch:async(url,options)=>{if(!String(url).startsWith(env.SUPABASE_URL+'/')){counters.external++;throw Error('Destino externo bloqueado');}counters.requests++;return fetch(base+String(url).slice(env.SUPABASE_URL.length),options);},
  async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await db.$disconnect();}};
}
module.exports={gateway,env,uid,req,urlLocal};
