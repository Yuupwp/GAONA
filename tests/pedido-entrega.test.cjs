// Pedido con fecha de entrega: crea la cita en la Agenda y avisa al cliente.
// Base de datos simulada en memoria y transporte de correo falso: no toca nada real.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { crearHarness, apiRequire } = require('./escritorio-harness.cjs');

const usuarios = new Map(['admin', 'otro'].map(id => [id, {
    id, nombre: 'Prueba', apellido: id, usuario: id, correo: `${id}@example.invalid`, activo: true,
    rol: { nombre: 'ADMINISTRADOR' }, permisos: [], creadoEn: new Date(), telefono: null,
}]));

let db;
function reiniciar() {
    db = {
        cotizaciones: new Map([
            ['cot-1', { id: 'cot-1', estado: 'APROBADA', total: 1160, pedido: null, solicitud: { idCliente: 'cli-1', cliente: { nombre: 'Ana María', apellido: 'López', correo: 'ana@example.invalid', direccion: 'Calle 1' } } }],
            ['cot-2', { id: 'cot-2', estado: 'APROBADA', total: 500, pedido: null, solicitud: { idCliente: 'cli-2', cliente: { nombre: 'Beto', apellido: 'Sin Correo', correo: null, direccion: null } } }],
            ['cot-borrador', { id: 'cot-borrador', estado: 'BORRADOR', total: 1, pedido: null, solicitud: { idCliente: 'cli-1', cliente: { nombre: 'Ana', apellido: 'L', correo: null, direccion: null } } }],
        ]),
        pedidos: [], citas: [], historial: [],
    };
}

// Cada transacción trabaja sobre una copia: si truena, no queda nada guardado
function copia(x) { return { cotizaciones: new Map([...x.cotizaciones].map(([k, v]) => [k, { ...v }])), pedidos: [...x.pedidos], citas: x.citas.map(c => ({ ...c })), historial: [...x.historial] }; }

function crearPrisma(obtener) {
    const activa = c => ['PROGRAMADA', 'REPROGRAMADA'].includes(c.estado);
    return {
        usuario: {
            findUnique: async ({ where }) => usuarios.get(where.id) ?? null,
            findFirst: async ({ where }) => usuarios.get(where.id) ?? null,
        },
        cotizacion: { findUnique: async ({ where }) => obtener().cotizaciones.get(where.id) ?? null },
        pedido: {
            create: async ({ data }) => {
                const p = { id: `ped-${obtener().pedidos.length + 1}`, idCliente: data.idCliente, estado: data.estado };
                obtener().pedidos.push(p);
                return { id: p.id };
            },
            findUnique: async ({ where }) => {
                const p = obtener().pedidos.find(x => x.id === where.id);
                if (!p) return null;
                const citas = obtener().citas.filter(c => c.idPedido === p.id && activa(c)).sort((a, b) => a.inicio - b.inicio).slice(0, 1)
                    .map(c => ({ ...c, usuario: { nombre: 'Prueba', apellido: c.idUsuario } }));
                const cot = [...obtener().cotizaciones.values()].find(c => c.solicitud.idCliente === p.idCliente);
                return { id: p.id, estado: p.estado, cliente: cot.solicitud.cliente, citas };
            },
            updateMany: async ({ where, data }) => {
                const p = obtener().pedidos.find(x => x.id === where.id && x.estado === where.estado);
                if (!p) return { count: 0 };
                Object.assign(p, data);
                return { count: 1 };
            },
        },
        cita: {
            findFirst: async ({ where }) => obtener().citas.find(c => c.idUsuario === where.idUsuario && activa(c) && c.inicio < where.inicio.lt && c.fin > where.fin.gt && c.id !== where.id?.not) ?? null,
            create: async ({ data }) => { obtener().citas.push({ id: `cita-${obtener().citas.length + 1}`, ...data }); return {}; },
            updateMany: async ({ where, data }) => {
                let count = 0;
                for (const c of obtener().citas) {
                    const coincide = where.id ? c.id === where.id && c.estado === where.estado : c.idPedido === where.idPedido && activa(c);
                    if (coincide) { Object.assign(c, data); count++; }
                }
                return { count };
            },
            findUnique: async ({ where }) => obtener().citas.find(c => c.id === where.id) ?? null,
            findUniqueOrThrow: async ({ where }) => {
                const c = obtener().citas.find(x => x.id === where.id);
                const p = obtener().pedidos.find(x => x.id === c.idPedido);
                const cot = [...obtener().cotizaciones.values()].find(x => x.solicitud.idCliente === p.idCliente);
                return { ...c, notas: c.notas ?? null, usuario: { nombre: 'Prueba', apellido: c.idUsuario }, solicitud: null,
                    pedido: { id: p.id, cliente: { ...cot.solicitud.cliente, telefono: '8100000000' } } };
            },
        },
        historialPedido: { create: async ({ data }) => { obtener().historial.push(data); return {}; } },
        $transaction: async fn => {
            const borrador = copia(db);
            const original = db;
            db = borrador;
            try { const r = await fn(prisma); return r; }
            catch (e) { db = original; throw e; }
        },
    };
}

const prisma = crearPrisma(() => db);
const { app, token } = crearHarness(prisma);
const { opcionesAviso } = apiRequire('./src/pedido-correo.ts');
let enviados = [];
opcionesAviso.fabrica = () => ({ sendMail: async m => { enviados.push(m); return { accepted: [m.to] }; }, close() {} });

let servidor, base;
before(async () => { servidor = app.listen(0, '127.0.0.1'); await new Promise(r => servidor.once('listening', r)); base = `http://127.0.0.1:${servidor.address().port}`; });
after(async () => { servidor.closeAllConnections(); await new Promise(r => servidor.close(r)); });
beforeEach(() => { reiniciar(); enviados = []; });

async function llamar(ruta, method, body) {
    const r = await fetch(base + ruta, { method, headers: { Authorization: `Bearer ${token('admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
}

// Mañana, para que nunca sea fecha pasada
function manana() { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const entrega = () => ({ tipo: 'INSTALACION', idResponsable: 'admin', fecha: manana(), horaInicio: '10:00', horaFin: '12:00' });

test('crear pedido exige fecha de entrega válida y no guarda nada si falta', async () => {
    assert.equal((await llamar('/cotizaciones/cot-1/pedido', 'POST', {})).status, 400);
    assert.equal((await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: { ...entrega(), fecha: '2020-01-01' } })).status, 400);
    assert.equal((await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: { ...entrega(), horaFin: '09:00' } })).status, 400);
    assert.equal((await llamar('/cotizaciones/cot-borrador/pedido', 'POST', { entrega: entrega() })).status, 409);
    assert.equal(db.pedidos.length, 0);
    assert.equal(db.citas.length, 0);
});

test('crear pedido agenda la instalación con la dirección del cliente y le avisa por correo', async () => {
    const r = await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: entrega(), avisarCliente: true });
    assert.equal(r.status, 201);
    assert.equal(r.body.correo, 'enviado');
    assert.equal(db.pedidos.length, 1);
    assert.equal(db.citas.length, 1);
    const cita = db.citas[0];
    assert.equal(cita.tipo, 'INSTALACION');
    assert.equal(cita.idPedido, db.pedidos[0].id);
    assert.equal(cita.idUsuario, 'admin');
    assert.equal(cita.direccion, 'Calle 1');
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, 'ana@example.invalid');
    assert.match(enviados[0].subject, /está confirmado/);
    assert.match(enviados[0].text, /Hola, Ana:/);
    assert.match(enviados[0].text, /La instalación está programada/);
});

test('sin pedir aviso o sin correo del cliente no se manda nada', async () => {
    const a = await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: entrega() });
    assert.equal(a.body.correo, 'no_solicitado');
    const b = await llamar('/cotizaciones/cot-2/pedido', 'POST', { entrega: { ...entrega(), horaInicio: '13:00', horaFin: '14:00' }, avisarCliente: true });
    assert.equal(b.status, 201);
    assert.equal(b.body.correo, 'sin_correo');
    assert.equal(enviados.length, 0);
});

test('una entrega encimada con el mismo responsable no deja pedido a medias', async () => {
    assert.equal((await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: entrega() })).status, 201);
    const r = await llamar('/cotizaciones/cot-2/pedido', 'POST', { entrega: { ...entrega(), horaInicio: '11:00', horaFin: '13:00' } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /ya tiene una cita/);
    assert.equal(db.pedidos.length, 1);
    assert.equal(db.citas.length, 1);
    // Pegada (de 12 a 13) u otro responsable a la misma hora: sí se permite
    assert.equal((await llamar('/cotizaciones/cot-2/pedido', 'POST', { entrega: { ...entrega(), horaInicio: '12:00', horaFin: '13:00' } })).status, 201);
});

test('cambiar el estado avisa al cliente y cancelar el pedido libera su entrega', async () => {
    await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: entrega() });
    const id = db.pedidos[0].id;
    const listo = await llamar(`/pedidos/${id}/estado`, 'PATCH', { estado: 'LISTO_PARA_INSTALAR', avisarCliente: true });
    assert.equal(listo.status, 200);
    assert.equal(listo.body.correo, 'enviado');
    assert.match(enviados.at(-1).subject, /listo/);
    assert.match(enviados.at(-1).text, /La instalación está programada/);
    const cancelado = await llamar(`/pedidos/${id}/estado`, 'PATCH', { estado: 'CANCELADO' });
    assert.equal(cancelado.status, 200);
    assert.equal(cancelado.body.correo, 'no_solicitado');
    assert.equal(db.citas[0].estado, 'CANCELADA');
    assert.equal(enviados.length, 1);
});

test('reprogramar la entrega en la Agenda le manda la nueva fecha al cliente', async () => {
    await llamar('/cotizaciones/cot-1/pedido', 'POST', { entrega: entrega() });
    const r = await llamar(`/citas/${db.citas[0].id}`, 'PATCH', { accion: 'reprogramar', fecha: manana(), horaInicio: '16:00', horaFin: '18:00', avisarCliente: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.correo, 'enviado');
    assert.equal(db.citas[0].estado, 'REPROGRAMADA');
    assert.match(enviados.at(-1).subject, /Nueva fecha/);
    assert.match(enviados.at(-1).text, /4:00/);
    // Sin la casilla marcada no se avisa
    const sin = await llamar(`/citas/${db.citas[0].id}`, 'PATCH', { accion: 'reprogramar', fecha: manana(), horaInicio: '17:00', horaFin: '18:00' });
    assert.equal(sin.body.correo, 'no_solicitado');
    assert.equal(enviados.length, 1);
});
