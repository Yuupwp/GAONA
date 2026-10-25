const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { apiRequire, createHarness, valid } = require('./pdf-harness.cjs');
const { whatsappEnv, createStore, createMeta } = require('./whatsapp-cloud-harness.cjs');
const { normalizarTelefonoWhatsapp, configurarWhatsapp, crearClienteMeta } = apiRequire('./src/solicitud-whatsapp');
const { crearLimiteFrecuencia } = apiRequire('./src/solicitud-controles');
async function scenario(run, options = {}) {
    const meta = createMeta();
    if (options.mode) meta.state.mode = options.mode;
    const harness = createHarness({ whatsappEnv, whatsappStoreFactory: createStore, whatsappFetch: meta.fetch, ...options });
    const server = http.createServer(harness.app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    try { await run({ ...harness, meta, post, base }); }
    finally { await new Promise(r => server.close(r)); }
}
const consented = () => ({ ...valid, whatsappConsentimiento: true, cliente: { ...valid.cliente, telefono: '+1 (555) 555-0101' } });
const webhook = (t, status = 'delivered') => ({ object: 'whatsapp_business_account', entry: [{ id: whatsappEnv.WHATSAPP_BUSINESS_ACCOUNT_ID, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: whatsappEnv.WHATSAPP_PHONE_NUMBER_ID },
    statuses: [{ id: 'wamid.simulado1', recipient_id: '15555550101', status, timestamp: String(Math.floor(Date.now() / 1000)), biz_opaque_callback_data: t.id }]
} }] }] });

test('WhatsApp exige configuración completa, E.164 explícito y lista cerrada de prueba', () => {
    assert.equal(configurarWhatsapp({}), null);
    assert.ok(configurarWhatsapp({ ...whatsappEnv, WHATSAPP_ENABLED: 'false' }));
    for (const field of ['WHATSAPP_STORAGE', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_IDEMPOTENCY_KEY', 'WHATSAPP_TEST_RECIPIENTS', 'WHATSAPP_GRAPH_VERSION']) assert.equal(configurarWhatsapp({ ...whatsappEnv, [field]: '' }), null);
    assert.equal(normalizarTelefonoWhatsapp('+1 (555) 555-0101'), '+15555550101');
    for (const value of ['5555555555', '+0123456789', '+15555550101 ext2', '+15555550101\r\nBcc:otro', '++15555550101', '+123', '+1234567890123456']) assert.equal(normalizarTelefonoWhatsapp(value), null);
});

test('Cloud API sube PDF privado y envía plantilla fija; adjunto idéntico a SMTP y descarga', () => scenario(async ({ post, state, meta, whatsappStore }) => {
    const response = await post('/solicitudes', consented(), { 'Idempotency-Key': 'simulado-whatsapp-01' });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.whatsapp.estado, 'aceptado');
    const t = whatsappStore.trabajos.get(result.id);
    assert.equal(meta.state.calls.length, 2);
    const upload = meta.state.calls[0], send = meta.state.calls[1];
    assert.match(upload.url, /^https:\/\/graph.facebook.com\/v26.0\/111111111111\/media$/);
    assert.equal(upload.options.body.get('messaging_product'), 'whatsapp');
    const file = upload.options.body.get('file');
    assert.equal(file.type, 'application/pdf');
    assert.equal(file.name, `GAONA-Solicitud-${result.id}.pdf`);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(bytes, t.pdf);
    const payload = JSON.parse(send.options.body);
    assert.equal(payload.to, '15555550101');
    assert.equal(payload.template.components[0].parameters[0].document.id, '333333333333');
    assert.equal(payload.template.components[1].parameters[0].text, result.id.slice(0, 8).toUpperCase());
    assert.equal(payload.biz_opaque_callback_data, t.id);
    assert.equal(payload.template.name, whatsappEnv.WHATSAPP_TEMPLATE_NAME);
    assert.equal(JSON.stringify(payload).includes(result.pdf.token), false);
    const download = await post('/solicitudes/pdf', { token: result.pdf.token });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.deepEqual(state.messages[0].message.attachments[0].content, bytes);
    assert.equal(state.writes, 1);
    assert.equal((await (await post('/solicitudes/whatsapp/estado', { token: result.pdf.token })).json()).estado, 'aceptado');
}, { env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'simulado', SMTP_PASSWORD: 'clave-simulada-no-real', SMTP_FROM: 'gaona@example.test' } }));

test('consentimiento estricto, teléfono internacional y valores inválidos no escriben ni contactan Meta', () => scenario(async ({ post, state, meta }) => {
    for (const data of [{ ...consented(), whatsappConsentimiento: 'true' }, { ...consented(), cliente: { ...valid.cliente } }]) {
        const r = await post('/solicitudes', data); assert.equal(r.status, 400);
    }
    assert.equal(state.writes, 0);
    const r = await post('/solicitudes', valid);
    assert.equal((await r.json()).whatsapp.estado, 'sin_consentimiento');
    assert.equal(meta.state.calls.length, 0);
    assert.equal(state.writes, 1);
}));

test('almacenamiento ausente y destinatario fuera de lista conservan registro y PDF sin envío', async () => {
    for (const options of [{ whatsappStoreFactory: undefined }, { whatsappEnv: { ...whatsappEnv, WHATSAPP_TEST_RECIPIENTS: '+15555550102' } }, { whatsappEnv: {} }]) await scenario(async ({ post, state, meta }) => {
        const r = await post('/solicitudes', consented()); assert.equal(r.status, 201); const body = await r.json();
        assert.equal(body.whatsapp.estado, 'no_disponible');
        assert.equal((await (await post('/solicitudes/whatsapp/estado', { token: body.pdf.token })).json()).estado, 'no_disponible');
        assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
        assert.equal(state.writes, 1); assert.equal(meta.state.calls.length, 0);
    }, options);
});

test('rechazo, 429, red y timeout no reintentan mensajes ni duplican solicitudes', async () => {
    for (const mode of ['rejected', 'limited', 'connection', 'ambiguous', 'server']) await scenario(async ({ post, state, meta }) => {
        const headers = { 'Idempotency-Key': 'simulado-whatsapp-reintento' };
        const one = await post('/solicitudes', consented(), headers); assert.equal(one.status, 201); const body = await one.json();
        assert.equal(body.whatsapp.estado, ['ambiguous', 'server'].includes(mode) ? 'no_confirmado' : 'error');
        const count = meta.state.calls.length;
        const two = await post('/solicitudes', consented(), headers); assert.deepEqual(await two.json(), body);
        assert.equal(meta.state.calls.length, count); assert.equal(state.writes, 1);
        assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
    }, { mode });
});

test('webhook verifica challenge, HMAC crudo, WABA y número; deduplica eventos sin degradar entrega', () => scenario(async ({ post, base, whatsappStore, state, meta }) => {
    const result = await (await post('/solicitudes', consented())).json(); const t = whatsappStore.trabajos.get(result.id);
    const url = `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=12345&hub.verify_token=${whatsappEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN}`;
    assert.equal(await (await fetch(url)).text(), '12345');
    assert.equal((await fetch(url.replace(whatsappEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'invalido'))).status, 403);
    const deliver = async (body, signature) => {
        const text = JSON.stringify(body);
        const sig = signature ?? 'sha256=' + createHmac('sha256', whatsappEnv.WHATSAPP_APP_SECRET).update(text).digest('hex');
        return fetch(base + '/webhooks/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: text });
    };
    assert.equal((await deliver(webhook(t), 'sha256=' + '0'.repeat(64))).status, 403);
    const other = webhook(t); other.entry[0].id = 'otro'; await deliver(other);
    assert.equal(await whatsappStore.estado(result.id), 'aceptado');
    assert.equal((await deliver(webhook(t))).status, 200);
    assert.equal((await deliver(webhook(t))).status, 200);
    assert.equal(await whatsappStore.estado(result.id), 'entregado');
    await deliver(webhook(t, 'sent')); await deliver(webhook(t, 'failed'));
    assert.equal(await whatsappStore.estado(result.id), 'entregado');
    await deliver(webhook(t, 'read')); assert.equal(await whatsappStore.estado(result.id), 'leido');
    assert.equal((await post('/solicitudes/whatsapp/estado', { id: result.id })).status, 403);
    assert.equal((await post('/solicitudes/whatsapp/estado', { token: result.pdf.token.slice(1) })).status, 403);
    const status = await post('/solicitudes/whatsapp/estado', { token: result.pdf.token }); assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { estado: 'leido' });
    assert.equal(state.writes, 1); assert.equal(meta.state.calls.length, 2);
}));

test('PDF inválido y sobredimensionado se rechazan antes de subir, sin exponer URL o tokens', async () => {
    const meta = createMeta(); const client = crearClienteMeta(configurarWhatsapp(whatsappEnv), meta.fetch);
    await assert.rejects(() => client.subir(Buffer.from('no es pdf'), 'archivo.pdf'));
    const large = Buffer.alloc(2097153); large.write('%PDF-');
    await assert.rejects(() => client.subir(large, 'archivo.pdf'));
    assert.equal(meta.state.calls.length, 0);
    const limiter = crearLimiteFrecuencia(); assert.equal(limiter([{ clave: 'prueba', maximo: 1, periodo: 60000 }]), true);
});

test('servicio pausado conserva PDF y webhooks pero nunca vuelve a enviar', () => scenario(async ({ post, meta, whatsappStore }) => {
    const body = await (await post('/solicitudes', consented())).json();
    const { crearServicioWhatsapp } = apiRequire('./src/solicitud-whatsapp');
    const paused = crearServicioWhatsapp({ ...whatsappEnv, WHATSAPP_ENABLED: 'false' }, whatsappStore, meta.fetch);
    const before = meta.state.calls.length;
    assert.equal((await paused.enviar({ id: body.id }, true, () => { throw Error('No debe generar'); })).estado, 'no_disponible');
    assert.ok(await paused.pdf(body.id));
    assert.equal(await paused.estado(body.id), 'aceptado');
    const job = whatsappStore.trabajos.get(body.id);
    await paused.evento({ mensaje: 'wamid.simulado1', destinatario: job.destinatario, correlacion: job.id, estado: 'entregado', fecha: new Date().toISOString() });
    assert.equal(await paused.estado(body.id), 'entregado');
    assert.equal(meta.state.calls.length, before);
}));

test('activación sin almacén verificado falla antes de crear; desactivado permite registrar sin enviar', async () => {
    await scenario(async ({ post, state, meta }) => {
        assert.equal((await post('/solicitudes', consented())).status, 500);
        assert.equal(state.writes, 0); assert.equal(meta.state.calls.length, 0);
    }, { whatsappStoreFactory: p => Object.assign(createStore(p), { ready: false }) });
    await scenario(async ({ post, state, meta }) => {
        const r = await post('/solicitudes', consented()); assert.equal(r.status, 201);
        assert.equal((await r.json()).whatsapp.estado, 'no_disponible');
        assert.equal(state.writes, 1); assert.equal(meta.state.calls.length, 0);
    }, { whatsappEnv: { ...whatsappEnv, WHATSAPP_ENABLED: 'false' }, whatsappStoreFactory: p => Object.assign(createStore(p), { ready: false }) });
});

test('el identificador de destinatario normalizado por Meta queda vinculado al estado', () => scenario(async ({ post, meta, whatsappStore }) => {
    meta.state.recipient = '199955550101';
    const result = await (await post('/solicitudes', consented())).json();
    const t = whatsappStore.trabajos.get(result.id);
    assert.equal(t.destinatarioProveedor, '+199955550101');
    assert.equal(t.destinatario, '+15555550101');
    await whatsappStore.evento({ correlacion: t.id, mensaje: 'wamid.simulado1', destinatario: '+199955550101', estado: 'entregado', fecha: new Date().toISOString() });
    assert.equal(await whatsappStore.estado(result.id), 'entregado');
}));
