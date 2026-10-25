const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { env } = require('./persistencia-fixture.cjs');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
const { apiRequire, conexiones, iniciarEntrada, iniciarSimulada, sembrar, datos, post, sha } = require('./web-postgres-lab.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const configured = Boolean(process.env.WEB_DATABASE_URL && process.env.GAONA_PERSIST_TEST_ADMIN_URL);
const local = (name, run) => test(name, { skip: !configured }, run);
let db, owner, products;
before(async () => {
    if (!configured) return;
    const urls = conexiones();
    db = new PrismaClient({ datasources: { db: { url: urls.web } }, log: [] });
    owner = new PrismaClient({ datasources: { db: { url: urls.admin } }, log: [] });
    products = await sembrar(owner);
});
after(async () => { await db?.$disconnect(); await owner?.$disconnect(); });

local('WEB PostgreSQL: identidad restringida, RLS efectivo y tablas administrativas inaccesibles', async () => {
    const roles = await db.$queryRaw`SELECT current_user AS usuario, session_user AS sesion, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
        FROM pg_roles WHERE rolname = current_user`;
    assert.deepEqual(roles[0], { usuario: 'gaona_web_pruebas', sesion: 'gaona_web_pruebas', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
    const access = await db.$queryRaw`SELECT pg_has_role(current_user, 'gaona_local_admin', 'MEMBER') AS administrador,
        has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
        has_table_privilege(current_user, 'public.clientes', 'INSERT') AS altas,
        has_table_privilege(current_user, 'public.clientes', 'UPDATE') AS cambios,
        has_table_privilege(current_user, 'public.clientes', 'DELETE') AS borrados`;
    assert.deepEqual(access[0], { administrador: false, ddl: false, altas: true, cambios: false, borrados: false });
    const administrative = await db.$queryRaw`SELECT c.relname, has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS acceso
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')`;
    assert.ok(administrative.some(row => row.relname === 'usuarios'));
    assert.ok(administrative.every(row => row.acceso === false));
    const security = await db.$queryRaw`SELECT c.relname, c.relrowsecurity AS rls, pg_has_role(current_user, c.relowner, 'MEMBER') AS propietario
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','gaona_mensajeria') AND c.relkind='r'`;
    assert.ok(security.every(row => row.rls && !row.propietario));
    const visible = await db.producto.findMany({ where: { idCategoria: products[0].idCategoria } });
    assert.deepEqual(visible.map(row => row.id).sort(), products.slice(0, 2).map(row => row.id).sort());
    await assert.rejects(db.usuario.findMany());
    await assert.rejects(db.cotizacion.findMany());
    await assert.rejects(db.pedido.findMany());
    await assert.rejects(db.$executeRawUnsafe('SET ROLE gaona_local_admin'));
    await assert.rejects(db.producto.update({ where: { id: products[0].id }, data: { precioDesde: '1.00' } }));
});

local('WEB PostgreSQL: web.ts real registra una vez, calcula importes y conserva PDF y folio al reiniciar', async () => {
    let entry = await iniciarEntrada();
    try {
        const catalog = await (await fetch(entry.base + '/productos')).json();
        assert.ok(catalog.some(row => row.id === products[0].id));
        assert.equal(catalog.some(row => products.slice(2).some(product => row.id === product.id)), false);
        const input = datos(products), key = 'entrada-real-' + randomUUID();
        const results = await Promise.all(Array.from({ length: 8 }, async () => {
            const response = await post(entry.base, '/solicitudes', { ...input, total: '0.01', precioUnitario: '0.01' }, key);
            assert.equal(response.status, 201);
            return response.json();
        }));
        const result = results[0];
        assert.ok(results.every(row => row.id === result.id));
        assert.equal(result.estimado.subtotal, '2500.60');
        assert.equal(result.estimado.iva, '400.10');
        assert.equal(result.estimado.total, '2900.70');
        assert.equal(result.correo.estado, 'no_disponible');
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
        const document = await post(entry.base, '/solicitudes/pdf', { token: result.pdf.token });
        assert.equal(document.status, 200);
        const pdf = Buffer.from(await document.arrayBuffer());
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        const saved = await db.$queryRaw`SELECT pdf, pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id=${result.id}`;
        assert.equal(sha(pdf), saved[0].pdf_sha256);
        assert.deepEqual(pdf, Buffer.from(saved[0].pdf));
        assert.equal((await post(entry.base, '/solicitudes/pdf', { token: result.id })).status, 403);
        for (const route of ['/clientes', '/clientes/id', '/empleados', '/empleados/id/rol', '/webhooks/whatsapp', '/solicitudes/whatsapp/estado']) {
            for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
                const response = await fetch(entry.base + route, { method });
                assert.equal(response.status, 404, `${method} ${route}`);
                await response.arrayBuffer();
            }
        }
        assert.equal(await entry.imports(), '');
        const port = entry.port;
        await entry.close(); entry = await iniciarEntrada({ WEB_PORT: String(port) });
        const repeated = await post(entry.base, '/solicitudes', input, key);
        assert.equal(repeated.status, 201);
        assert.equal((await repeated.json()).id, result.id);
        assert.equal((await post(entry.base, '/solicitudes', { ...input, descripcion: 'Otros datos' }, key)).status, 409);
        assert.deepEqual(Buffer.from(await (await post(entry.base, '/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer()), pdf);
        assert.deepEqual(await (await post(entry.base, '/solicitudes/correo/estado', { token: result.pdf.token })).json(), { estado: 'no_disponible' });
        assert.equal((await db.$queryRaw`SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id=${result.id}`)[0].intentos, 0);
        assert.equal(Number((await db.$queryRaw`SELECT count(*) AS total FROM gaona_mensajeria.envios WHERE solicitud_id=${result.id}`)[0].total), 0);
        assert.equal(await entry.imports(), '');
    } finally { await entry.close(); }
});

local('WEB PostgreSQL: SMTP simulado asíncrono usa el PDF canónico y no reenvía después de reiniciar', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let api = await iniciarSimulada(db, { mailGate: gate });
    try {
        const input = datos(products), key = 'smtp-web-' + randomUUID();
        const response = await post(api.base, '/solicitudes', input, key, { Prefer: 'respond-async' });
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.equal(result.correo.estado, 'pendiente');
        for (let i = 0; i < 100 && !api.state.mailCalls; i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(api.state.mailCalls, 1);
        release();
        let status;
        for (let i = 0; i < 100; i++) {
            status = await (await post(api.base, '/solicitudes/correo/estado', { token: result.pdf.token })).json();
            if (status.estado !== 'pendiente') break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(status.estado, 'aceptado');
        const pdf = Buffer.from(await (await post(api.base, '/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer());
        assert.deepEqual(api.state.messages[0].message.attachments[0].content, pdf);
        const saved = await db.$queryRaw`SELECT intentos, estado, adjunto_sha256 FROM gaona_mensajeria.correos WHERE solicitud_id=${result.id}`;
        assert.deepEqual(saved[0], { intentos: 1, estado: 'aceptado', adjunto_sha256: sha(pdf) });
        assert.equal(api.state.imports.includes('./clientes'), false);
        assert.equal(api.state.imports.includes('./empleado'), false);
        await api.close(); api = await iniciarSimulada(db);
        const replay = await (await post(api.base, '/solicitudes', input, key)).json();
        assert.equal(replay.id, result.id);
        assert.equal(replay.correo.estado, 'aceptado');
        assert.equal(api.state.mailCalls, 0);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    } finally { release(); await api.close(); }
});

local('Cotización PostgreSQL: correo normalizado, comprobante canónico y único intento sobreviven al reinicio', async () => {
    let api = await iniciarSimulada(db);
    try {
        const input = datos(products), address = input.cliente.correo, key = 'web7-normalizacion-' + randomUUID();
        const padded = { ...input, cliente: { ...input.cliente, correo: '  ' + address + '  ' }, to: 'ajeno@example.test' };
        const response = await post(api.base, '/solicitudes', padded, key);
        assert.equal(response.status, 201);
        const result = await response.json();
        const rows = await db.$queryRaw`SELECT c.destinatario, c.intentos, c.estado, c.adjunto_sha256, r.comprobante->'cliente'->>'correo' AS correo, d.pdf_sha256
            FROM gaona_mensajeria.correos c JOIN gaona_mensajeria.registros_web r USING(solicitud_id)
            JOIN gaona_mensajeria.documentos d USING(solicitud_id) WHERE c.solicitud_id=${result.id}`;
        assert.equal(rows[0].destinatario, address); assert.equal(rows[0].correo, address);
        assert.equal(rows[0].intentos, 1); assert.equal(rows[0].estado, 'aceptado');
        const attachment = api.state.messages[0].message.attachments[0].content;
        assert.equal(rows[0].adjunto_sha256, sha(attachment)); assert.equal(rows[0].pdf_sha256, sha(attachment));
        assert.equal(api.state.messages[0].message.to.address, address);
        await api.close(); api = await iniciarSimulada(db);
        const replay = await post(api.base, '/solicitudes', input, key);
        assert.equal(replay.status, 201); assert.equal((await replay.json()).id, result.id);
        assert.equal(api.state.mailCalls, 0);
        assert.deepEqual(Buffer.from(await (await post(api.base, '/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer()), attachment);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    } finally { await api.close(); }
});

local('Cotización PostgreSQL: dirección y comentarios normales persisten; consentimiento manipulado no activa WhatsApp', async () => {
    const api = await iniciarEntrada();
    try {
        const input = datos(products);
        input.cliente = { ...input.cliente, nombre: 'Ana María', apellido: "O'Connor-López", telefono: '+15555550101', direccion: 'Calle Ficticia #10, Colonia Pruebas' };
        input.descripcion += ' — Café, medidas 90 × 210 cm; "mate" & natural.';
        input.whatsappConsentimiento = true;
        const key = 'web8-datos-' + randomUUID();
        const response = await post(api.base, '/solicitudes', input, key);
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.equal(result.whatsapp.estado, 'no_disponible'); assert.equal(result.estimado.total, '2900.70');
        const record = await owner.solicitud.findUnique({ where: { id: result.id }, select: { descripcion: true, cliente: { select: { nombre: true, apellido: true, telefono: true, direccion: true, correo: true } } } });
        assert.deepEqual(record.cliente, input.cliente); assert.equal(record.descripcion, input.descripcion);
        assert.equal((await db.$queryRaw`SELECT count(*) AS total FROM gaona_mensajeria.envios WHERE solicitud_id=${result.id}`)[0].total, 0n);
        const pdf = Buffer.from(await (await post(api.base, '/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer());
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.equal((await db.$queryRaw`SELECT pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id=${result.id}`)[0].pdf_sha256, sha(pdf));
        assert.equal((await (await post(api.base, '/solicitudes', input, key)).json()).id, result.id);
        assert.equal((await db.$queryRaw`SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id=${result.id}`)[0].intentos, 0);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    } finally { await api.close(); }
});

local('WEB PostgreSQL: configuración ausente, URL inválida o claves incompatibles fallan sin respaldo privilegiado', async () => {
    for (const WEB_DATABASE_URL of ['', 'https://configuracion-invalida.test/privado']) {
        await assert.rejects(iniciarEntrada({ WEB_DATABASE_URL, DATABASE_URL: 'postgresql://privilegiado:simulado@127.0.0.1:1/nunca', DIRECT_URL: 'postgresql://privilegiado:simulado@127.0.0.1:1/nunca' }), error => error.message.includes('WEB_DATABASE_URL') && !error.message.includes('privilegiado:simulado'));
    }
    await assert.rejects(iniciarEntrada({ NODE_ENV: 'production', SOLICITUD_STORAGE: 'memory' }), /WEB6_VERIFICACION/);
    for (const config of [{ SOLICITUD_IDEMPOTENCY_KEY: 'd'.repeat(64) }]) {
        const entry = await iniciarEntrada(config);
        try {
            const input = datos(products);
            const response = await post(entry.base, '/solicitudes', input);
            assert.equal(response.status, 503);
            const result = await response.json();
            assert.equal(result.codigo, 'PERSISTENCIA_NO_DISPONIBLE');
            assert.equal(JSON.stringify(result).includes('postgresql:'), false);
            assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 0);
        } finally { await entry.close(); }
    }
});

local('WEB PostgreSQL: alteración SHA-256 se rechaza sin regenerar documento ni registrar otra solicitud', async () => {
    const entry = await iniciarEntrada();
    let record, original;
    try {
        const result = await (await post(entry.base, '/solicitudes', datos(products))).json();
        record = result.id;
        const first = await post(entry.base, '/solicitudes/pdf', { token: result.pdf.token });
        assert.equal(first.status, 200); await first.arrayBuffer();
        original = (await owner.$queryRaw`SELECT pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id=${record}`)[0].pdf_sha256;
        await owner.$executeRaw`UPDATE gaona_mensajeria.documentos SET pdf_sha256=${'0'.repeat(64)} WHERE solicitud_id=${record}`;
        const rejected = await post(entry.base, '/solicitudes/pdf', { token: result.pdf.token });
        assert.equal(rejected.status, 503);
        assert.equal((await rejected.text()).includes(original), false);
        assert.equal(await owner.solicitud.count({ where: { id: record } }), 1);
    } finally {
        if (record && original) await owner.$executeRaw`UPDATE gaona_mensajeria.documentos SET pdf_sha256=${original} WHERE solicitud_id=${record}`;
        await entry.close();
    }
});
