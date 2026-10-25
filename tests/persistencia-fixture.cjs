const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
apiRequire('tsx/cjs');
function validarLocal(value) {
    const u = new URL(value);
    if (u.hostname !== '127.0.0.1' || !/^gaona_(?:web_pruebas|local_admin)$/.test(u.username) || u.pathname !== '/gaona_persistencia_aislada' || !u.port || u.port === '5432') throw Error('Se requiere PostgreSQL local aislado explícito');
    return value;
}
const env = { NODE_ENV: 'development', SOLICITUD_STORAGE: 'postgres', SOLICITUD_IDEMPOTENCY_KEY: 'c'.repeat(64), SOLICITUD_PDF_KEY: 'e'.repeat(64),
    MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'usuario-simulado', SMTP_PASSWORD: 'clave-simulada', SMTP_FROM: 'gaona@example.test', WHATSAPP_ENABLED: 'false', WHATSAPP_IDEMPOTENCY_KEY: 'a'.repeat(64) };
const legadoKey = 'clave-legada-simulada-001';
const legadoDatos = { cliente: { nombre: 'Prueba', apellido: 'Migración simulada', telefono: '+15555550101' }, whatsappConsentimiento: true,
    descripcion: 'PRUEBA LOCAL ANTERIOR A MIGRACIÓN', productos: [{ idProducto: 'producto-legado', cantidad: 1, medidasAprox: '100 x 100 cm' }] };
async function seedLegado(db) {
    await db.categoria.create({ data: { id: 'categoria-legada', nombre: 'PRUEBA LOCAL legada' } });
    await db.producto.create({ data: { id: 'producto-legado', idCategoria: 'categoria-legada', nombre: 'Producto simulado legado', precioDesde: '1.00' } });
    const { createHmac } = require('node:crypto');
    const h = value => createHmac('sha256', Buffer.from(env.WHATSAPP_IDEMPOTENCY_KEY, 'hex')).update(value).digest('hex');
    const store = apiRequire('./src/solicitud-whatsapp-almacen').crearAlmacenWhatsapp(db);
    const record = await store.registrar(h(legadoKey), h(JSON.stringify(legadoDatos)), true, legadoDatos.cliente.telefono,
        tx => apiRequire('./src/solicitud-registro').registrarSolicitud(tx, legadoDatos));
    const job = await store.reclamar(record.comprobante.id);
    const pdf = await apiRequire('./src/solicitud-pdf').generarSolicitudPdf(record.comprobante);
    await store.guardarPdf(job.id, pdf); await store.iniciarEnvio(job.id, 'media-simulada');
    await store.finalizar(job.id, 'aceptado', 'wamid.migracion-simulada');
}
module.exports = { apiRequire, validarLocal, env, seedLegado, legadoDatos, legadoKey };
