const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHarness, valid } = require('./pdf-harness.cjs');
async function local(run, options = {}) {
    const harness = createHarness({ entry: 'api-web.ts', ...options });
    const server = http.createServer(harness.app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body, key = 'web8-idempotencia-ficticia-001') => fetch(base + '/solicitudes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body)
    });
    try { await run(post, harness.state, base); } finally { await new Promise(r => server.close(r)); }
}
test('Validación pública: teléfono razonable en backend y datos normales preservados sin confiar en importes del navegador', () => local(async (post, state) => {
    for (const telefono of ['abcdefg', '555abc5555', '123456', '5555555\nBcc', '555+5555555', '\x0055555555']) {
        const response = await post({ ...valid, cliente: { ...valid.cliente, telefono } });
        assert.equal(response.status, 400);
        assert.ok((await response.json()).campos.includes('cliente.telefono'));
    }
    assert.equal(state.writes, 0);
    const data = { ...valid, cliente: { ...valid.cliente, nombre: ' Ana María ', apellido: " O'Connor-López ", telefono: ' 81 1234 5678 ', direccion: 'Calle Ficticia #10, Pruebas' },
        descripcion: 'Medidas aproximadas: 90 × 210 cm; color café, "natural" & mate.',
        total: '0.01', productos: valid.productos.map(p => ({ ...p, precioUnitario: '0.01' })) };
    const response = await post(data); assert.equal(response.status, 201);
    const result = await response.json(); assert.equal(result.estimado.total, '2900.70');
    const saved = state.saved.cliente.create;
    assert.equal(saved.nombre, 'Ana María'); assert.equal(saved.apellido, "O'Connor-López");
    assert.equal(saved.telefono, '81 1234 5678'); assert.equal(saved.direccion, data.cliente.direccion);
    assert.equal(state.saved.descripcion, data.descripcion); assert.equal(state.writes, 1);
}));
test('Validación pública: alterar consentimiento o HTML no activa WhatsApp en la API pública', () => local(async (post, state, base) => {
    const response = await post({ ...valid, cliente: { ...valid.cliente, telefono: '+15555550101' }, whatsappConsentimiento: true });
    assert.equal(response.status, 201); assert.equal((await response.json()).whatsapp.estado, 'no_disponible');
    assert.equal(state.whatsappCreated, undefined);
    for (const route of ['/webhooks/whatsapp', '/solicitudes/whatsapp/estado', '/clientes', '/empleados']) {
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await fetch(base + route, { method })).status, 404);
    }
    assert.equal(state.imports.includes('./clientes'), false); assert.equal(state.imports.includes('./empleado'), false);
}, { apiEnv: { WHATSAPP_ENABLED: 'true' } }));
test('Validación pública: fallo del registro no devuelve tokens, datos privados ni intenta correo', () => local(async (post, state) => {
    state.failWrite = true;
    const response = await post(valid); assert.equal(response.status, 500);
    const body = await response.json(); assert.equal(body.pdf, undefined);
    assert.ok(!JSON.stringify(body).includes('Fallo de base simulada'));
    assert.equal(state.writes, 0); assert.equal(state.mailCalls, 0);
}));
