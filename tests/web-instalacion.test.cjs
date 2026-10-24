const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { env } = require('./persistencia-fixture.cjs');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
const { apiRequire, iniciarEntrada, iniciarSimulada, sembrar, datos, post, sha, root } = require('./web-postgres-lab.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const url = process.env.GAONA_WEB3_TEST_DATABASE_URL;
const admin = process.env.GAONA_WEB3_TEST_ADMIN_URL;
const local = (name, run) => test(name, { skip: !url || !admin }, run);
function validar(value, user) {
    const parsed = new URL(value);
    assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.pathname, '/gaona_web3_aislada');
    assert.equal(parsed.username, user); assert.ok(parsed.port && parsed.port !== '5432');
    return parsed;
}
let db, owner, products;
before(async () => {
    if (!url || !admin) return;
    validar(url, 'gaona_web_publico_pruebas'); validar(admin, 'gaona_local_admin');
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    owner = new PrismaClient({ datasources: { db: { url: admin } }, log: [] });
    products = await sembrar(owner);
});
after(async () => { await db?.$disconnect(); await owner?.$disconnect(); });

local('Instalación PostgreSQL: instalación de cuatro tablas sin WhatsApp, identidad NOLOGIN y privilegios por columna', async () => {
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='gaona_mensajeria' ORDER BY tablename`;
    assert.deepEqual(tables.map(row => row.tablename), ['configuracion','correos','documentos','registros_web']);
    const roles = await db.$queryRaw`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
        FROM pg_roles WHERE rolname IN ('gaona_web_publico','gaona_web_publico_login',current_user)`;
    assert.equal(roles.length, 3);
    assert.ok(roles.every(row => !row.rolsuper && !row.rolbypassrls && !row.rolcreatedb && !row.rolcreaterole && !row.rolreplication));
    assert.equal(roles.find(row => row.rolname==='gaona_web_publico_login').rolcanlogin, false);
    assert.deepEqual(await db.$queryRaw`SELECT has_column_privilege(current_user,'public.clientes','id','SELECT') AS id,
        has_column_privilege(current_user,'public.clientes','correo','SELECT') AS correo,
        has_column_privilege(current_user,'public.clientes','telefono','SELECT') AS telefono,
        has_table_privilege(current_user,'public.usuarios','SELECT') AS usuarios,
        has_table_privilege(current_user,'public.pagos','INSERT') AS pagos,
        has_schema_privilege(current_user,'public','CREATE') AS ddl`, [{ id: true, correo: false, telefono: false, usuarios: false, pagos: false, ddl: false }]);
    await assert.rejects(db.cliente.findMany()); await assert.rejects(db.usuario.findMany());
    await assert.rejects(db.cotizacion.findMany()); await assert.rejects(db.inventario.findMany());
    const policies = await db.$queryRaw`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' AND c.relkind='r'`;
    assert.ok(policies.every(row => row.relrowsecurity));
    for (const role of ['anon','authenticated','service_role']) {
        const access = await owner.$queryRawUnsafe(`SELECT has_schema_privilege('${role}','gaona_mensajeria','USAGE') AS uso`);
        assert.equal(access[0].uso, false);
    }
    const triggers = await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgrelid='public.clientes'::regclass AND NOT tgisinternal`;
    assert.ok(triggers.some(row=>row.tgname==='trg_clientes_upd'));
    assert.ok(triggers.some(row=>row.tgname==='gaona_web3_cliente_vinculado'));
});

local('Instalación PostgreSQL: web.ts con permisos mínimos registra, conserva idempotencia y recupera PDF al reiniciar', async () => {
    let api = await iniciarEntrada({ WEB_DATABASE_URL: url, NODE_ENV: 'production', WHATSAPP_IDEMPOTENCY_KEY: undefined });
    try {
        const catalog = await fetch(api.base + '/productos'); assert.equal(catalog.status, 200);
        assert.ok((await catalog.json()).some(row=>row.id===products[0].id));
        const input = datos(products), key = 'web3-' + randomUUID();
        const responses = await Promise.all(Array.from({ length: 6 },()=>post(api.base,'/solicitudes',input,key)));
        for (const response of responses) assert.equal(response.status,201);
        const results = await Promise.all(responses.map(response=>response.json()));
        const record=results[0]; assert.ok(results.every(row=>row.id===record.id));
        assert.equal(record.estimado.total,'2900.70'); assert.equal(record.correo.estado,'no_disponible');
        const response = await post(api.base,'/solicitudes/pdf',{token:record.pdf.token}); assert.equal(response.status,200);
        const pdf = Buffer.from(await response.arrayBuffer());
        const stored = (await db.$queryRaw`SELECT pdf,pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id=${record.id}`)[0];
        assert.equal(stored.pdf_sha256,sha(pdf)); assert.deepEqual(Buffer.from(stored.pdf),pdf);
        assert.equal(await api.imports(),'');
        await api.close(); api=await iniciarEntrada({ WEB_DATABASE_URL:url,NODE_ENV:'production',WHATSAPP_IDEMPOTENCY_KEY:undefined });
        const repeated=await post(api.base,'/solicitudes',input,key); assert.equal(repeated.status,201);
        assert.equal((await repeated.json()).id,record.id);
        assert.deepEqual(Buffer.from(await (await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).arrayBuffer()),pdf);
        assert.equal(await owner.solicitud.count({where:{descripcion:input.descripcion}}),1);
        for(const route of ['/clientes','/empleados']) assert.equal((await fetch(api.base+route)).status,404);
    } finally {await api.close();}
});

local('Instalación PostgreSQL: entrada real prioriza secretos inyectados y conserva PDF tras reinicio con correo bloqueado', async () => {
    const injected = { WEB_DATABASE_URL:url, NODE_ENV:'production', SOLICITUD_PDF_KEY:env.SOLICITUD_PDF_KEY,
        SOLICITUD_IDEMPOTENCY_KEY:env.SOLICITUD_IDEMPOTENCY_KEY, MAIL_ENABLED:'true', WHATSAPP_ENABLED:'true',
        SMTP_HOST:'smtp-relay.brevo.com', SMTP_PORT:'587', SMTP_SECURE:'false', SMTP_USER:'usuario-brevo-simulado',
        SMTP_PASSWORD:'clave-brevo-simulada', SMTP_FROM:'remitente@example.test' };
    const file = { WEB_DATABASE_URL:'postgresql://no-usar.invalid/aislada', SOLICITUD_PDF_KEY:'f'.repeat(64),
        SOLICITUD_IDEMPOTENCY_KEY:'f'.repeat(64), WHATSAPP_IDEMPOTENCY_KEY:undefined };
    let api=await iniciarEntrada(file,injected);
    try {
        const input=datos(products),key='web4-inyectada-'+randomUUID();
        const response=await post(api.base,'/solicitudes',input,key);assert.equal(response.status,201);
        const record=await response.json();assert.equal(record.correo.estado,'no_disponible');
        const download=await post(api.base,'/solicitudes/pdf',{token:record.pdf.token});assert.equal(download.status,200);
        const pdf=Buffer.from(await download.arrayBuffer());
        assert.equal((await db.$queryRaw`SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id=${record.id}`)[0].intentos,0);
        await api.close();api=await iniciarEntrada({...file,SOLICITUD_PDF_KEY:'d'.repeat(64)},injected);
        assert.equal((await (await post(api.base,'/solicitudes',input,key)).json()).id,record.id);
        assert.deepEqual(Buffer.from(await (await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).arrayBuffer()),pdf);
        assert.equal(await owner.solicitud.count({where:{descripcion:input.descripcion}}),1);
        assert.equal(await api.imports(),'');
    } finally {await api.close();}
});

local('Instalación PostgreSQL: Brevo simulado conserva documento canónico y único intento sin tablas de WhatsApp', async () => {
    const smtp = { ...env, SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
        SMTP_USER: 'usuario-brevo-simulado', SMTP_PASSWORD: 'clave-brevo-simulada', SMTP_FROM: 'remitente@example.test' };
    let api=await iniciarSimulada(db,{env:smtp,apiEnv:smtp});
    try {
        const input=datos(products), key='web3-smtp-'+randomUUID();
        const response=await post(api.base,'/solicitudes',input,key); assert.equal(response.status,201);
        const record=await response.json(); assert.equal(record.correo.estado,'aceptado');
        const pdf=Buffer.from(await (await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).arrayBuffer());
        assert.deepEqual(api.state.messages[0].message.attachments[0].content,pdf);
        assert.equal(api.state.messages[0].message.to.address,input.cliente.correo);
        assert.deepEqual(api.state.messages[0].message.envelope.to,[input.cliente.correo]);
        assert.equal(api.state.messages[0].message.from.address,smtp.SMTP_FROM);
        assert.equal(api.state.messages[0].message.subject,`GAONA | Solicitud de cotización - ${record.id}`);
        assert.equal(api.state.smtp[0].host,smtp.SMTP_HOST);
        assert.equal(api.state.smtp[0].requireTLS,true);
        assert.equal(api.state.smtp[0].tls.rejectUnauthorized,true);
        assert.equal(api.state.mailCalls,1);
        const email=(await db.$queryRaw`SELECT intentos,adjunto_sha256 FROM gaona_mensajeria.correos WHERE solicitud_id=${record.id}`)[0];
        assert.deepEqual(email,{intentos:1,adjunto_sha256:sha(pdf)});
        await api.close();api=await iniciarSimulada(db,{env:smtp,apiEnv:smtp});
        assert.equal((await (await post(api.base,'/solicitudes',input,key)).json()).id,record.id);
        assert.equal(api.state.mailCalls,0);
    } finally {await api.close();}
});

local('Instalación PostgreSQL: RLS limita altas WEB y exige vincular clientes al confirmar la transacción', async () => {
    const client=await owner.cliente.create({data:{nombre:'PRUEBA',apellido:'ADMIN LOCAL',telefono:'0000000000'}});
    const denied=error=>error.code==='P2010' && ['42501','23514'].includes(error.meta?.code);
    await assert.rejects(db.$executeRaw`INSERT INTO public.solicitudes(id,"idCliente",origen,"actualizadoEn") VALUES (${randomUUID()},${client.id},'ESCRITORIO',now())`,denied);
    await assert.rejects(db.$executeRaw`INSERT INTO public.clientes(id,nombre,apellido,telefono,"actualizadoEn") VALUES (${randomUUID()},'PRUEBA','HUERFANA','0000000000',now())`,denied);
    await assert.rejects(db.$executeRaw`UPDATE public.clientes SET nombre='NO' WHERE id=${client.id}`,denied);
    const manual=await owner.solicitud.create({data:{idCliente:client.id,origen:'ESCRITORIO'}});
    assert.deepEqual(await db.solicitud.findMany({where:{id:manual.id},select:{id:true}}),[]);
    await assert.rejects(db.$executeRaw`INSERT INTO public.solicitud_detalles(id,"idSolicitud","idProducto",cantidad) VALUES (${randomUUID()},${manual.id},${products[0].id},1)`,denied);
    await assert.rejects(db.$executeRawUnsafe('SET ROLE gaona_local_admin'));
});

local('Instalación PostgreSQL: FK RESTRICT preserva historial y revierte el borrado administrativo completo', async () => {
    const api=await iniciarSimulada(db,{env:{...env,MAIL_ENABLED:'false'},apiEnv:{...env,MAIL_ENABLED:'false'}});
    try {
        const record=await (await post(api.base,'/solicitudes',datos(products))).json();
        const original=await owner.solicitud.findUnique({where:{id:record.id}});
        await assert.rejects(owner.$transaction([
            owner.cita.deleteMany({where:{solicitud:{idCliente:original.idCliente}}}),
            owner.solicitud.deleteMany({where:{idCliente:original.idCliente}}),
            owner.cliente.delete({where:{id:original.idCliente}})
        ]),error=>error.code==='P2003');
        assert.ok(await owner.cliente.findUnique({where:{id:original.idCliente}}));
        assert.ok(await owner.solicitud.findUnique({where:{id:record.id}}));
        assert.equal((await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).status,200);
    } finally {await api.close();}
});

local('Instalación PostgreSQL: retención separada borra contenido personal sin liberar idempotencia ni afectar negocio', async () => {
    const api=await iniciarSimulada(db,{env:{...env,MAIL_ENABLED:'false'},apiEnv:{...env,MAIL_ENABLED:'false'}});
    try {
        const input=datos(products),key='web3-retencion-'+randomUUID();
        const record=await (await post(api.base,'/solicitudes',input,key)).json();
        assert.equal((await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).status,200);
        const before=(await db.$queryRaw`SELECT clave FROM gaona_mensajeria.registros_web WHERE solicitud_id=${record.id}`)[0].clave;
        await owner.$executeRaw`UPDATE gaona_mensajeria.registros_web SET retener_hasta=now()-interval '1 day' WHERE solicitud_id=${record.id}`;
        const parsed=validar(admin,'gaona_local_admin');
        const result=spawnSync('/usr/lib/postgresql/17/bin/psql',['-X','-v','ON_ERROR_STOP=1','-f',path.join(root,'api/propuestas/web/05-retencion.sql')],{env:{PATH:process.env.PATH,PGHOST:parsed.hostname,PGPORT:parsed.port,PGUSER:parsed.username,PGDATABASE:'gaona_web3_aislada'},encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);
        const row=(await db.$queryRaw`SELECT clave,comprobante FROM gaona_mensajeria.registros_web WHERE solicitud_id=${record.id}`)[0];
        assert.equal(row.clave,before);assert.equal(row.comprobante,null);
        assert.deepEqual((await db.$queryRaw`SELECT estado,pdf FROM gaona_mensajeria.documentos WHERE solicitud_id=${record.id}`)[0],{estado:'expirado',pdf:null});
        assert.equal((await db.$queryRaw`SELECT destinatario FROM gaona_mensajeria.correos WHERE solicitud_id=${record.id}`)[0].destinatario,null);
        assert.equal(await owner.solicitud.count({where:{id:record.id}}),1);
        assert.equal((await post(api.base,'/solicitudes/pdf',{token:record.pdf.token})).status,410);
    } finally {await api.close();}
});

local('Instalación PostgreSQL: respaldo SHA-256 restaura tablas, permisos, validación diferida y documentos', async () => {
    const parsed=validar(admin,'gaona_local_admin');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gaona-respaldo-pruebas-'));fs.chmodSync(directory,0o700);
    const archive=path.join(directory,'web.dump');
    const pgEnv={PATH:process.env.PATH,PGHOST:parsed.hostname,PGPORT:parsed.port,PGUSER:parsed.username,PGDATABASE:'gaona_web3_aislada'};
    const bin=spawnSync('pg_config',['--bindir'],{encoding:'utf8'}).stdout.trim();
    const run=(program,args)=>{
        const result=spawnSync(path.join(bin,program),args,{env:pgEnv,encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);return result.stdout;
    };
    let restored,created=false;
    try {
        run('pg_dump',['--no-password','--format=custom','--schema=public','--schema=gaona_mensajeria','--file',archive]);
        const hash=sha(fs.readFileSync(archive));fs.writeFileSync(archive+'.sha256',hash,{mode:0o600});
        assert.equal(sha(fs.readFileSync(archive)),fs.readFileSync(archive+'.sha256','utf8'));
        run('createdb',['gaona_web3_restaurada']);created=true;
        run('psql',['-X','-v','ON_ERROR_STOP=1','-d','gaona_web3_restaurada','-c','DROP SCHEMA public']);
        const restore=section=>run('pg_restore',['--no-password','--exit-on-error','--section='+section,'--dbname','gaona_web3_restaurada',archive]);
        restore('pre-data');
        run('psql',['-X','-v','ON_ERROR_STOP=1','-d','gaona_web3_restaurada','-c','CREATE EXTENSION btree_gist WITH SCHEMA public']);
        restore('data');restore('post-data');
        parsed.pathname='/gaona_web3_restaurada';
        restored=new PrismaClient({datasources:{db:{url:parsed.toString()}},log:[]});
        assert.equal(Number((await restored.$queryRaw`SELECT count(*) AS total FROM pg_tables WHERE schemaname='gaona_mensajeria'`)[0].total),4);
        const docs=await restored.$queryRaw`SELECT pdf,pdf_sha256 FROM gaona_mensajeria.documentos WHERE estado='disponible'`;
        assert.ok(docs.length>0);assert.ok(docs.every(row=>sha(Buffer.from(row.pdf))===row.pdf_sha256));
        const trigger=await restored.$queryRaw`SELECT tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgname='gaona_web3_cliente_vinculado'`;
        assert.deepEqual(trigger,[{tgdeferrable:true,tginitdeferred:true}]);
        assert.equal((await restored.$queryRaw`SELECT has_column_privilege('gaona_web_publico','public.clientes','correo','SELECT') AS correo`)[0].correo,false);
    } finally {
        await restored?.$disconnect();if(created)run('dropdb',['gaona_web3_restaurada']);
        fs.rmSync(directory,{recursive:true,force:true});
    }
});
