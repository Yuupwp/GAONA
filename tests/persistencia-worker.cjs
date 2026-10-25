const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { apiRequire, validarLocal, env } = require('./persistencia-fixture.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const { crearPersistenciaSolicitudes } = apiRequire('./src/solicitud-persistencia');
const { registrarSolicitud } = apiRequire('./src/solicitud-registro');
const { crearServicioCorreo } = apiRequire('./src/solicitud-correo');
const { generarSolicitudPdf } = apiRequire('./src/solicitud-pdf');
(async () => {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const db = new PrismaClient({ datasources: { db: { url: validarLocal(process.env.GAONA_PERSIST_TEST_DATABASE_URL) } }, log: [] });
    const persist = crearPersistenciaSolicitudes(db, env, async data => {
        if (input.modo === 'caida_pdf') process.exit(75);
        return generarSolicitudPdf(data);
    });
    let calls = 0;
    try {
        const result = await persist.registrar(input.clave, input.datos, tx => registrarSolicitud(tx, input.datos), `worker-simulado-${input.datos.cliente.correo}`);
        if (input.modo === 'caida_registro') process.exit(71);
        if (input.modo === 'caida_previa') { await persist.correo.reclamar(result.comprobante.id); process.exit(72); }
        if (input.modo === 'caida_pdf') await persist.documento(result.comprobante);
        if (input.modo === 'recuperar') {
            const pdf = await persist.documento(result.comprobante);
            console.log(JSON.stringify({ id: result.comprobante.id, repetido: result.repetido, estado: await persist.correo.estado(result.comprobante.id), sha: createHash('sha256').update(pdf).digest('hex'), calls }));
            return;
        }
        const store = input.modo === 'caida_posterior' ? { ...persist.correo, finalizar: async () => { process.exit(74); } } : persist.correo;
        const send = crearServicioCorreo(env, () => ({
            async sendMail(message) { calls++; if (input.modo === 'caida_durante') process.exit(73); return { accepted: [message.to.address], messageId: message.messageId, response: '250 Aceptado simulado' }; },
            close() {}
        }), Date.now, 100, store);
        const sent = await send(result.comprobante, 'ip-simulada', () => persist.documento(result.comprobante));
        console.log(JSON.stringify({ id: result.comprobante.id, repetido: result.repetido, estado: sent.estado, calls }));
    } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.code ?? 'ERROR_LOCAL'); process.exitCode = 1; });
