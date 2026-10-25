const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness, fixture, valid, apiRequire } = require('./pdf-harness.cjs');
const { calcularEstimado } = apiRequire('./src/solicitud-estimado');
const { emitirAcceso, leerAcceso } = apiRequire('./src/solicitud-acceso');
const { generarSolicitudPdf } = apiRequire('./src/solicitud-pdf');
const comprobante = () => ({ id: '11111111-2222-4333-8444-555555555555', fecha: '2026-10-22T12:00:00Z',
    cliente: valid.cliente, descripcion: valid.descripcion, estimado: calcularEstimado(valid.productos, fixture) });
async function withApi(run) {
    const { app, state } = createHarness();
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, data) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    try { await run(post, state, base); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test('decimal exacto, IVA 16 %, medio centavo, cero y montos máximos del esquema', () => {
    const e = calcularEstimado(valid.productos, fixture);
    assert.deepEqual([e.subtotal, e.iva, e.total], ['2500.60', '400.10', '2900.70']);
    const { Prisma } = apiRequire('@prisma/client');
    const estimate = (price, cantidad = 1) => calcularEstimado([{ idProducto: 'p', cantidad }], [{ id: 'p', nombre: 'Simulado', precioDesde: new Prisma.Decimal(price) }]);
    assert.equal(estimate('0.10', 3).total, '0.35');
    assert.equal(estimate('0.03').iva, '0.00');
    assert.equal(estimate('0.04').iva, '0.01');
    assert.equal(estimate('0').total, '0.00');
    assert.equal(estimate('9999999999.99', 999).subtotal, '9989999999990.01');
    assert.throws(() => estimate('-1'));
    assert.throws(() => estimate('0.001'));
    assert.throws(() => calcularEstimado([{ idProducto: 'ausente', cantidad: 1 }], fixture));
});

test('acceso cifrado: alteración, expiración, identificador simple y entradas inválidas', () => {
    const data = comprobante();
    const { token } = emitirAcceso(data, 10000);
    assert.deepEqual(leerAcceso(token, 10001), data);
    assert.ok(!Buffer.from(token, 'base64url').toString().includes('Cliente'));
    assert.equal(leerAcceso(token, 10000 + 30 * 60 * 1000), null);
    for (const invalid of [undefined, null, data.id, token.slice(0, 30) + '!' + token.slice(31), 'a'.repeat(90001)]) {
        assert.equal(leerAcceso(invalid, 10001), null);
    }
    const bytes = Buffer.from(token, 'base64url'); bytes[30] ^= 1;
    assert.equal(leerAcceso(bytes.toString('base64url'), 10001), null);
});

test('HTTP: precios del backend, persistencia compatible y descarga repetible sin más escrituras', () => withApi(async (post, state, base) => {
    const res = await post('/solicitudes', { ...valid, productos: valid.productos.map(p => ({ ...p, precioDesde: '0.01', nombre: 'Manipulado' })) });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.estimado.total, '2900.70');
    assert.equal(body.estimado.productos[0].nombre, fixture[0].nombre);
    assert.equal(state.saved.origen, 'WEB');
    assert.deepEqual(JSON.parse(JSON.stringify(state.saved.detalles.create)), valid.productos);
    assert.equal(state.saved.cliente.create.nombre, valid.cliente.nombre);
    assert.equal(state.queries[0].where.activo, true);
    assert.equal(state.queries[0].where.tipo, 'PRODUCTO');
    fixture[0].precioDesde = fixture[0].precioDesde.plus(100);
    try {
        for (let i = 0; i < 2; i++) {
            const pdf = await post('/solicitudes/pdf', { token: body.pdf.token });
            assert.equal(pdf.status, 200);
            assert.match(pdf.headers.get('content-type'), /application\/pdf/);
            assert.match(pdf.headers.get('content-disposition'), /attachment; filename="GAONA-solicitud-/);
            assert.equal(pdf.headers.get('cache-control'), 'no-store');
            assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        }
        assert.equal(leerAcceso(body.pdf.token).estimado.total, '2900.70');
    } finally { fixture[0].precioDesde = fixture[0].precioDesde.minus(100); }
    assert.equal(state.writes, 1);
    assert.equal((await fetch(base + '/solicitudes/' + body.id + '/pdf')).status, 404);
    assert.equal((await post('/solicitudes/pdf', { id: body.id })).status, 403);
    assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token.slice(1) })).status, 403);
    const expired = emitirAcceso(comprobante(), Date.now() - 31 * 60 * 1000);
    assert.equal((await post('/solicitudes/pdf', { token: expired.token })).status, 403);
    assert.equal(state.writes, 1);
}));

test('validación de datos, productos retirados y límites sin escrituras', () => withApi(async (post, state) => {
    for (const data of [
        { ...valid, productos: [] },
        { ...valid, productos: Array(31).fill(valid.productos[0]) },
        { ...valid, cliente: { ...valid.cliente, nombre: '' } },
        { ...valid, cliente: { ...valid.cliente, correo: 'invalido' } },
        ...[0, -1, 1.5, 1000].map(cantidad => ({ ...valid, productos: [{ idProducto: fixture[0].id, cantidad }] })),
        { ...valid, productos: [{ idProducto: 'retirado', cantidad: 1 }] }
    ]) assert.equal((await post('/solicitudes', data)).status, 400);
    assert.equal(state.writes, 0);
}));

test('fallos PDF y comprobante conservan solicitud, reintento PDF no duplica', () => withApi(async (post, state) => {
    const body = await (await post('/solicitudes', valid)).json();
    state.failPdf = true;
    const failed = await post('/solicitudes/pdf', { token: body.pdf.token });
    assert.equal(failed.status, 503);
    assert.match((await failed.json()).error, /sigue registrada/);
    state.failPdf = false;
    assert.equal((await post('/solicitudes/pdf', { token: body.pdf.token })).status, 200);
    assert.equal(state.writes, 1);
    state.failReceipt = true;
    const saved = await post('/solicitudes', { ...valid, descripcion: 'Otro registro simulado para fallo de comprobante' });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).pdf, null);
    assert.equal(state.writes, 2);
    state.failWrite = true;
    assert.equal((await post('/solicitudes', { ...valid, descripcion: 'Registro simulado para fallo de escritura' })).status, 500);
    assert.equal(state.writes, 2);
}));

test('PDF válido y multipágina: productos, cantidades, medidas, notas, totales y márgenes', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gaona-pdf-'));
    try {
        const data = comprobante();
        const normal = path.join(temp, 'normal.pdf');
        await fs.writeFile(normal, await generarSolicitudPdf(data));
        const text = execFileSync('pdftotext', ['-layout', normal, '-'], { encoding: 'utf8' });
        for (const value of ['Solicitud de cotización', 'Cliente Simulado', 'prueba@example.test', 'Puerta de roble', 'Ventana de aluminio', '90 x 210 cm', '120 x 100 cm', 'Acabado natural', '2,500.60', '400.10', '2,900.70', 'IVA (16 %)', 'no constituye']) assert.ok(text.includes(value), value);
        assert.match(text, /2\s+\$1,250.15/);
        assert.match(text, /3\s+\$0.10/);
        const productos = Array.from({ length: 30 }, (_, i) => ({ idProducto: fixture[i % 2].id, cantidad: i + 1,
            medidasAprox: 'Medida larga '.repeat(8).slice(0, 100), notas: ('Observaciones extensas del producto ' + i + '. ').repeat(20).slice(0, 480) + ` FIN-${i}` }));
        data.descripcion = 'Observaciones generales extensas. '.repeat(30).slice(0, 1000);
        data.estimado = calcularEstimado(productos, fixture);
        data.estimado.productos[0].nombre = 'NombreExtensoSinEspacios'.repeat(120);
        data.cliente.correo = undefined;
        const long = path.join(temp, 'largo.pdf');
        await fs.writeFile(long, await generarSolicitudPdf(data));
        const info = execFileSync('pdfinfo', [long], { encoding: 'utf8' });
        const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
        assert.ok(pages > 2);
        const longText = execFileSync('pdftotext', ['-layout', long, '-'], { encoding: 'utf8' });
        for (let i = 0; i < 30; i++) assert.ok(longText.includes(`FIN-${i}`));
        assert.equal((longText.match(/GAONA · Importes estimados/g) || []).length, pages);
        assert.ok((longText.match(/Producto \/ medidas \/ notas/g) || []).length > 1);
        const bbox = execFileSync('pdftotext', ['-bbox', long, '-'], { encoding: 'utf8' });
        for (const word of bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)) {
            assert.ok(Number(word[1]) >= 47 && Number(word[3]) <= 565, word[0]);
            assert.ok(Number(word[2]) >= 34 && Number(word[4]) < 770, word[0]);
        }
        if (process.env.GAONA_PDF_SAMPLE_DIR) {
            await fs.mkdir(process.env.GAONA_PDF_SAMPLE_DIR, { recursive: true });
            await fs.copyFile(normal, path.join(process.env.GAONA_PDF_SAMPLE_DIR, 'solicitud-simulada.pdf'));
            await fs.copyFile(long, path.join(process.env.GAONA_PDF_SAMPLE_DIR, 'solicitud-simulada-extensa.pdf'));
        }
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
});


test('errores 400 distinguen campos, producto y clave antes de persistir sin exponer valores', () => withApi(async (post, state, base) => {
    const invalid = { ...valid, cliente: { ...valid.cliente, correo: 'prueba@equipo' } };
    const response = await post('/solicitudes', invalid);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { codigo: 'DATOS_INVALIDOS', error: 'Datos incompletos o inválidos', campos: ['cliente.correo'] });
    assert.equal(state.queries.length, 0);
    assert.equal(state.writes, 0);
    const quantity = await post('/solicitudes', { ...valid, productos: [{ ...valid.productos[0], cantidad: '1' }] });
    assert.equal(quantity.status, 400);
    assert.deepEqual((await quantity.json()).campos, ['productos.0.cantidad']);
    const key = await fetch(base + '/solicitudes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'corta' }, body: JSON.stringify(valid) });
    assert.equal(key.status, 400);
    assert.equal((await key.json()).codigo, 'CLAVE_INVALIDA');
    assert.equal(state.queries.length, 0);
    const product = await post('/solicitudes', { ...valid, productos: [{ idProducto: 'retirado', cantidad: 1 }] });
    assert.equal(product.status, 400);
    assert.equal((await product.json()).codigo, 'PRODUCTO_NO_DISPONIBLE');
    assert.equal(state.queries.length, 1);
    assert.equal(state.writes, 0);
}));

test('Cancel de baño simulado: ID correcto, cantidad 1, medidas y total 4582 con correo opcional', () => withApi(async (post, state) => {
    const product = { id: '2716c6ae-8b92-4866-b86a-c45e3ba037ee', nombre: 'Cancel de baño', precioDesde: new (apiRequire('@prisma/client').Prisma.Decimal)('3950'), categoria: { nombre: 'Canceles' } };
    fixture.push(product);
    try {
        const data = { cliente: { ...valid.cliente, correo: undefined }, productos: [{ idProducto: product.id, cantidad: 1, medidasAprox: '90 x 210 cm' }] };
        const response = await post('/solicitudes', data);
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.deepEqual([result.estimado.subtotal, result.estimado.iva, result.estimado.total], ['3950.00', '632.00', '4582.00']);
        assert.equal(result.correo.estado, 'sin_correo');
        assert.deepEqual(Array.from(state.queries[0].where.id.in), [product.id]);
        assert.deepEqual(JSON.parse(JSON.stringify(state.saved.detalles.create)), data.productos);
        const pdf = await post('/solicitudes/pdf', { token: result.pdf.token });
        assert.equal(pdf.status, 200);
        assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        assert.equal(state.writes, 1);
        assert.equal(state.mailCalls, 0);
    } finally { fixture.pop(); }
}));
