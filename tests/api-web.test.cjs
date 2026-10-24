const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const { entornoWeb } = apiRequire('./src/entorno-web');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-simulado', SMTP_PASSWORD: 'clave-simulada-no-real', SMTP_FROM: 'gaona@example.test' };

async function withApi(options, run) {
    const harness = createHarness({ entry: 'web.ts', ...options });
    const server = http.createServer(harness.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body, key = 'intento-web-publico-001', headers = {}) => fetch(base + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, body: JSON.stringify(body)
    });
    try { await run({ ...harness, base, post }); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test('entrada pública independiente: rutas mínimas, sin imports administrativos y host propio', async () => {
    await withApi({ apiEnv: { API_HOST: '0.0.0.0', PORT: '9000' } }, async ({ app, state, base }) => {
        assert.deepEqual(Array.from(state.listenArgs.slice(0, 2)), [3000, '127.0.0.1']);
        assert.equal(state.imports.includes('./clientes'), false);
        assert.equal(state.imports.includes('./empleado'), false);
        assert.equal(state.imports.includes('./lib/prisma'), false);
        assert.equal(state.whatsappCreated, undefined);
        const routes = app.router.stack.filter(layer => layer.route).map(layer => layer.route.path).sort();
        assert.deepEqual(routes, ['/productos', '/salud', '/solicitudes', '/solicitudes/correo/estado', '/solicitudes/pdf']);
        assert.deepEqual(await (await fetch(base + '/salud')).json(), { ok: true });
        assert.equal((await fetch(base + '/productos')).status, 200);
        const preflight = await fetch(base + '/solicitudes', { method: 'OPTIONS', headers: {
            Origin: 'http://127.0.0.1:8080', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,Idempotency-Key,Prefer'
        } });
        assert.equal(preflight.status, 200);
        assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
        assert.match(preflight.headers.get('allow'), /POST/);
        assert.deepEqual(JSON.parse(JSON.stringify(state.queries[0].where)), { activo: true, tipo: 'PRODUCTO' });
        assert.deepEqual(Object.keys(state.queries[0].select).sort(), ['categoria', 'descripcion', 'id', 'imagenUrl', 'nombre', 'precioDesde']);
    });
    const explicit = createHarness({ entry: 'web.ts', apiEnv: { WEB_HOST: '127.0.0.1', WEB_PORT: '4001' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(explicit.state.listenArgs.slice(0, 2)), [4001, '127.0.0.1']);
    for (const WEB_PORT of ['abc', '0', '-1', '65536', '3000.5']) {
        assert.throws(() => createHarness({ entry: 'web.ts', apiEnv: { WEB_PORT } }), /WEB_PORT debe ser un puerto válido/);
    }
});

test('clientes, empleados y WhatsApp no están disponibles por ningún método de aplicación', () => withApi({}, async ({ base, state }) => {
    const paths = ['/clientes', '/clientes/123', '/CLIENTES/', '/empleados', '/empleados/123/rol', '/empleados/123/estado', '/webhooks/whatsapp', '/solicitudes/whatsapp/estado'];
    for (const route of paths) {
        for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
            const response = await fetch(base + route, { method });
            assert.equal(response.status, 404, `${method} ${route}`);
            await response.arrayBuffer();
        }
    }
    assert.equal(state.writes, 0);
    assert.equal(state.mailCalls, 0);
}));

test('registro público idempotente, PDF protegido y estado del correo sin envíos', () => withApi({ apiEnv: smtp }, async ({ post, state }) => {
    const response = await post('/solicitudes', valid);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.estimado.total, '2900.70');
    assert.equal(result.correo.estado, 'no_disponible');
    assert.equal(state.correoEnv.MAIL_ENABLED, 'false');
    assert.equal(state.mailCalls, 0);
    assert.deepEqual(await (await post('/solicitudes', valid)).json(), result);
    assert.equal(state.writes, 1);
    assert.equal((await post('/solicitudes', { ...valid, descripcion: 'Datos diferentes' })).status, 409);
    for (const token of [undefined, result.id, result.pdf.token + 'alterado']) {
        assert.equal((await post('/solicitudes/pdf', { token })).status, 403);
        assert.equal((await post('/solicitudes/correo/estado', { token })).status, 403);
    }
    const document = await post('/solicitudes/pdf', { token: result.pdf.token });
    assert.equal(document.status, 200);
    assert.match(document.headers.get('content-type'), /application\/pdf/);
    assert.equal(document.headers.get('cache-control'), 'no-store');
    assert.equal(document.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await document.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(await (await post('/solicitudes/correo/estado', { token: result.pdf.token })).json(), { estado: 'no_disponible' });
    assert.equal(state.writes, 1);
}));

test('correo simulado conserva MIME, PDF idéntico a descarga y un solo intento', () => withApi({ env: smtp }, async ({ post, state }) => {
    const result = await (await post('/solicitudes', valid)).json();
    assert.equal(result.correo.estado, 'aceptado');
    assert.equal(state.correoEnv.MAIL_ENABLED, 'false');
    assert.equal(state.mailCalls, 1);
    const download = Buffer.from(await (await post('/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer());
    assert.deepEqual(download, state.messages[0].message.attachments[0].content);
    assert.match(state.messages[0].raw.toString(), /application\/pdf/);
    assert.deepEqual(await (await post('/solicitudes/correo/estado', { token: result.pdf.token })).json(), { estado: 'aceptado' });
    await post('/solicitudes', valid);
    assert.equal(state.writes, 1);
    assert.equal(state.mailCalls, 1);
}));

test('producción sin persistencia verificada rechaza antes de registrar y no envía', () => withApi({ apiEnv: { NODE_ENV: 'production' }, env: { ...smtp, NODE_ENV: 'production' } }, async ({ post, state }) => {
    const response = await post('/solicitudes', valid);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).codigo, 'PERSISTENCIA_NO_DISPONIBLE');
    assert.equal(state.writes, 0);
    assert.equal(state.mailCalls, 0);
}));

test('errores públicos de JSON, tamaño y base simulada no revelan detalles internos', () => withApi({ prisma: { producto: { findMany: async () => { throw Error('detalle-privado-simulado'); } } } }, async ({ base }) => {
    const catalog = await fetch(base + '/productos');
    assert.equal(catalog.status, 500);
    assert.equal((await catalog.text()).includes('detalle-privado-simulado'), false);
    for (const [body, status] of [['{"clave-privada":', 400], [JSON.stringify({ valor: 'x'.repeat(110000) }), 413]]) {
        const response = await fetch(base + '/solicitudes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(response.status, status);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal((await response.text()).includes('clave-privada'), false);
    }
}));

test('entorno público desactiva canales sin modificar configuración heredada ni perder claves legadas', () => {
    const original = { ...smtp, WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'simulado', WHATSAPP_STORAGE: 'postgres', WHATSAPP_IDEMPOTENCY_KEY: 'a'.repeat(64) };
    const env = entornoWeb(original);
    assert.equal(original.MAIL_ENABLED, 'true');
    assert.equal(original.WHATSAPP_ENABLED, 'true');
    assert.equal(env.MAIL_ENABLED, 'false');
    assert.equal(env.WHATSAPP_ENABLED, 'false');
    assert.equal(env.WHATSAPP_ACCESS_TOKEN, undefined);
    assert.equal(env.WHATSAPP_STORAGE, undefined);
    assert.equal(env.WHATSAPP_IDEMPOTENCY_KEY, original.WHATSAPP_IDEMPOTENCY_KEY);
});

test('Prisma web exige URL explícita y nunca recurre a DATABASE_URL o DIRECT_URL', () => {
    const { transformSync } = apiRequire('esbuild');
    const source = transformSync(readFileSync(path.join(__dirname, '../api/src/lib/prisma-web.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
    const module = { exports: {} };
    const constructors = [];
    vm.runInNewContext(source, { module, exports: module.exports, URL, require(name) {
        assert.equal(name, '@prisma/client');
        return { PrismaClient: class { constructor(options) { constructors.push(options); } } };
    } });
    const admin = { DATABASE_URL: 'postgresql://admin:simulado@127.0.0.1:5432/admin', DIRECT_URL: 'postgresql://admin:simulado@127.0.0.1:5432/admin' };
    for (const WEB_DATABASE_URL of [undefined, '', 'https://privado.invalid/secreto', 'postgresql://localhost']) {
        assert.throws(() => module.exports.crearPrismaWeb({ ...admin, WEB_DATABASE_URL }), error => error.message.includes('WEB_DATABASE_URL') && !error.message.includes('secreto'));
    }
    assert.equal(constructors.length, 0);
    const url = 'postgresql://web:simulado@127.0.0.1:55432/gaona_web_aislada';
    module.exports.crearPrismaWeb({ ...admin, WEB_DATABASE_URL: url });
    assert.deepEqual(JSON.parse(JSON.stringify(constructors)), [{ datasources: { db: { url } } }]);
});

test('entrada administrativa conserva routers y contratos locales con base simulada', async () => {
    const cliente = { id: 'cliente-local-simulado', nombre: 'Cliente', apellido: 'Simulado', telefono: '5555555555', correo: null, direccion: null, solicitudes: [], pedidos: [] };
    const empleado = { id: 'local', nombre: 'Empleado', activo: true, rol: { nombre: 'EMPLEADO' } };
    const updates = [];
    const prisma = {
        cliente: { findMany: async () => [cliente] },
        usuario: {
            findMany: async () => [empleado], findUnique: async () => empleado,
            update: async query => { updates.push(query); return { ...empleado, activo: query.data.activo }; }
        }
    };
    const { transformSync } = apiRequire('esbuild');
    const cargarRouter = archivo => {
        const module = { exports: {} };
        const source = transformSync(readFileSync(path.join(__dirname, '../api/src/', archivo), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
        vm.runInNewContext(source, { module, exports: module.exports, console, require(name) {
            if (name === './lib/prisma') return { prisma };
            return apiRequire(name);
        } });
        return module.exports;
    };
    await withApi({ entry: 'index.ts', prisma, ...cargarRouter('clientes.ts'), ...cargarRouter('empleado.ts') }, async ({ base, state }) => {
        const clientes = await (await fetch(base + '/clientes')).json();
        assert.equal(clientes.items[0].id, cliente.id);
        assert.equal(clientes.total, 1);
        assert.deepEqual(await (await fetch(base + '/empleados')).json(), [empleado]);
        const response = await fetch(base + '/empleados/local/estado', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: false }) });
        assert.deepEqual(await response.json(), { mensaje: 'Cuenta desactivada correctamente', empleado: { ...empleado, activo: false } });
        assert.equal(updates.length, 1);
        assert.equal(updates[0].where.id, 'local');
        assert.equal(state.listenArgs[0], 3000);
        assert.equal(typeof state.listenArgs[1], 'function');
    });
});
