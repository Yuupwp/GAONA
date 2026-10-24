const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
const { transformSync } = apiRequire('esbuild');
const source = transformSync(readFileSync(path.join(__dirname, '../api/src/index.ts'), 'utf8'),
    { loader: 'ts', format: 'cjs' }).code;

function routes(prisma) {
    const handlers = {};
    const app = { use() {}, listen() {}, get(route, handler) { handlers[`GET ${route}`] = handler; },
        post(route, handler) { handlers[`POST ${route}`] = handler; } };
    const express = Object.assign(() => app, { json: () => () => {} });
    vm.runInNewContext(source, { require(name) {
        if (name === 'express') return express;
        if (name === 'cors') return () => () => {};
        if (name === 'dotenv/config') return {};
        if (name === './lib/prisma') return { prisma };
        if (name === './clientes') return { clientesRouter: {} };
        return apiRequire(name);
    }, process: { env: {} }, console: { log() {}, error() {} } });
    return handlers;
}
function response() {
    return { code: 200, body: undefined, status(code) { this.code = code; return this; },
        json(body) { this.body = body; } };
}
const valid = { cliente: { nombre: 'Prueba', apellido: 'Catálogo', telefono: '5555555555' },
    productos: [{ idProducto: 'prueba-1', cantidad: 1 }] };

test('GET consulta solo activos PRODUCTO y conserva campos públicos y orden', async () => {
    let query;
    const rows = [{ id: 'prueba-1', precioDesde: '25.50' }];
    const handlers = routes({ producto: { findMany: async value => { query = value; return rows; } } });
    const res = response();
    await handlers['GET /productos']({}, res);
    assert.deepEqual(JSON.parse(JSON.stringify(query.where)), { activo: true, tipo: 'PRODUCTO' });
    assert.deepEqual(Object.keys(query.select).sort(), ['categoria', 'descripcion', 'id', 'imagenUrl', 'nombre', 'precioDesde']);
    assert.equal(query.orderBy.nombre, 'asc');
    assert.equal(res.body, rows);
});

test('GET maneja catálogo vacío y error de base de datos sin exponer detalles', async () => {
    const res = response();
    await routes({ producto: { findMany: async () => [] } })['GET /productos']({}, res);
    assert.equal(res.body.length, 0);
    await routes({ producto: { findMany: async () => { throw Error('Detalle privado'); } } })['GET /productos']({}, res);
    assert.equal(res.code, 500);
    assert.equal(res.body.error, 'No se pudieron obtener los productos');
});

test('POST rechaza producto inexistente, inactivo o de otro tipo sin crear cliente ni solicitud', async () => {
    let writes = 0;
    const handlers = routes({ producto: { count: async ({ where }) => {
        assert.equal(where.activo, true);
        assert.equal(where.tipo, 'PRODUCTO');
        return 0;
    } }, solicitud: { create: async () => { writes++; } } });
    const res = response();
    await handlers['POST /solicitudes']({ body: valid }, res);
    assert.equal(res.code, 400);
    assert.equal(writes, 0);
});

test('POST valida entrada antes de consultar y conserva el contrato de solicitud válida', async () => {
    let writes = 0;
    const handlers = routes({ producto: { count: async () => 1 }, solicitud: { create: async ({ data }) => {
        writes++;
        assert.equal(data.origen, 'WEB');
        assert.equal(data.detalles.create[0].idProducto, 'prueba-1');
        return { id: 'solicitud-prueba' };
    } } });
    const bad = response();
    await handlers['POST /solicitudes']({ body: { ...valid, productos: [] } }, bad);
    assert.equal(bad.code, 400);
    const good = response();
    await handlers['POST /solicitudes']({ body: valid }, good);
    assert.equal(good.code, 201);
    assert.equal(good.body.id, 'solicitud-prueba');
    assert.equal(writes, 1);
});
