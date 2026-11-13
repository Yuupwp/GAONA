const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearHarness } = require('./escritorio-harness.cjs');
const usuarios = new Map([
    ['admin', { id: 'admin', activo: true, rol: { nombre: 'ADMINISTRADOR' } }],
    ['empleado', { id: 'empleado', activo: true, rol: { nombre: 'EMPLEADO' } }],
    ['inactivo', { id: 'inactivo', activo: false, rol: { nombre: 'ADMINISTRADOR' } }],
]);
const estado = { consultas: [], escrituras: [], movimientos: [], inventario: { id: 'stock-1', existencia: 10, minimo: 2 } };
const registrar = (nombre, respuesta) => async query => { estado.consultas.push({ nombre, query }); return typeof respuesta === 'function' ? respuesta() : respuesta; };
const fecha = new Date();
const prisma = {
    usuario: { findUnique: async ({ where }) => usuarios.get(where.id) ?? null },
    solicitud: { count: registrar('solicitud.count', 3) },
    pedido: { count: registrar('pedido.count', 2), findMany: registrar('pedido.findMany', [{ id: 'pedido-12345678', estado: 'EN_PROCESO', creadoEn: fecha, cliente: { nombre: 'Cliente', apellido: 'Simulado' } }]) },
    cita: { findMany: registrar('cita.findMany', [{ id: 'cita-1', tipo: 'MEDICION', inicio: fecha, fin: fecha, direccion: 'Prueba', usuario: { nombre: 'Responsable', apellido: 'Simulado' }, solicitud: { cliente: { nombre: 'Cliente', apellido: 'Simulado' } }, pedido: null }]) },
    pago: { aggregate: registrar('pago.aggregate', { _sum: { monto: '1234.50' } }) },
    inventario: {
        findMany: registrar('inventario.findMany', () => [{ ...estado.inventario, producto: { id: 'producto-1', nombre: 'Producto', categoria: { nombre: 'Categoría' } } }]),
        findUnique: registrar('inventario.findUnique', () => ({ ...estado.inventario })),
        update: async ({ where, data }) => { estado.escrituras.push({ where, data }); estado.inventario = { ...estado.inventario, ...data }; return { ...estado.inventario }; },
    },
    movimientoInventario: {
        findMany: registrar('movimientoInventario.findMany', () => [...estado.movimientos]),
        create: async ({ data }) => { estado.movimientos.push({ id: 'movimiento-1', ...data }); return data; },
    },
    producto: {
        findFirst: registrar('producto.findFirst', null),
        findMany: registrar('producto.findMany', []),
        findUnique: registrar('producto.findUnique', { id: 'producto-1' }),
        create: async ({ data }) => { estado.escrituras.push({ producto: data }); return { id: 'producto-1', ...data }; },
        update: async ({ data }) => { estado.escrituras.push({ producto: data }); return { id: 'producto-1', ...data }; },
    },
    categoria: { findUnique: registrar('categoria.findUnique', { id: '11111111-1111-4111-8111-111111111111' }) },
    $transaction: async fn => fn(prisma),
};
const { app, token } = crearHarness(prisma);
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
function llamar(ruta, id, method = 'GET', body, rawToken) {
    return fetch(base + ruta, { method, headers: { ...(id || rawToken ? { Authorization: `Bearer ${rawToken ?? token(id)}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const rutas = [['/inicio/resumen', 'GET'], ['/inventario', 'GET'], ['/inventario/stock-1', 'PATCH'], ['/movimientos_inventario', 'GET']];
test('Inicio, inventario y movimientos exigen JWT válido antes de ejecutar consultas o escrituras', async () => {
    for (const [ruta, method] of rutas) {
        const antes = estado.consultas.length;
        assert.equal((await llamar(ruta, null, method, method === 'PATCH' ? { existencia: 20 } : undefined)).status, 401, ruta);
        assert.equal((await llamar(ruta, null, method, method === 'PATCH' ? { existencia: 20 } : undefined, 'invalido')).status, 401, ruta);
        assert.equal((await llamar(ruta, 'inactivo', method, method === 'PATCH' ? { existencia: 20 } : undefined)).status, 401, ruta);
        assert.equal((await llamar(ruta, null, method, method === 'PATCH' ? { existencia: 20 } : undefined, token('admin', { expiresIn: -1 }))).status, 401, ruta);
        assert.equal(estado.consultas.length, antes);
    }
    assert.equal(estado.escrituras.length, 0);
});
test('EMPLEADO no consulta finanzas de Inicio ni existencias/movimientos y no ajusta inventario', async () => {
    for (const [ruta, method] of rutas) {
        const antes = estado.consultas.length;
        assert.equal((await llamar(ruta, 'empleado', method, method === 'PATCH' ? { existencia: 20, idUsuario: 'admin' } : undefined)).status, 403, ruta);
        assert.equal(estado.consultas.length, antes);
    }
    assert.equal(estado.escrituras.length, 0);
});
test('ADMINISTRADOR conserva el resumen dinámico y sus criterios de pedidos, citas y cobros', async () => {
    const res = await llamar('/inicio/resumen', 'admin');
    assert.equal(res.status, 200);
    const datos = await res.json();
    assert.equal(datos.solicitudesNuevas, 3);
    assert.equal(datos.pedidosPendientes, 2);
    assert.equal(datos.citasHoy, 1);
    assert.equal(datos.cobradoMes, 1234.5);
    assert.equal(datos.pedidos[0].cliente, 'Cliente Simulado');
    assert.equal(datos.citas[0].responsable, 'Responsable Simulado');
    const query = estado.consultas.find(c => c.nombre === 'pedido.findMany').query;
    assert.equal(query.take, 5);
    assert.deepEqual(query.where.estado.in, ['EN_PROCESO', 'LISTO_PARA_INSTALAR']);
    assert.deepEqual(estado.consultas.find(c => c.nombre === 'pago.aggregate').query.where.pedido, { estado: { not: 'CANCELADO' } });
});
test('ADMINISTRADOR consulta inventario y conserva campos de las nuevas interfaces', async () => {
    const res = await llamar('/inventario', 'admin');
    assert.equal(res.status, 200);
    const [item] = await res.json();
    assert.equal(item.producto.categoria.nombre, 'Categoría');
    assert.equal(item.existencia, 10);
    assert.equal(item.minimo, 2);
});
test('ajuste y movimiento de inventario registran al administrador del JWT aunque el cuerpo suplante otro usuario', async () => {
    let res = await llamar('/inventario/stock-1', 'admin', 'PATCH', { existencia: 15, minimo: 3, motivo: 'Prueba aislada', idUsuario: 'empleado' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).inventario.existencia, 15);
    assert.deepEqual(estado.movimientos.at(-1), { id: 'movimiento-1', idInventario: 'stock-1', idUsuario: 'admin', tipo: 'ENTRADA', cantidad: 5, motivo: 'Prueba aislada' });
    res = await llamar('/inventario/stock-1', 'admin', 'PATCH', { existencia: 12, motivo: 'Salida simulada' });
    assert.equal(res.status, 200);
    assert.equal(estado.movimientos.at(-1).tipo, 'SALIDA');
    assert.equal(estado.movimientos.at(-1).cantidad, 3);
    const count = estado.movimientos.length;
    assert.equal((await llamar('/inventario/stock-1', 'admin', 'PATCH', { minimo: 4 })).status, 200);
    assert.equal(estado.movimientos.length, count);
    res = await llamar('/movimientos_inventario', 'admin');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).length, count);
});
test('cantidades inválidas no escriben inventario ni movimientos', async () => {
    const antes = estado.escrituras.length;
    for (const body of [{ existencia: -1 }, { existencia: 1.5 }, { minimo: -1 }, {}]) assert.equal((await llamar('/inventario/stock-1', 'admin', 'PATCH', body)).status, 400);
    assert.equal(estado.escrituras.length, antes);
});
test('catálogo mantiene creación automática de inventario y cambios de activo, URL y descripción del equipo', async () => {
    const res = await llamar('/productos', 'admin', 'POST', { nombre: 'Producto de prueba', tipo: 'MATERIAL', descripcion: 'Producto simulado', precioDesde: 20, imagenUrl: null, idcategoria: '11111111-1111-4111-8111-111111111111' });
    assert.equal(res.status, 201);
    assert.deepEqual(estado.escrituras.at(-1).producto.inventario, { create: { existencia: 0, minimo: 1 } });
    const patch = await llamar('/productos/producto-1', 'admin', 'PATCH', { activo: false, imagenUrl: null, descripcion: 'd'.repeat(300) });
    assert.equal(patch.status, 200);
    assert.equal(estado.escrituras.at(-1).producto.activo, false);
    assert.equal(estado.escrituras.at(-1).producto.imagenUrl, null);
    assert.equal(estado.escrituras.at(-1).producto.descripcion.length, 300);
});
