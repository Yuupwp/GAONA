const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearHarness, apiRequire } = require('./escritorio-harness.cjs');
const bcrypt = apiRequire('bcryptjs');
const usuarios = new Map(['admin', 'empleado', 'inactivo', 'otro', 'desconocido'].map(id => [id, {
    id, nombre: 'Prueba', apellido: 'Aislada', usuario: id, correo: `${id}@example.invalid`,
    activo: id !== 'inactivo', rol: { nombre: id === 'admin' ? 'ADMINISTRADOR' : id === 'desconocido' ? 'OTRO' : 'EMPLEADO' },
    permisos: [], creadoEn: new Date(), telefono: null,
}]));
const registro = { operaciones: 0, autores: [], cambios: [] };
const cotizacion = {
    id: 'cotizacion-1', estado: 'BORRADOR', subtotal: 100, iva: 16, total: 116,
    anticipoRequerido: null, vigenciaHasta: null, fechaAprobacion: null, creadoEn: new Date(),
    usuario: { nombre: 'Prueba', apellido: 'Aislada' }, detalles: [], pedido: null,
    solicitud: { id: 'solicitud-1', origen: 'ESCRITORIO', descripcion: '', cliente: {
        id: 'cliente-1', nombre: 'Cliente', apellido: 'Simulado', telefono: '5555555555', correo: null, direccion: null,
    } },
};
const prisma = {
    usuario: {
        findUnique: async ({ where }) => usuarios.get(where.id) ?? null,
        findFirst: async ({ where }) => { assert.ok(where.id, 'Nunca seleccionar un administrador de respaldo'); return usuarios.get(where.id); },
        findMany: async () => { registro.operaciones++; return []; },
        update: async ({ where, data }) => { registro.cambios.push({ where, data }); return { ...usuarios.get(where.id), ...data }; },
    },
    producto: { findMany: async () => { registro.operaciones++; return []; } },
    cliente: { findUnique: async () => ({ id: 'cliente-1' }), findMany: async () => [] },
    cita: { findMany: async () => [] },
    solicitud: { create: async ({ data }) => { registro.autores.push(data.idUsuarioAsignado); return { id: 'solicitud-1' }; }, update: async () => ({}) },
    cotizacion: { updateMany: async () => ({ count: 0 }), findMany: async () => [], findUnique: async () => cotizacion,
        create: async ({ data }) => { registro.autores.push(data.idUsuario); return cotizacion; } },
    pedido: { findUnique: async () => ({ id: 'pedido-1', estado: 'EN_PROCESO', total: 200, pagos: [] }), updateMany: async () => ({ count: 1 }) },
    pago: { create: async ({ data }) => { registro.autores.push(data.idUsuario); return { id: 'pago-1' }; } },
    historialPedido: { create: async ({ data }) => { registro.autores.push(data.idUsuario); return {}; } },
    $transaction: async fn => fn(prisma),
};
const { app, token } = crearHarness(prisma);
let servidor, base;
before(async () => { servidor = app.listen(0, '127.0.0.1'); await new Promise(r => servidor.once('listening', r)); base = `http://127.0.0.1:${servidor.address().port}`; });
after(async () => { servidor.closeAllConnections(); await new Promise(r => servidor.close(r)); });
function llamar(ruta, id, method = 'GET', body, rawToken) {
    return fetch(base + ruta, { method, headers: { ...(id || rawToken ? { Authorization: `Bearer ${rawToken ?? token(id)}` } : {}), 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
test('sin token: todas las rutas de escritorio y rutas nuevas responden 401', async () => {
    for (const ruta of ['/clientes', '/empleados', '/productos', '/finanzas/resumen', '/pedidos', '/cotizaciones', '/citas', '/cuenta/empleado', '/solicitudes', '/ruta-nueva']) {
        const antes = registro.operaciones;
        assert.equal((await llamar(ruta)).status, 401, ruta);
        assert.equal(registro.operaciones, antes);
    }
    assert.equal((await llamar('/salud')).status, 200);
    assert.equal((await llamar('/auth/login', null, 'POST', {})).status, 400);
    assert.equal((await llamar('/auth/restablecer-contrasena', null, 'POST', {})).status, 400);
    assert.equal((await llamar('/auth/futura', null, 'POST', {})).status, 401);
});
test('JWT inválido, expirado, algoritmo no permitido, cuenta ausente o desactivada: 401', async () => {
    const jwt = apiRequire('jsonwebtoken');
    for (const valor of ['invalido', token('empleado', { expiresIn: -1 }), jwt.sign({ id: 'empleado' }, 'otro-secreto'), token('inactivo'), token('no-existe'), token('empleado', { algorithm: 'HS384' })]) {
        assert.equal((await llamar('/productos', null, 'GET', undefined, valor)).status, 401);
    }
});
test('rol real de la base prevalece sobre el rol declarado en JWT', async () => {
    for (const [ruta, method] of [['/clientes', 'GET'], ['/empleados', 'GET'], ['/empleados', 'POST'], ['/empleados/otro', 'PATCH'], ['/empleados/otro/rol', 'PATCH'], ['/empleados/otro/estado', 'PATCH'], ['/empleados/otro/restablecer-contrasena', 'POST'], ['/finanzas/pagos', 'POST'], ['/pedidos', 'GET'], ['/productos', 'POST'], ['/productos/x', 'PATCH'], ['/cotizaciones/x/pedido', 'POST'], ['/solicitudes', 'POST'], ['/ruta-nueva', 'GET']]) {
        const antes = registro.operaciones;
        assert.equal((await llamar(ruta, 'empleado', method, method === 'GET' ? undefined : { idRol: 'ADMINISTRADOR' })).status, 403, `${method} ${ruta}`);
        assert.equal(registro.operaciones, antes);
    }
    assert.equal((await llamar('/productos', 'desconocido')).status, 403);
});
test('administrador autorizado y empleado en cotizaciones, agenda, catálogo y cuenta propia', async () => {
    assert.equal((await llamar('/empleados', 'admin')).status, 200);
    for (const ruta of ['/productos', '/cotizaciones', '/cotizaciones/opciones', '/citas?desde=2026-11-01&hasta=2026-11-30', '/cuenta/empleado']) {
        assert.equal((await llamar(ruta, 'empleado')).status, 200, ruta);
    }
});
test('cuenta ajena y campos de privilegios denegados antes de leer o escribir', async () => {
    for (const id of ['empleado', 'admin']) {
        for (const [ruta, method] of [['/cuenta/otro', 'GET'], ['/cuenta/otro', 'PATCH'], ['/cuenta/otro/contrasena', 'PATCH']]) {
            assert.equal((await llamar(ruta, id, method, method === 'PATCH' ? {} : undefined)).status, 403);
        }
    }
    for (const campo of ['rol', 'idRol', 'activo', 'passwordHash']) {
        assert.equal((await llamar('/cuenta/empleado', 'empleado', 'PATCH', { [campo]: 'ADMINISTRADOR' })).status, 403);
    }
    assert.equal(registro.cambios.length, 0);
    const res = await llamar('/cuenta/empleado', 'empleado', 'PATCH', { nombre: 'Nuevo', apellido: 'Apellido', usuario: 'empleado', correo: 'empleado@example.invalid', telefono: '' });
    assert.equal(res.status, 200);
    assert.equal(registro.cambios.at(-1).where.id, 'empleado');
});
test('cotización y auditoría de pedido usan JWT aunque Electron envíe otro idUsuario', async () => {
    registro.autores.length = 0;
    assert.equal((await llamar('/cotizaciones', 'empleado', 'POST', { idCliente: 'cliente-1', idUsuario: 'admin', conceptos: [{ nombre: 'Concepto', cantidad: 1, precio: 100 }] })).status, 201);
    assert.deepEqual(registro.autores, ['empleado', 'empleado']);
    assert.equal((await llamar('/pedidos/pedido-1/estado', 'admin', 'PATCH', { estado: 'LISTO_PARA_INSTALAR', idUsuario: 'otro' })).status, 200);
    assert.equal(registro.autores.at(-1), 'admin');
});
test('PDF protegido: Bearer requerido, sin tokens por URL y respuesta no almacenable', async () => {
    assert.equal((await llamar(`/cotizaciones/cotizacion-1/pdf?token=${token('empleado')}`)).status, 401);
    const res = await llamar('/cotizaciones/cotizacion-1/pdf', 'empleado');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
test('login de cuenta inactiva devuelve 401 sin emitir token', async () => {
    const original = prisma.usuario.findFirst;
    const passwordHash = await bcrypt.hash('clave-de-prueba', 4);
    prisma.usuario.findFirst = async () => ({ ...usuarios.get('inactivo'), passwordHash });
    try {
        const res = await llamar('/auth/login', null, 'POST', { usuario: 'inactivo', contrasena: 'clave-de-prueba' });
        assert.equal(res.status, 401);
        assert.equal((await res.json()).token, undefined);
    } finally { prisma.usuario.findFirst = original; }
});

test('finanzas registra el pago con la identidad del administrador autenticado', async () => {
    const res = await llamar('/finanzas/pagos', 'admin', 'POST', { idPedido: 'pedido-1', tipo: 'ANTICIPO', metodo: 'EFECTIVO', monto: 50, idUsuario: 'otro' });
    assert.equal(res.status, 201);
    assert.equal(registro.autores.at(-1), 'admin');
});
test('sesiones existentes reflejan desactivación y cambio de rol en el servidor', async () => {
    const jwt = token('admin');
    const usuario = usuarios.get('admin');
    try {
        usuario.rol = { nombre: 'EMPLEADO' };
        assert.equal((await llamar('/empleados', null, 'GET', undefined, jwt)).status, 403);
        usuario.activo = false;
        assert.equal((await llamar('/productos', null, 'GET', undefined, jwt)).status, 401);
    } finally { usuario.activo = true; usuario.rol = { nombre: 'ADMINISTRADOR' }; }
});
