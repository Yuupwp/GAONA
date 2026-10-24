const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { apiRequire, validarLocal, env, legadoDatos, legadoKey } = require('./persistencia-fixture.cjs');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
const { createHarness, valid } = require('./pdf-harness.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const { crearPersistenciaSolicitudes, serializarSolicitud } = apiRequire('./src/solicitud-persistencia');
const { registrarSolicitud } = apiRequire('./src/solicitud-registro');
const { crearServicioCorreo } = apiRequire('./src/solicitud-correo');
const { generarSolicitudPdf } = apiRequire('./src/solicitud-pdf');
const url = process.env.GAONA_PERSIST_TEST_DATABASE_URL;
const adminUrl = process.env.GAONA_PERSIST_TEST_ADMIN_URL;
if (url) validarLocal(url);
if (adminUrl) validarLocal(adminUrl);
const local = (name, run) => test(name, { skip: !url || !adminUrl }, run);
let db, owner;
let serial = 0;
function datos() {
    const d = structuredClone(valid);
    d.whatsappConsentimiento = false;
    d.cliente.correo = `persistencia-${++serial}@example.test`;
    d.descripcion = `PRUEBA AISLADA ${randomUUID()}`;
    return d;
}
const key = () => 'intento-' + randomUUID();
const register = (store, input, id = key()) => store.registrar(id, input, tx => registrarSolicitud(tx, input), `origen-simulado-${input.cliente.correo ?? input.descripcion}`);
async function worker(modo, clave, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'persistencia-worker.cjs')], {
            env: { PATH: process.env.PATH, GAONA_PERSIST_TEST_DATABASE_URL: url }, stdio: ['pipe', 'pipe', 'pipe']
        });
        let out = '', err = '';
        child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
        child.on('error', reject);
        child.on('exit', status => resolve({ status, out, err }));
        child.stdin.end(JSON.stringify({ modo, clave, datos: input }));
    });
}
async function servidor(options = {}) {
    const harness = createHarness({ prisma: db, env: { ...env, ...options.env }, apiEnv: { ...env, ...options.env }, timeout: 1000, ...options });
    const server = http.createServer(harness.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { ...harness, base, close: () => new Promise(resolve => server.close(resolve)),
        post: (route, body, id) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { 'Idempotency-Key': id } : {}) }, body: JSON.stringify(body) }) };
}
before(async () => {
    if (!url || !adminUrl) return;
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    owner = new PrismaClient({ datasources: { db: { url: adminUrl } }, log: [] });
    const idHash = createHash('sha256').update(Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY, 'hex')).digest('hex');
    const accessHash = createHash('sha256').update(Buffer.from(env.SOLICITUD_PDF_KEY, 'hex')).digest('hex');
    const legacyHash = createHash('sha256').update(Buffer.from(env.WHATSAPP_IDEMPOTENCY_KEY, 'hex')).digest('hex');
    await owner.$executeRaw`UPDATE gaona_mensajeria.configuracion SET idempotencia_huella = ${idHash}, acceso_huella = ${accessHash}, legado_huella = ${legacyHash} WHERE id = 1`;
    await owner.$executeRawUnsafe("UPDATE gaona_mensajeria.registros_web SET creado_en = now() - interval '2 hours'");
    await owner.$executeRawUnsafe("UPDATE gaona_mensajeria.correos SET creado_en = now() - interval '2 hours'");
    await owner.categoria.upsert({ where: { id: 'categoria-persistencia' }, update: {}, create: { id: 'categoria-persistencia', nombre: 'PRUEBA LOCAL persistencia' } });
    for (const [id, nombre, precio] of [['simulado-1', 'Puerta de roble', '1250.15'], ['simulado-2', 'Ventana de aluminio', '0.10']]) {
        await owner.producto.upsert({ where: { id }, update: { precioDesde: precio, activo: true }, create: { id, idCategoria: 'categoria-persistencia', nombre, precioDesde: precio } });
    }
});
after(async () => { await db?.$disconnect(); await owner?.$disconnect(); });

local('PostgreSQL: ocho registros concurrentes con una clave crean una solicitud, cliente y detalles', async () => {
    const store = crearPersistenciaSolicitudes(db, env), input = datos(), id = key();
    const initial = await owner.cliente.count();
    const records = await Promise.all(Array.from({ length: 8 }, () => register(store, input, id)));
    assert.equal(records.filter(r => !r.repetido).length, 1);
    assert.equal(new Set(records.map(r => r.comprobante.id)).size, 1);
    assert.equal(await owner.cliente.count(), initial + 1);
    assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    assert.equal(await owner.solicitudDetalle.count({ where: { idSolicitud: records[0].comprobante.id } }), 2);
    assert.equal(records[0].comprobante.estimado.total, '2900.70');
    await assert.rejects(register(store, { ...input, descripcion: 'Otro contenido' }, id), e => e.codigo === 409);
    const reordered = JSON.parse(serializarSolicitud(input));
    assert.equal((await register(store, reordered, id)).comprobante.id, records[0].comprobante.id);
});

local('PostgreSQL: rollback revierte reserva, cliente y solicitud sin llamadas SMTP', async () => {
    const store = crearPersistenciaSolicitudes(db, env), input = datos(), id = key();
    const before = await owner.cliente.count();
    await assert.rejects(store.registrar(id, input, async tx => { await registrarSolicitud(tx, input); throw Error('Fallo simulado antes del commit'); }));
    assert.equal(await owner.cliente.count(), before);
    assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 0);
    assert.equal((await register(store, input, id)).repetido, false);
});

local('PostgreSQL: dos procesos independientes comparten registro, PDF y único intento simulado', async () => {
    const input = datos(), id = key();
    const results = await Promise.all([worker('enviar', id, input), worker('enviar', id, input)]);
    results.forEach(r => assert.equal(r.status, 0, r.err));
    const states = results.map(r => JSON.parse(r.out));
    assert.equal(new Set(states.map(r => r.id)).size, 1);
    assert.equal(states.reduce((sum, r) => sum + r.calls, 0), 1);
    const recovered = await worker('recuperar', id, input);
    assert.equal(recovered.status, 0, recovered.err);
    const recoveredState = JSON.parse(recovered.out);
    assert.equal(recoveredState.estado, 'aceptado');
    assert.equal(recoveredState.calls, 0);
    assert.equal(recoveredState.repetido, true);
});

local('PostgreSQL y HTTP: respuesta perdida, dos API y reinicio recuperan folio sin correo duplicado', async () => {
    const one = await servidor(), two = await servidor();
    const input = datos(), id = key();
    try {
        const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? one : two).post('/solicitudes', input, id)));
        responses.forEach(r => assert.equal(r.status, 201));
        const bodies = await Promise.all(responses.map(r => r.json()));
        assert.equal(new Set(bodies.map(b => b.id)).size, 1);
        assert.equal(one.state.mailCalls + two.state.mailCalls, 1);
        const token = bodies[0].pdf.token;
        const download = Buffer.from(await (await two.post('/solicitudes/pdf', { token })).arrayBuffer());
        assert.deepEqual(await (await one.post('/solicitudes/correo/estado', { token })).json(), { estado: 'aceptado' });
        const three = await servidor();
        try {
            const replay = await (await three.post('/solicitudes', input, id)).json();
            assert.equal(replay.id, bodies[0].id);
            assert.equal(replay.correo.estado, 'aceptado');
            assert.equal(three.state.mailCalls, 0);
            assert.deepEqual(Buffer.from(await (await three.post('/solicitudes/pdf', { token })).arrayBuffer()), download);
            assert.equal((await three.post('/solicitudes', { ...input, descripcion: 'Cambiar la solicitud' }, id)).status, 409);
            assert.equal((await three.post('/solicitudes', input)).status, 400);
        } finally { await three.close(); }
    } finally { await one.close(); await two.close(); }
});

local('PostgreSQL: PDF canónico mantiene precios y bytes después de cambiar catálogo y reiniciar generador', async () => {
    const store = crearPersistenciaSolicitudes(db, env), input = datos(), id = key();
    const record = await register(store, input, id);
    let calls = 0;
    const generator = crearPersistenciaSolicitudes(db, env, async data => { calls++; return generarSolicitudPdf(data); });
    const files = await Promise.all(Array.from({ length: 5 }, () => generator.documento(record.comprobante)));
    assert.equal(calls, 1); files.forEach(f => assert.deepEqual(f, files[0]));
    await owner.producto.update({ where: { id: 'simulado-1' }, data: { activo: false, precioDesde: '999.00' } });
    try {
        const replay = await register(crearPersistenciaSolicitudes(db, env), input, id);
        assert.equal(replay.comprobante.estimado.total, '2900.70');
        assert.deepEqual(await crearPersistenciaSolicitudes(db, env, () => { throw Error('No regenerar'); }).documento(replay.comprobante), files[0]);
    } finally { await owner.producto.update({ where: { id: 'simulado-1' }, data: { activo: true, precioDesde: '1250.15' } }); }
    await owner.$executeRaw`UPDATE gaona_mensajeria.documentos SET pdf = ${Buffer.from('%PDF-alterado')} WHERE solicitud_id = ${record.comprobante.id}`;
    await assert.rejects(store.documento(record.comprobante));
});

local('PostgreSQL: reserva SMTP concurrente y estados persistentes ante rechazo, autenticación e incertidumbre', async () => {
    for (const mode of ['aceptado', 'EAUTH', 'ETIMEDOUT', 'rechazado']) {
        const store = crearPersistenciaSolicitudes(db, env), input = datos();
        const { comprobante } = await register(store, input);
        let calls = 0;
        const send = crearServicioCorreo(env, () => ({ async sendMail(message) {
            calls++;
            if (mode === 'EAUTH' || mode === 'ETIMEDOUT') throw Object.assign(Error('Secreto simulado que no se persiste'), { code: mode });
            return { accepted: mode === 'aceptado' ? [message.to.address] : [], rejected: mode === 'rechazado' ? [message.to.address] : [], messageId: message.messageId, response: '250 Prueba simulada' };
        }, close() {} }), Date.now, 30, store.correo);
        await Promise.all([send(comprobante, 'ip', () => store.documento(comprobante)), send(comprobante, 'otra-ip', () => store.documento(comprobante))]);
        const expected = mode === 'aceptado' ? 'aceptado' : mode === 'ETIMEDOUT' ? 'no_confirmado' : 'error';
        assert.equal(await store.correo.estado(comprobante.id), expected);
        assert.equal((await send(comprobante, 'ip', () => store.documento(comprobante))).estado, expected);
        assert.equal(calls, 1);
        const persisted = await owner.$queryRaw`SELECT intentos, mensaje_id, codigo_error, proveedor_id FROM gaona_mensajeria.correos WHERE solicitud_id = ${comprobante.id}`;
        assert.equal(persisted[0].intentos, 1);
        assert.ok(persisted[0].mensaje_id.includes(comprobante.id));
        assert.ok(!JSON.stringify(persisted).includes('Secreto simulado'));
    }
});

local('PostgreSQL: caída antes/durante/después de SMTP conserva incertidumbre y nunca reenvía', async () => {
    for (const [mode, code, attempts] of [['caida_previa', 72, 0], ['caida_durante', 73, 1], ['caida_posterior', 74, 1]]) {
        const input = datos(), id = key();
        const child = await worker(mode, id, input); assert.equal(child.status, code, child.err);
        const store = crearPersistenciaSolicitudes(db, env);
        const record = await register(store, input, id); assert.equal(record.repetido, true);
        await owner.$executeRaw`UPDATE gaona_mensajeria.correos SET vence_reserva = now() - interval '1 second' WHERE solicitud_id = ${record.comprobante.id}`;
        assert.equal(await store.correo.estado(record.comprobante.id), 'no_confirmado');
        assert.equal(await store.correo.reclamar(record.comprobante.id), null);
        let sends = 0;
        const send = crearServicioCorreo(env, () => { sends++; throw Error('No debe llegar al transporte'); }, Date.now, 30, store.correo);
        assert.equal((await send(record.comprobante, 'ip', () => store.documento(record.comprobante))).estado, 'no_confirmado');
        assert.equal(sends, 0);
        const persisted = await owner.$queryRaw`SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id = ${record.comprobante.id}`;
        assert.equal(persisted[0].intentos, attempts);
    }
});

local('PostgreSQL: caída tras commit antes de reclamar permite un único primer intento; PDF interrumpido se recupera', async () => {
    const input = datos(), id = key();
    assert.equal((await worker('caida_registro', id, input)).status, 71);
    const sent = await worker('enviar', id, input); assert.equal(sent.status, 0, sent.err); assert.equal(JSON.parse(sent.out).calls, 1);
    const other = datos(), otherKey = key();
    assert.equal((await worker('caida_pdf', otherKey, other)).status, 75);
    const store = crearPersistenciaSolicitudes(db, env), record = await register(store, other, otherKey);
    await owner.$executeRaw`UPDATE gaona_mensajeria.documentos SET vence_reserva = now() - interval '1 second' WHERE solicitud_id = ${record.comprobante.id}`;
    const pdf = await store.documento(record.comprobante);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await owner.$queryRaw`SELECT intentos FROM gaona_mensajeria.documentos WHERE solicitud_id = ${record.comprobante.id}`)[0].intentos, 2);
});

local('PostgreSQL: sin correo o SMTP deshabilitado se conservan solicitud, PDF y estado durable sin enviar después', async () => {
    for (const email of [true, false]) {
        const disabled = { ...env, MAIL_ENABLED: 'false' };
        const store = crearPersistenciaSolicitudes(db, disabled), input = datos(), id = key();
        if (!email) delete input.cliente.correo;
        const record = await register(store, input, id);
        const send = crearServicioCorreo(env, () => { throw Error('No activar trabajos deshabilitados'); }, Date.now, 20, store.correo);
        assert.equal((await send(record.comprobante, 'ip', () => store.documento(record.comprobante))).estado, email ? 'no_disponible' : 'sin_correo');
        assert.equal((await store.documento(record.comprobante)).subarray(0, 5).toString(), '%PDF-');
        assert.equal((await register(store, input, id)).comprobante.id, record.comprobante.id);
    }
});

local('PostgreSQL: permisos mínimos, RLS, restricciones únicas y contador de intentos', async () => {
    const permissions = await db.$queryRaw`SELECT has_schema_privilege(current_user,'gaona_mensajeria','CREATE') AS crear,
      has_table_privilege(current_user,'gaona_mensajeria.correos','DELETE') AS borrar,
      has_table_privilege('anon','gaona_mensajeria.correos','SELECT') AS publico,
      has_table_privilege('authenticated','gaona_mensajeria.correos','SELECT') AS autenticado`;
    assert.deepEqual(permissions[0], { crear: false, borrar: false, publico: false, autenticado: false });
    const roles = await db.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    assert.deepEqual(roles[0], { rolsuper: false, rolbypassrls: false });
    await assert.rejects(db.$executeRaw`DELETE FROM gaona_mensajeria.correos WHERE false`);
    const input = datos(), store = crearPersistenciaSolicitudes(db, env), record = await register(store, input);
    await assert.rejects(owner.$executeRaw`UPDATE gaona_mensajeria.correos SET intentos = 2 WHERE solicitud_id = ${record.comprobante.id}`);
    await assert.rejects(owner.$executeRaw`INSERT INTO gaona_mensajeria.documentos(solicitud_id) VALUES (${record.comprobante.id})`);
    await assert.rejects(owner.$executeRaw`UPDATE gaona_mensajeria.correos SET estado = 'aceptado' WHERE solicitud_id = ${record.comprobante.id}`);
    await assert.rejects(owner.$transaction(async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE anon'); await tx.$queryRawUnsafe('SELECT solicitud_id FROM gaona_mensajeria.correos'); }));
});

local('PostgreSQL y HTTP: retención impide regenerar o registrar de nuevo una operación vencida', async () => {
    const input = datos(), id = key(), first = await servidor();
    let body;
    try { body = await (await first.post('/solicitudes', input, id)).json(); } finally { await first.close(); }
    await owner.$executeRaw`UPDATE gaona_mensajeria.registros_web SET retener_hasta = now() - interval '1 second' WHERE solicitud_id = ${body.id}`;
    const restarted = await servidor();
    try {
        assert.equal((await restarted.post('/solicitudes', input, id)).status, 410);
        assert.equal((await restarted.post('/solicitudes/pdf', { token: body.pdf.token })).status, 410);
        assert.equal(restarted.state.mailCalls, 0);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    } finally { await restarted.close(); }
});

local('PostgreSQL: falta de clave estable o versión de esquema falla antes de insertar', async () => {
    const input = datos();
    for (const missing of [{ SOLICITUD_IDEMPOTENCY_KEY: '' }, { SOLICITUD_PDF_KEY: '' }, { SOLICITUD_IDEMPOTENCY_KEY: 'd'.repeat(64) }, { SOLICITUD_PDF_KEY: 'f'.repeat(64) }, { WHATSAPP_IDEMPOTENCY_KEY: '' }, { WHATSAPP_IDEMPOTENCY_KEY: 'd'.repeat(64) }]) {
        await assert.rejects(register(crearPersistenciaSolicitudes(db, { ...env, ...missing }), input), e => e.codigo === 503);
    }
    await owner.$executeRawUnsafe('UPDATE gaona_mensajeria.configuracion SET version = 1 WHERE id = 1');
    try { await assert.rejects(register(crearPersistenciaSolicitudes(db, env), input), e => e.codigo === 503); }
    finally { await owner.$executeRawUnsafe('UPDATE gaona_mensajeria.configuracion SET version = 2 WHERE id = 1'); }
    assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 0);
});

local('PostgreSQL: migración conserva comprobante y PDF v1 y recupera su clave anterior sin nuevos envíos', async () => {
    const store = crearPersistenciaSolicitudes(db, env);
    const record = await register(store, legadoDatos, legadoKey);
    assert.equal(record.repetido, true);
    assert.equal(await owner.solicitud.count({ where: { descripcion: legadoDatos.descripcion } }), 1);
    const original = await owner.$queryRaw`SELECT pdf, pdf_sha256 FROM gaona_mensajeria.envios WHERE solicitud_id = ${record.comprobante.id}`;
    assert.deepEqual(await store.documento(record.comprobante), Buffer.from(original[0].pdf));
    assert.equal(await store.correo.reclamar(record.comprobante.id), null);
    assert.equal(await apiRequire('./src/solicitud-whatsapp-almacen').crearAlmacenWhatsapp(db).estado(record.comprobante.id), 'aceptado');
});

local('PostgreSQL: cuotas de registro y correo siguen vigentes entre instancias', async () => {
    const origin = `origen-cuota-${randomUUID()}`;
    const first = crearPersistenciaSolicitudes(db, { ...env, MAIL_ENABLED: 'false' });
    for (let i = 0; i < 10; i++) {
        const input = datos();
        await first.registrar(key(), input, tx => registrarSolicitud(tx, input), origin);
    }
    const denied = datos();
    await assert.rejects(crearPersistenciaSolicitudes(db, env).registrar(key(), denied, tx => registrarSolicitud(tx, denied), origin), e => e.codigo === 429);
    assert.equal(await owner.solicitud.count({ where: { descripcion: denied.descripcion } }), 0);
    const recipient = `cuota-${randomUUID()}@example.test`;
    const ids = [];
    for (let i = 0; i < 4; i++) {
        const input = datos(); input.cliente.correo = recipient;
        ids.push((await register(crearPersistenciaSolicitudes(db, env), input)).comprobante.id);
    }
    assert.equal(await first.correo.estado(ids[2]), 'pendiente');
    assert.equal(await first.correo.estado(ids[3]), 'limitado');
    assert.equal(await first.correo.reclamar(ids[3]), null);
});

local('PostgreSQL: limpieza de retención elimina PDF y snapshot sin liberar la clave ni reenviar', async () => {
    const store = crearPersistenciaSolicitudes(db, env), input = datos(), id = key();
    const record = await register(store, input, id), pdf = await store.documento(record.comprobante);
    await owner.$executeRaw`UPDATE gaona_mensajeria.registros_web SET retener_hasta = now() - interval '1 second' WHERE solicitud_id = ${record.comprobante.id}`;
    const script = require('node:fs').readFileSync(path.resolve(__dirname, '../api/propuestas/persistencia-retencion.sql'), 'utf8');
    await owner.$transaction(async tx => {
        for (const sql of script.replace(/^BEGIN;|COMMIT;\s*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(sql);
    });
    const rows = await owner.$queryRaw`SELECT d.estado, d.pdf, d.pdf_sha256, r.comprobante, c.destinatario FROM gaona_mensajeria.documentos d
      JOIN gaona_mensajeria.registros_web r USING (solicitud_id) JOIN gaona_mensajeria.correos c USING (solicitud_id) WHERE d.solicitud_id = ${record.comprobante.id}`;
    assert.equal(rows[0].estado, 'expirado'); assert.equal(rows[0].pdf, null); assert.equal(rows[0].comprobante, null); assert.equal(rows[0].destinatario, null);
    assert.equal(rows[0].pdf_sha256, createHash('sha256').update(pdf).digest('hex'));
    await assert.rejects(register(store, input, id), e => e.codigo === 410);
    await assert.rejects(store.documento(record.comprobante), e => e.codigo === 410);
    assert.equal(await store.correo.reclamar(record.comprobante.id), null);
});

local('PostgreSQL y HTTP: confirmación de commit perdida recupera la reserva sin volver a crear', async () => {
    let perderCommit = true;
    const proxy = new Proxy(db, { get(target, name) {
        if (name === '$transaction') return async (...args) => {
            const saved = await target.$transaction(...args);
            if (perderCommit) { perderCommit = false; throw Error('Confirmación perdida simulada después de commit'); }
            return saved;
        };
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
    const api = await servidor({ prisma: proxy }), input = datos(), id = key();
    try {
        assert.equal((await api.post('/solicitudes', input, id)).status, 500);
        assert.equal(api.state.mailCalls, 0);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
        const retry = await api.post('/solicitudes', input, id);
        assert.equal(retry.status, 201);
        assert.equal((await retry.json()).correo.estado, 'aceptado');
        assert.equal(api.state.mailCalls, 1);
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
    } finally { await api.close(); }
});

local('PostgreSQL: el transporte ve registro y reserva confirmados fuera de cualquier transacción abierta', async () => {
    const store = crearPersistenciaSolicitudes(db, env), input = datos(), record = await register(store, input);
    let calls = 0;
    const send = crearServicioCorreo(env, () => ({ async sendMail(message) {
        calls++;
        const visible = await owner.$queryRaw`SELECT c.estado, c.intentos FROM gaona_mensajeria.correos c JOIN public.solicitudes s ON s.id = c.solicitud_id WHERE s.id = ${record.comprobante.id}`;
        assert.deepEqual(visible[0], { estado: 'enviando', intentos: 1 });
        const locks = await owner.$queryRaw`SELECT count(*) AS total FROM pg_stat_activity WHERE usename = 'gaona_web_pruebas' AND state = 'idle in transaction'`;
        assert.equal(Number(locks[0].total), 0);
        return { accepted: [message.to.address] };
    }, close() {} }), Date.now, 1000, store.correo);
    assert.equal((await send(record.comprobante, 'ip', () => store.documento(record.comprobante))).estado, 'aceptado');
    assert.equal(calls, 1);
});
