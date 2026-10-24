const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { productosHistoricosEnsayo, esProductoEnsayo, crearCatalogoLocal } = require('../api/scripts/catalogo-local.cjs');
const { apiRequire, conexiones, iniciarSimulada, post, sha, env } = require('./web-postgres-lab.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;

test('catálogo local identifica únicamente los registros históricos de ensayo', () => {
    assert.equal(esProductoEnsayo('web5c-puerta'), true);
    for (const id of ['web5c-puerta-nueva', 'web5c-producto-autorizado', 'producto-autorizado']) {
        assert.equal(esProductoEnsayo(id), false);
    }
});

test('PostgreSQL aislado: catálogo dinámico conserva productos nuevos con el mismo prefijo y cotiza sin publicar ensayos históricos', {
    skip: !process.env.GAONA_PERSIST_TEST_DATABASE_URL
}, async () => {
    const urls = conexiones();
    const owner = new PrismaClient({ datasources: { db: { url: urls.admin } }, log: [] });
    const db = new PrismaClient({ datasources: { db: { url: urls.web } }, log: [] });
    let api;
    try {
        const category = randomUUID(), id = 'web5c-producto-autorizado-' + randomUUID();
        await owner.categoria.create({ data: { id: category, nombre: 'Categoría ficticia de prueba aislada' } });
        await owner.producto.createMany({ data: productosHistoricosEnsayo.map(historico => ({
            id: historico, idCategoria: category, nombre: 'Producto histórico ficticio', precioDesde: '1.00',
            activo: historico !== 'web5c-inactivo', tipo: historico === 'web5c-material' ? 'MATERIAL' : 'PRODUCTO'
        })) });
        await owner.producto.create({ data: { id, idCategoria: category, nombre: 'Producto ficticio para validar una fuente autorizada', precioDesde: '111.25' } });
        const historicalBefore = await owner.producto.findMany({ where: { id: { in: [...productosHistoricosEnsayo] } }, orderBy: { id: 'asc' } });
        api = await iniciarSimulada(crearCatalogoLocal(db));
        const response = await fetch(api.base + '/productos');
        assert.equal(response.status, 200);
        const products = await response.json();
        assert.ok(products.some(p => p.id === id && p.precioDesde === '111.25'));
        assert.ok(products.every(p => !esProductoEnsayo(p.id)));
        const input = { cliente: { nombre: 'Cliente', apellido: 'Ficticio', telefono: '0000000000', correo: 'catalogo@example.test' },
            productos: [{ idProducto: id, cantidad: 2 }] };
        const key = 'catalogo-local-' + randomUUID();
        const created = await post(api.base, '/solicitudes', input, key);
        assert.equal(created.status, 201);
        const receipt = await created.json();
        assert.equal(receipt.estimado.subtotal, '222.50');
        assert.equal(receipt.estimado.iva, '35.60');
        assert.equal(receipt.estimado.total, '258.10');
        const duplicate = await post(api.base, '/solicitudes', input, key);
        assert.equal((await duplicate.json()).id, receipt.id);
        const pdf = await post(api.base, '/solicitudes/pdf', { token: receipt.pdf.token });
        assert.equal(pdf.status, 200);
        const bytes = Buffer.from(await pdf.arrayBuffer());
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        for (let n = 0; n < 50 && api.state.messages.length === 0; n++) await new Promise(r => setTimeout(r, 20));
        assert.equal(api.state.mailCalls, 1);
        assert.equal(api.state.messages[0].message.to.address, input.cliente.correo);
        assert.equal(sha(api.state.messages[0].message.attachments[0].content), sha(bytes));
        const forbidden = await post(api.base, '/solicitudes', { ...input, productos: [{ idProducto: 'web5c-puerta', cantidad: 1 }] });
        assert.equal(forbidden.status, 400);
        assert.deepEqual(await owner.producto.findMany({ where: { id: { in: [...productosHistoricosEnsayo] } }, orderBy: { id: 'asc' } }), historicalBefore);
    } finally { await api?.close(); await db.$disconnect(); await owner.$disconnect(); }
});
