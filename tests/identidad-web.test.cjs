const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { apiRequire } = require('./pdf-harness.cjs');
const { auditarIdentidadWeb } = apiRequire('./src/lib/seguridad-web');
const { PrismaClient } = apiRequire('@prisma/client');
const { env: claves } = require('./persistencia-fixture.cjs');
const net = require('node:net');
const { validarEntorno } = require('../api/scripts/verificar-web.cjs');
function simulado(row) {
    return { $transaction: async fn => fn({ $executeRawUnsafe: async sql => assert.equal(sql, 'SET TRANSACTION READ ONLY'), $queryRaw: async () => [row] }) };
}
const base = { identidad: 'gaona_web_pruebas', sesion: 'gaona_web_pruebas', base: 'gaona_persistencia_aislada', puerto: '55432', loopback: true, seguro: true };
const config = { NODE_ENV: 'development', GAONA_WEB10_LOCAL: 'POSTGRES_AISLADO', WEB_DATABASE_URL: 'postgresql://gaona_web_pruebas@127.0.0.1:55432/gaona_persistencia_aislada' };
test('Identidad web: solo un perfil aislado explícito omite TLS; identidad y permisos siempre se auditan', async () => {
    assert.equal(await auditarIdentidadWeb(simulado(base), config), true);
    for (const change of [{ NODE_ENV: 'production' }, { GAONA_WEB10_LOCAL: undefined }, { WEB_DATABASE_URL: config.WEB_DATABASE_URL.replace('127.0.0.1', 'localhost') }]) {
        assert.equal(await auditarIdentidadWeb(simulado(base), { ...config, ...change }), false);
    }
    for (const change of [{ seguro: false }, { identidad: 'otra_identidad' }, { sesion: 'otro_login' }, { base: 'otra_base' }]) {
        await assert.rejects(auditarIdentidadWeb(simulado({ ...base, ...change }), config), /WEB10_IDENTIDAD/);
    }
    assert.equal(await auditarIdentidadWeb(simulado({ ...base, puerto: '5432' }), config), false);
    assert.equal(await auditarIdentidadWeb(simulado({ ...base, loopback: false }), config), false);
    await assert.rejects(auditarIdentidadWeb(simulado(base), { ...config, WEB_DATABASE_ROLE: 'otra_identidad' }), /WEB10_IDENTIDAD/);
});
const configured = Boolean(process.env.GAONA_WEB3_TEST_DATABASE_URL && process.env.GAONA_WEB3_TEST_ADMIN_URL);
let db, owner;
before(async () => {
    if (!configured) return;
    for (const value of [process.env.GAONA_WEB3_TEST_DATABASE_URL, process.env.GAONA_WEB3_TEST_ADMIN_URL]) {
        const u = new URL(value); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.pathname, '/gaona_web3_aislada'); assert.ok(u.port && u.port !== '5432');
    }
    db = new PrismaClient({ datasources: { db: { url: process.env.GAONA_WEB3_TEST_DATABASE_URL } }, log: [] });
    owner = new PrismaClient({ datasources: { db: { url: process.env.GAONA_WEB3_TEST_ADMIN_URL } }, log: [] });
});
after(async () => { await db?.$disconnect(); await owner?.$disconnect(); });
test('Identidad web: loopback restringido válido y permiso administrativo por columna rechazado', { skip: !configured }, async () => {
    const env = { ...claves, WEB_DATABASE_URL: process.env.GAONA_WEB3_TEST_DATABASE_URL, GAONA_WEB10_LOCAL: 'POSTGRES_AISLADO' };
    assert.equal(await auditarIdentidadWeb(db, env), true);
    await owner.$executeRawUnsafe('GRANT SELECT(id) ON public.usuarios TO gaona_web_publico_pruebas');
    try { await assert.rejects(auditarIdentidadWeb(db, env), /WEB10_IDENTIDAD/); }
    finally { await owner.$executeRawUnsafe('REVOKE SELECT(id) ON public.usuarios FROM gaona_web_publico_pruebas'); }
    assert.equal(await auditarIdentidadWeb(db, env), true);
});
test('Identidad web: proxy loopback no obtiene la excepción de conexión directa del laboratorio', { skip: !configured }, async () => {
    const target = new URL(process.env.GAONA_WEB3_TEST_DATABASE_URL), sockets = new Set();
    const targetPort = Number(target.port);
    const proxy = net.createServer(client => {
        const upstream = net.connect(targetPort, '127.0.0.1');
        for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); }); }
        client.pipe(upstream); upstream.pipe(client);
    });
    await new Promise(r => proxy.listen(0, '127.0.0.1', r));
    target.port = String(proxy.address().port);
    const proxied = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
    try {
        const env = { ...claves, WEB_DATABASE_URL: target.toString(), GAONA_WEB10_LOCAL: 'POSTGRES_AISLADO' };
        assert.equal(await auditarIdentidadWeb(proxied, env), false);
        assert.throws(() => validarEntorno(env), /WEB6_CONFIG/);
    } finally {
        await proxied.$disconnect(); for (const socket of sockets) socket.destroy();
        await new Promise(r => proxy.close(r));
    }
});
