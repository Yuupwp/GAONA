const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createHarness, valid, fixture, apiRequire } = require('./pdf-harness.cjs');
const { correoSolicitud, correoValido } = apiRequire('./src/solicitud-correo-validacion');
const { crearPlantillaCorreo } = apiRequire('./src/solicitud-correo-plantilla');
const { calcularEstimado } = apiRequire('./src/solicitud-estimado');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-ficticio', SMTP_PASSWORD: 'clave-ficticia-no-real', SMTP_FROM: 'gaona@example.test' };
const sha = b => createHash('sha256').update(b).digest('hex');
async function local(run) {
    const harness = createHarness({ entry: 'api-web.ts', env: smtp });
    const server = http.createServer(harness.app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const post = (body, key = 'web7-ficticio-idempotencia-001', route = '/solicitudes') => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body)
    });
    try { await run(post, harness.state); } finally { await new Promise(r => server.close(r)); }
}

test('Cotización y correo: correo normalizado sin cambiar dominio o mayúsculas; controles se rechazan antes del trim', () => {
    for (const address of ['Cliente@protonmail.com', 'alguien@dominio-poco-comun.technology', 'cliente+prueba@example.test', 'cliente@protonmai.com']) {
        assert.equal(correoSolicitud.parse('  ' + address + '  '), address);
        assert.equal(correoValido.parse(address), address);
    }
    for (const value of ['\ncliente@example.test', 'cliente@example.test\r\n', 'cliente\t@example.test', 'cliente@example.test\x00', 'cliente@example.test\x7f', 'cliente@example.test\x85', 'cliente@example.test,otro@example.test', 'nombre <cliente@example.test>', 'cliente@sin-dominio']) {
        assert.equal(correoSolicitud.safeParse(value).success, false);
    }
});

test('Cotización y correo: plantilla HTML/texto conserva acentos, escapa productos y muestra fecha, IVA y total estimado', () => {
    const estimado = calcularEstimado(valid.productos, fixture.map(p => ({ ...p, nombre: 'Portón <roble> & "diseño"' })));
    const datos = { id: 'web7-folio-ficticio', fecha: '2026-10-24T12:15:00Z', cliente: { ...valid.cliente, nombre: 'José <script>alert(1)</script>' }, estimado };
    const { html, text } = crearPlantillaCorreo(datos);
    for (const content of [html, text]) {
        for (const expected of [datos.id, 'octubre', '2026', '2,500.60', '400.10', '2,900.70', 'IVA (16%)', 'Total estimado', 'PDF', 'no confirma una venta', 'GAONA']) assert.ok(content.includes(expected), expected);
    }
    assert.ok(html.includes('José &lt;script&gt;'));
    assert.ok(html.includes('Portón &lt;roble&gt; &amp; &quot;diseño&quot;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(text.includes('2 × Portón'));
    assert.ok(!html.includes('http:') && !html.includes('https:'));
});

test('Cotización y correo: API pública persiste correo recortado, ignora destinatarios externos y conserva MIME/PDF al repetir', () => local(async (post, state) => {
    const address = 'Cliente+web7@example.test';
    const body = { ...valid, cliente: { ...valid.cliente, correo: '  ' + address + '  ', to: 'intruso@example.test' },
        to: 'intruso@example.test', bcc: 'intruso@example.test', subject: 'Asunto inyectado', attachments: [{ path: '/etc/passwd' }] };
    const first = await post(body); assert.equal(first.status, 201);
    const result = await first.json();
    assert.equal(state.saved.cliente.create.correo, address);
    assert.equal((await (await post({ ...body, cliente: { ...body.cliente, correo: address } })).json()).id, result.id);
    assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
    const { message, raw } = state.messages[0];
    assert.equal(message.to.address, address); assert.deepEqual(message.envelope.to, [address]);
    assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined);
    assert.equal(message.subject, `GAONA | Solicitud de cotización - ${result.id}`);
    const downloaded = Buffer.from(await (await post({ token: result.pdf.token }, undefined, '/solicitudes/pdf')).arrayBuffer());
    const mime = JSON.parse(execFileSync('python3', ['-c', `import sys,json,hashlib
from email import policy
from email.parser import BytesParser
m=BytesParser(policy=policy.default).parsebytes(sys.stdin.buffer.read())
a=list(m.iter_attachments())
t=m.get_body(preferencelist=('plain',));h=m.get_body(preferencelist=('html',))
print(json.dumps(dict(to=m['To'],plain=t.get_content(),html=h.get_content(),charset=[t.get_content_charset(),h.get_content_charset()],count=len(a),mime=a[0].get_content_type(),sha=hashlib.sha256(a[0].get_payload(decode=True)).hexdigest())))`], { input: raw, encoding: 'utf8' }));
    assert.equal(mime.to, address); assert.equal(mime.count, 1); assert.equal(mime.mime, 'application/pdf');
    assert.deepEqual(mime.charset, ['utf-8', 'utf-8']);
    for (const content of [mime.plain, mime.html]) for (const value of ['cotización', 'Puerta de roble', 'Ventana de aluminio', '2,900.70', result.id]) assert.ok(content.includes(value));
    assert.equal(mime.sha, sha(downloaded));
    assert.ok(!raw.toString().includes(smtp.SMTP_PASSWORD));
    assert.ok(!raw.toString().includes(result.pdf.token));
}));

test('Cotización y correo: API pública rechaza controles, listas e inyección sin registrar ni preparar correo', () => local(async (post, state) => {
    for (const correo of ['\nuno@example.test', 'uno@example.test\x00', 'uno@example.test\r\nBcc: otro@example.test', 'uno@example.test,otro@example.test', 'uno@incompleto']) {
        const response = await post({ ...valid, cliente: { ...valid.cliente, correo } });
        assert.equal(response.status, 400);
        assert.ok((await response.json()).campos.includes('cliente.correo'));
    }
    assert.equal(state.writes, 0); assert.equal(state.mailCalls, 0);
}));
