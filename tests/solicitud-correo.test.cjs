const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHarness, valid, fixture, apiRequire } = require('./pdf-harness.cjs');
const { configurarSmtp, crearServicioCorreo } = apiRequire('./src/solicitud-correo');
const { crearControlSolicitudes, crearLimiteFrecuencia } = apiRequire('./src/solicitud-controles');
const { crearDocumentos, LIMITE_PDF_BYTES } = apiRequire('./src/solicitud-documento');
const { calcularEstimado } = apiRequire('./src/solicitud-estimado');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-simulado', SMTP_PASSWORD: 'clave-simulada-no-real', SMTP_FROM: 'gaona@example.test' };
const data = () => ({ id: '11111111-2222-4333-8444-555555555555', fecha: '2026-10-22T12:00:00Z',
    cliente: { ...valid.cliente }, estimado: calcularEstimado(valid.productos, fixture) });
async function withApi(options, run) {
    const { app, state } = createHarness(options);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body, key, headers = {}) => fetch(base + route, { method: 'POST', headers: {
        'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...headers
    }, body: JSON.stringify(body) });
    try { await run(post, state, base); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test('configuración deshabilitada por defecto y TLS obligatorio con certificados verificados', () => {
    for (const env of [{}, { ...smtp, MAIL_ENABLED: 'false' }, { ...smtp, MAIL_ENABLED: 'TRUE' },
        { ...smtp, SMTP_PASSWORD: '' }, { ...smtp, SMTP_FROM: 'uno@test.test,dos@test.test' },
        { ...smtp, SMTP_FROM: 'from@example.test\r\nBcc: otro@example.test' },
        { ...smtp, SMTP_HOST: 'smtp.test/privado' }, { ...smtp, SMTP_PORT: '0' },
        { ...smtp, SMTP_PORT: '65536' }, { ...smtp, SMTP_PORT: '465' }, { ...smtp, SMTP_SECURE: 'otro' }]) {
        assert.equal(configurarSmtp(env), null);
    }
    const { opciones } = configurarSmtp(smtp);
    assert.equal(opciones.requireTLS, true);
    assert.equal(opciones.secure, false);
    assert.equal(opciones.tls.rejectUnauthorized, true);
    assert.equal(opciones.tls.minVersion, 'TLSv1.2');
    assert.equal(opciones.connectionTimeout, 5000);
    assert.equal(opciones.socketTimeout, 15000);
    assert.equal(opciones.disableFileAccess, true);
    assert.equal(opciones.disableUrlAccess, true);
    assert.equal(opciones.logger, false);
    assert.equal(opciones.debug, false);
    const tls = configurarSmtp({ ...smtp, SMTP_SECURE: 'true', SMTP_PORT: '465' });
    assert.equal(tls.opciones.secure, true);
    assert.equal(tls.opciones.tls.rejectUnauthorized, true);
});

test('Stream Transport genera MIME con adjunto idéntico a descarga, folio, contenido y remitente fijo', () => withApi({ env: smtp }, async (post, state) => {
    const request = { ...valid, cliente: { ...valid.cliente, nombre: '<img src=x onerror=alert(1)>' },
        from: 'intruso@example.test', to: 'tercero@example.test', cc: ['otro@example.test'],
        attachments: [{ path: '/etc/passwd' }], productos: valid.productos.map(p => ({ ...p, precioDesde: '0.01' })) };
    const response = await post('/solicitudes', request, 'intento-simulado-unico-001');
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.correo.estado, 'aceptado');
    assert.equal(result.estimado.total, '2900.70');
    assert.equal(state.writes, 1);
    assert.equal(state.mailCalls, 1);
    const { message, raw } = state.messages[0];
    assert.equal(message.from.address, smtp.SMTP_FROM);
    assert.equal(message.to.address, valid.cliente.correo);
    assert.deepEqual(message.envelope.to, [valid.cliente.correo]);
    assert.equal(message.cc, undefined);
    assert.equal(message.bcc, undefined);
    assert.equal(message.subject, `GAONA | Solicitud de cotización - ${result.id}`);
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].filename, `GAONA-Solicitud-${result.id}.pdf`);
    assert.match(message.text, /Hola, <img src=x onerror=alert\(1\)>/);
    assert.match(message.text, /Los precios son estimados/);
    assert.ok(message.text.includes(result.id));
    assert.ok(!message.html.includes('<img'));
    assert.ok(message.html.includes('&lt;img'));
    assert.ok(!message.text.includes(result.pdf.token));
    assert.ok(!raw.toString().includes(result.pdf.token));
    const downloaded = Buffer.from(await (await post('/solicitudes/pdf', { token: result.pdf.token })).arrayBuffer());
    assert.deepEqual(downloaded, message.attachments[0].content);
    const mime = JSON.parse(execFileSync('python3', ['-c', `import sys,json,base64
from email import policy
from email.parser import BytesParser
m=BytesParser(policy=policy.default).parsebytes(sys.stdin.buffer.read())
a=list(m.iter_attachments())
print(json.dumps(dict(to=m['To'],subject=m['Subject'],attachments=[dict(name=p.get_filename(),type=p.get_content_type(),content=base64.b64encode(p.get_payload(decode=True)).decode()) for p in a],text=m.get_body(preferencelist=('plain',)).get_content(),html=m.get_body(preferencelist=('html',)).get_content())))`], { input: raw, encoding: 'utf8' }));
    assert.equal(mime.to, valid.cliente.correo);
    assert.equal(mime.subject, message.subject);
    assert.equal(mime.attachments[0].name, message.attachments[0].filename);
    assert.equal(mime.attachments[0].type, 'application/pdf');
    assert.deepEqual(Buffer.from(mime.attachments[0].content, 'base64'), downloaded);
    assert.match(mime.text, /Equipo GAONA/);
    assert.ok(mime.html.includes('&lt;img'));
    assert.equal(state.closes, 1);
}));

test('sin correo, SMTP incompleto o deshabilitado: registro y descarga operativos sin transporte', async () => {
    for (const options of [{ env: {} }, { env: { MAIL_ENABLED: 'true' } }, { env: { ...smtp, MAIL_ENABLED: 'false' } }, { env: smtp, withoutEmail: true }]) {
        await withApi(options, async (post, state) => {
            const input = structuredClone(valid);
            if (options.withoutEmail) delete input.cliente.correo;
            const response = await post('/solicitudes', input);
            assert.equal(response.status, 201);
            const body = await response.json();
            assert.equal(body.correo.estado, options.withoutEmail ? 'sin_correo' : 'no_disponible');
            assert.equal(state.mailCalls, 0);
            assert.equal(state.smtp.length, 0);
            assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
            assert.equal(state.writes, 1);
        });
    }
});

test('conexión, autenticación, rechazo y timeout: 201, estado seguro y descarga sin reenviar', async () => {
    for (const mode of ['ECONNECTION', 'EAUTH', 'EENVELOPE', 'ETIMEDOUT', 'ESOCKET', 'rejected', 'pending']) {
        await withApi({ env: smtp, timeout: mode === 'pending' ? 10 : 1000 }, async (post, state) => {
            state.mailMode = mode;
            const response = await post('/solicitudes', valid, 'intento-error-simulado-001');
            assert.equal(response.status, 201, mode);
            const body = await response.json();
            assert.equal(body.correo.estado, ['ETIMEDOUT', 'ESOCKET', 'pending'].includes(mode) ? 'no_confirmado' : 'error');
            assert.ok(!JSON.stringify(body).includes('Detalle privado'));
            const repeated = await post('/solicitudes', valid, 'intento-error-simulado-001');
            assert.equal(repeated.status, 201);
            assert.deepEqual(await repeated.json(), body);
            assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
            assert.equal(state.mailCalls, 1);
            assert.equal(state.writes, 1);
            assert.equal(state.closes, 1);
        });
    }
});

test('fallo del generador antes del correo conserva registro y permite recuperar descarga', () => withApi({ env: smtp }, async (post, state) => {
    state.failPdf = true;
    const response = await post('/solicitudes', valid);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.correo.estado, 'error_pdf');
    assert.equal(state.mailCalls, 0);
    assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 503);
    state.failPdf = false;
    assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
    assert.equal((await (await post('/solicitudes', valid)).json()).correo.estado, 'error_pdf');
    assert.equal(state.writes, 1);
    assert.equal(state.mailCalls, 0);
}));

test('idempotencia concurrente: una escritura y un intento SMTP; conflictos no escriben', () => withApi({ env: smtp }, async (post, state, base) => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post('/solicitudes', valid, 'intento-concurrente-001').then(r => r.json())));
    results.forEach(result => assert.deepEqual(result, results[0]));
    assert.equal(state.writes, 1);
    assert.equal(state.mailCalls, 1);
    assert.equal((await post('/solicitudes', { ...valid, descripcion: 'Contenido distinto' }, 'intento-concurrente-001')).status, 409);
    assert.equal((await post('/solicitudes', valid, 'corto')).status, 400);
    assert.equal(state.writes, 1);
    assert.equal((await fetch(base + '/solicitudes/correo', { method: 'POST' })).status, 404);
}));

test('clientes sin clave también deduplican; límites SMTP no bloquean registro ni PDF', () => withApi({ env: smtp }, async (post, state) => {
    const first = await (await post('/solicitudes', valid)).json();
    const repeated = await (await post('/solicitudes', valid)).json();
    assert.deepEqual(repeated, first);
    assert.equal(state.writes, 1);
    for (let i = 1; i <= 3; i++) {
        const body = await (await post('/solicitudes', { ...valid, descripcion: `Solicitud simulada ${i}` })).json();
        assert.equal(body.correo.estado, i === 3 ? 'limitado' : 'aceptado');
        assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
    }
    assert.equal(state.mailCalls, 3);
    assert.equal(state.writes, 4);
}));

test('límite de registros por IP ignora X-Forwarded-For y evita escrituras adicionales', () => withApi({}, async (post, state, base) => {
    for (let i = 0; i < 10; i++) assert.equal((await post('/solicitudes', { ...valid, descripcion: `Registro simulado ${i}` })).status, 201);
    const blocked = await fetch(base + '/solicitudes', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.1'
    }, body: JSON.stringify({ ...valid, descripcion: 'Fuera de límite simulado' }) });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal(state.writes, 10);
    assert.equal(state.mailCalls, 0);
}));

test('validación de destinatarios múltiples e inyección: sin escrituras ni envío', () => withApi({ env: smtp }, async (post, state) => {
    for (const correo of ['a@example.test,b@example.test', 'a@example.test\r\nBcc: b@example.test', '<a@example.test>', 'invalido']) {
        assert.equal((await post('/solicitudes', { ...valid, cliente: { ...valid.cliente, correo } })).status, 400);
    }
    assert.equal(state.writes, 0);
    assert.equal(state.mailCalls, 0);
}));

test('límites de tamaño y PDF inválido evitan crear transporte; errores de servicio no revelan secretos', async () => {
    let transportes = 0;
    const send = crearServicioCorreo(smtp, () => { transportes++; throw Error('No debe ocurrir'); });
    for (const pdf of [Buffer.from('invalido'), Buffer.alloc(LIMITE_PDF_BYTES + 1)]) {
        assert.equal((await send(data(), 'ip-simulada', async () => pdf)).estado, 'error_pdf');
    }
    assert.equal(transportes, 0);
    const invalid = data(); invalid.cliente.correo = 'a@example.test,b@example.test';
    assert.equal((await send(invalid, 'ip-simulada', async () => Buffer.from('%PDF-simulado'))).estado, 'error');
    assert.equal(transportes, 0);
});

test('caché comparte generación concurrente, no expulsa adjuntos vigentes y recupera tras fallo', async () => {
    let time = 1000, calls = 0, fail = false;
    const cache = crearDocumentos(async () => { calls++; if (fail) throw Error('Simulado'); return Buffer.from('%PDF-simulado'); }, () => time, 1);
    const [one, two] = await Promise.all([cache(data()), cache(data())]);
    assert.equal(one, two);
    assert.equal(calls, 1);
    const other = data(); other.id = 'otra-simulada';
    await assert.rejects(cache(other, true));
    assert.equal(calls, 1);
    assert.equal((await cache(other)).toString(), '%PDF-simulado');
    assert.equal(calls, 2);
    time += 31 * 60 * 1000;
    fail = true;
    await assert.rejects(cache(other));
    fail = false;
    assert.equal((await cache(other)).toString(), '%PDF-simulado');
    assert.equal(calls, 4);
});

test('ventanas de frecuencia e idempotencia expiran sin guardar direcciones en claves', async () => {
    let now = 1000;
    const rate = crearLimiteFrecuencia(() => now);
    const rule = [{ clave: 'simulado@example.test', maximo: 1, periodo: 100 }];
    assert.equal(rate(rule), true);
    assert.equal(rate(rule), false);
    now += 100;
    assert.equal(rate(rule), true);
    const control = crearControlSolicitudes(() => now);
    const key = 'intento-temporal-001';
    const initial = control(key, { simulado: true }, 'ip-simulada');
    assert.equal(initial.tipo, 'nuevo');
    const concurrent = control(key, { simulado: true }, 'ip-simulada');
    assert.equal(concurrent.tipo, 'repetido');
    initial.completar({ codigo: 201, cuerpo: { id: 'simulado' } });
    assert.equal((await concurrent.pendiente).codigo, 201);
    now += 30 * 60 * 1000;
    assert.equal(control(key, { simulado: true }, 'ip-simulada').tipo, 'nuevo');
});

test('límites SMTP por IP y global no se evaden cambiando destinatarios', async () => {
    let calls = 0;
    const factory = () => ({ sendMail: async message => { calls++; return { accepted: [message.to.address] }; }, close() {} });
    const pdf = async () => Buffer.from('%PDF-simulado');
    const porIp = crearServicioCorreo(smtp, factory);
    for (let i = 0; i < 6; i++) {
        const request = data(); request.id = `solicitud-ip-${i}`; request.cliente.correo = `simulado${i}@example.test`;
        assert.equal((await porIp(request, 'ip-simulada', pdf)).estado, i === 5 ? 'limitado' : 'aceptado');
    }
    assert.equal(calls, 5);
    calls = 0;
    const global = crearServicioCorreo(smtp, factory);
    for (let i = 0; i < 31; i++) {
        const request = data(); request.id = `solicitud-global-${i}`; request.cliente.correo = `simulado${i}@example.test`;
        assert.equal((await global(request, `ip-simulada-${i}`, pdf)).estado, i === 30 ? 'limitado' : 'aceptado');
    }
    assert.equal(calls, 30);
});

test('concurrencia SMTP máxima dos, también si vence la espera de confirmación', async () => {
    const pendientes = [];
    let inmediato = false;
    const send = crearServicioCorreo(smtp, () => ({
        sendMail: message => inmediato ? Promise.resolve({ accepted: [message.to.address] }) : new Promise(resolve => pendientes.push(resolve)),
        close() {}
    }), Date.now, 5);
    const pdf = async () => Buffer.from('%PDF-simulado');
    const one = send(data(), 'ip-simulada', pdf);
    const two = send({ ...data(), id: 'segunda-simulada' }, 'ip-simulada', pdf);
    assert.equal((await send({ ...data(), id: 'tercera-simulada' }, 'otra-ip-simulada', pdf)).estado, 'limitado');
    assert.equal((await one).estado, 'no_confirmado');
    assert.equal((await two).estado, 'no_confirmado');
    assert.equal((await send({ ...data(), id: 'cuarta-simulada' }, 'otra-ip-simulada', pdf)).estado, 'limitado');
    assert.equal(pendientes.length, 2);
    pendientes.forEach(resolve => resolve({ accepted: [valid.cliente.correo] }));
    await new Promise(resolve => setImmediate(resolve));
    inmediato = true;
    const third = data(); third.id = 'quinta-simulada'; third.cliente.correo = 'otro-simulado@example.test';
    assert.equal((await send(third, 'otra-ip-simulada', pdf)).estado, 'aceptado');
});

test('límite global de registros persiste aunque cambien IP y clave', () => {
    const control = crearControlSolicitudes();
    for (let i = 0; i < 100; i++) {
        const result = control(`intento-global-simulado-${i}`, { simulado: i }, `ip-simulada-${i}`);
        assert.equal(result.tipo, 'nuevo');
        result.completar({ codigo: 201, cuerpo: { id: `simulado-${i}` } });
    }
    assert.equal(control('intento-global-bloqueado', { simulado: 100 }, 'ip-simulada-nueva').tipo, 'limitado');
});

test('confirmación asíncrona: PDF inmediato, consulta autorizada y un intento ante doble envío', async () => {
    let terminar;
    const mailGate = new Promise(resolve => { terminar = resolve; });
    await withApi({ env: smtp, mailGate }, async (post, state) => {
        try {
            const result = await (await post('/solicitudes', valid, 'intento-asincrono-001', { Prefer: 'respond-async' })).json();
            assert.equal(result.correo.estado, 'pendiente');
            assert.equal(state.writes, 1);
            assert.equal(state.mailCalls, 1);
            assert.deepEqual(await (await post('/solicitudes/correo/estado', { token: result.pdf.token })).json(), { estado: 'pendiente' });
            const download = await post('/solicitudes/pdf', { token: result.pdf.token });
            assert.equal(download.status, 200);
            const pdf = Buffer.from(await download.arrayBuffer());
            assert.deepEqual(await (await post('/solicitudes', valid, 'intento-asincrono-001', { Prefer: 'respond-async' })).json(), result);
            terminar();
            while (!state.messages.length) await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(await (await post('/solicitudes/correo/estado', { token: result.pdf.token, to: 'intruso@example.test' })).json(), { estado: 'aceptado' });
            assert.deepEqual(state.messages[0].message.attachments[0].content, pdf);
            assert.equal(state.mailCalls, 1);
            assert.equal(state.writes, 1);
        } finally { terminar(); }
    });
});

test('consulta de correo exige token vigente y limita frecuencia sin reenviar ni registrar', () => withApi({ env: smtp }, async (post, state, base) => {
    const result = await (await post('/solicitudes', valid)).json();
    for (const input of [{}, { id: result.id }, { token: result.pdf.token.slice(1) }, { token: require('./pdf-harness.cjs').apiRequire('./src/solicitud-acceso').emitirAcceso(data(), Date.now() - 31 * 60000).token }]) {
        assert.equal((await post('/solicitudes/correo/estado', input)).status, 403);
    }
    assert.equal((await fetch(base + '/solicitudes/correo/estado')).status, 404);
    for (let i = 0; i < 30; i++) {
        const response = await post('/solicitudes/correo/estado', { token: result.pdf.token });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { estado: 'aceptado' });
    }
    const limited = await post('/solicitudes/correo/estado', { token: result.pdf.token });
    assert.equal(limited.status, 429);
    assert.equal(state.mailCalls, 1);
    assert.equal(state.writes, 1);
    assert.equal((await post('/solicitudes/pdf', { token: result.pdf.token })).status, 200);
}));

test('idempotencia del canal conserva aceptación, error e incertidumbre y rechaza cambiar destinatario', async () => {
    for (const mode of ['accepted', 'EAUTH', 'ETIMEDOUT', 'ECONNRESET']) {
        let calls = 0;
        const send = crearServicioCorreo(smtp, () => ({
            async sendMail(message) {
                calls++;
                if (mode !== 'accepted') throw Object.assign(Error('Detalle privado simulado'), { code: mode });
                return { accepted: [message.to.address] };
            }, close() {}
        }));
        const input = data();
        const pdf = async () => Buffer.from('%PDF-simulado');
        const results = await Promise.all(Array.from({ length: 5 }, () => send(input, 'ip-simulada', pdf)));
        assert.equal(calls, 1);
        assert.equal(results[0].estado, mode === 'accepted' ? 'aceptado' : mode === 'EAUTH' ? 'error' : 'no_confirmado');
        results.forEach(result => assert.deepEqual(result, results[0]));
        assert.deepEqual(await send(input, 'otra-ip', pdf), results[0]);
        assert.deepEqual(send.estado(input), results[0]);
        assert.equal((await send({ ...input, cliente: { ...input.cliente, correo: 'otro@example.test' } }, 'ip-simulada', pdf)).estado, 'no_confirmado');
        assert.equal(calls, 1);
        const reiniciado = crearServicioCorreo(smtp, () => { throw Error('Consultar no debe enviar'); });
        assert.equal(reiniciado.estado(input).estado, 'no_confirmado');
    }
});

test('producción permanece cerrada hasta integrar idempotencia persistente', () => withApi({ env: { ...smtp, NODE_ENV: 'production' } }, async (post, state) => {
    const response = await post('/solicitudes', valid);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.correo.estado, 'no_disponible');
    assert.equal(state.mailCalls, 0);
    assert.equal((await post('/solicitudes/pdf', { token: result.pdf.token })).status, 200);
    assert.equal(state.writes, 1);
}));
