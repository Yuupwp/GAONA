const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { apiRequire, valid, fixture } = require('./pdf-harness.cjs');
const { crearAlmacenWhatsapp } = apiRequire('./src/solicitud-whatsapp-almacen');
const { calcularEstimado } = apiRequire('./src/solicitud-estimado');
const { generarSolicitudPdf } = apiRequire('./src/solicitud-pdf');
const testUrl = process.env.GAONA_WHATSAPP_TEST_DATABASE_URL;
if (testUrl) {
    const url = new URL(testUrl);
    if (url.hostname !== '127.0.0.1' || !/^\/gaona_whatsapp_aislada(?:_final)?$/.test(url.pathname) || !url.port || url.port === '5432') throw Error('Solo PostgreSQL aislado explícito en loopback y puerto alternativo');
}
test('PostgreSQL aislado: atomicidad, concurrencia, nuevo proceso, PDF persistente, consentimiento y eventos', { skip: !testUrl }, async () => {
    const { PrismaClient } = apiRequire('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: testUrl } }, log: [] });
    const store = crearAlmacenWhatsapp(db);
    let creates = 0;
    const id = randomUUID();
    const recipient = "+1999" + id.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
    const key = createHash('sha256').update(id).digest('hex');
    const fingerprint = createHash('sha256').update('payload-simulado').digest('hex');
    const receipt = { id, fecha: new Date().toISOString(), cliente: { ...valid.cliente, telefono: recipient }, estimado: calcularEstimado(valid.productos, fixture) };
    const create = async tx => { creates++; await tx.$executeRaw`INSERT INTO public.solicitudes (id) VALUES (${id})`; return receipt; };
    try {
        assert.equal(await store.disponible(), true);
        const registrations = await Promise.all(Array.from({ length: 8 }, () => store.registrar(key, fingerprint, true, recipient, create)));
        assert.equal(creates, 1);
        assert.equal(registrations.filter(r => !r.repetido).length, 1);
        assert.ok(registrations.every(r => r.comprobante.id === id));
        await assert.rejects(() => store.registrar(key, '0'.repeat(64), true, recipient, create));
        assert.equal(creates, 1);
        const jobs = await Promise.all(Array.from({ length: 8 }, () => store.reclamar(id)));
        assert.equal(jobs.filter(Boolean).length, 1); const job = jobs.find(Boolean);
        const pdf = await generarSolicitudPdf(receipt);
        await store.guardarPdf(job.id, pdf);
        await assert.rejects(() => store.guardarPdf(job.id, pdf));
        assert.deepEqual(await store.pdf(id), pdf);
        assert.equal(await store.iniciarEnvio(job.id, '333333333333'), true);
        assert.equal(await store.iniciarEnvio(job.id, '333333333333'), false);
        await store.finalizar(job.id, 'no_confirmado');
        const event = { correlacion: job.id, mensaje: 'wamid.' + id, destinatario: recipient, estado: 'entregado', fecha: new Date().toISOString() };
        await store.evento(event); await store.evento(event);
        assert.equal(await store.estado(id), 'entregado');
        await store.evento({ ...event, estado: 'enviado' }); await store.evento({ ...event, estado: 'error' });
        assert.equal(await store.estado(id), 'entregado');
        await store.finalizar(job.id, 'aceptado', event.mensaje);
        assert.equal(await store.estado(id), 'entregado');
        const count = await db.$queryRaw`SELECT count(*) AS total FROM gaona_mensajeria.eventos WHERE envio_id = ${job.id}::uuid AND estado = 'entregado'`;
        assert.equal(Number(count[0].total), 1);
        const childCode = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(path.resolve(__dirname, '../api/package.json'))});r('tsx/cjs');const {PrismaClient}=r('@prisma/client');const {crearAlmacenWhatsapp}=r('./src/solicitud-whatsapp-almacen');(async()=>{const p=new PrismaClient({datasources:{db:{url:process.env.GAONA_WHATSAPP_TEST_DATABASE_URL}},log:[]});try{const a=crearAlmacenWhatsapp(p);const x=await a.registrar(${JSON.stringify(key)},${JSON.stringify(fingerprint)},true,${JSON.stringify(recipient)},async()=>{throw Error('No debe crear en el nuevo proceso')});const pdf=await a.pdf(x.comprobante.id);console.log(JSON.stringify({repetido:x.repetido,estado:await a.estado(x.comprobante.id),sha:require('node:crypto').createHash('sha256').update(pdf).digest('hex'),reclamar:await a.reclamar(x.comprobante.id)}));}finally{await p.$disconnect();}})().catch(()=>{process.exitCode=1;});`;
        const child = spawnSync(process.execPath, ['-e', childCode], { env: { GAONA_WHATSAPP_TEST_DATABASE_URL: testUrl }, encoding: 'utf8', timeout: 15000 });
        assert.equal(child.status, 0, 'El proceso nuevo debe recuperar sin crear');
        assert.deepEqual(JSON.parse(child.stdout), { repetido: true, estado: 'entregado', sha: createHash('sha256').update(pdf).digest('hex'), reclamar: null });
        const noneId = randomUUID();
        await store.registrar(createHash('sha256').update(noneId).digest('hex'), fingerprint, false, null, async tx => {
            await tx.$executeRaw`INSERT INTO public.solicitudes (id) VALUES (${noneId})`; return { ...receipt, id: noneId };
        });
        assert.equal(await store.estado(noneId), 'sin_consentimiento');
        assert.equal(await store.reclamar(noneId), null);
        const evidence = await db.$queryRaw`SELECT consentimiento_version, consentimiento_texto, consentimiento_aceptado_en, destinatario FROM gaona_mensajeria.envios WHERE solicitud_id = ${id}`;
        assert.equal(evidence[0].consentimiento_version, 'gaona-whatsapp-pdf-v1');
        assert.match(evidence[0].consentimiento_texto, /Acepto recibir/);
        assert.ok(evidence[0].consentimiento_aceptado_en instanceof Date);
        assert.equal(evidence[0].destinatario, recipient);
        const rollbackId = randomUUID();
        const rollbackKey = createHash('sha256').update(rollbackId).digest('hex');
        await assert.rejects(() => store.registrar(rollbackKey, fingerprint, true, recipient, async tx => {
            await tx.$executeRaw`INSERT INTO public.solicitudes (id) VALUES (${rollbackId})`;
            throw Error('Fallo simulado antes del commit');
        }));
        const remaining = await db.$queryRaw`SELECT count(*) AS total FROM public.solicitudes WHERE id = ${rollbackId}`;
        const reservations = await db.$queryRaw`SELECT count(*) AS total FROM gaona_mensajeria.registros_web WHERE clave = ${rollbackKey}`;
        assert.equal(Number(remaining[0].total), 0); assert.equal(Number(reservations[0].total), 0);
        const quotaRecipient = recipient.replace('+1999', '+1998');
        const quotaIds = [];
        for (let i = 0; i < 4; i++) {
            const quotaId = randomUUID(); quotaIds.push(quotaId);
            await store.registrar(createHash('sha256').update(quotaId).digest('hex'), fingerprint, true, quotaRecipient, async tx => {
                await tx.$executeRaw`INSERT INTO public.solicitudes (id) VALUES (${quotaId})`;
                return { ...receipt, id: quotaId };
            });
        }
        assert.equal(await store.estado(quotaIds[2]), 'pendiente');
        assert.equal(await store.estado(quotaIds[3]), 'limitado');
        assert.equal(await store.reclamar(quotaIds[3]), null);
        const denied = await db.$queryRaw`SELECT has_schema_privilege('anon','gaona_mensajeria','USAGE') AS publico,
            has_table_privilege('anon','gaona_mensajeria.envios','SELECT') AS lectura`;
        assert.deepEqual(denied[0], { publico: false, lectura: false });
    } finally { await db.$disconnect(); }
});
