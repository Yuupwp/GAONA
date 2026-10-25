const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apiRequire } = require('./pdf-harness.cjs');
const { cargarEntornoWeb } = apiRequire('./src/configurar-entorno-web');
const { configurarSmtp, crearServicioCorreo } = apiRequire('./src/solicitud-correo');
const brevo = { SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-smtp-simulado', SMTP_PASSWORD: 'clave-smtp-simulada', SMTP_FROM: 'remitente@example.test' };
const heredado = { ...brevo, SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'anterior@example.test', SMTP_PASSWORD: 'anterior-simulada' };
function cargar(archivo, destino) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaona-correo-env-'));
    try {
        const ruta = path.join(directory, '.env');
        if (archivo !== null) fs.writeFileSync(ruta, Object.entries(archivo).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
        cargarEntornoWeb(destino, ruta);
        return destino;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('Configuración de correo: secretos inyectados prevalecen, conservan claves estables y nunca habilitan envíos', () => {
    const injected = { ...brevo, WEB_DATABASE_URL: 'postgresql://inyectada.invalid', SOLICITUD_PDF_KEY: 'estable-simulada', MAIL_ENABLED: 'true', WHATSAPP_ENABLED: 'true' };
    const result = cargar({ ...heredado, WEB_DATABASE_URL: 'postgresql://anterior.invalid', SOLICITUD_PDF_KEY: 'anterior', MAIL_ENABLED: 'true' }, injected);
    for (const [key, value] of Object.entries(brevo)) assert.equal(result[key], value);
    assert.equal(result.WEB_DATABASE_URL, 'postgresql://inyectada.invalid');
    assert.equal(result.SOLICITUD_PDF_KEY, 'estable-simulada');
    assert.equal(result.MAIL_ENABLED, 'false'); assert.equal(result.WHATSAPP_ENABLED, 'false');
    assert.equal(configurarSmtp(result), null);
});

test('Configuración de correo: Brevo parcial no toma credenciales Gmail del archivo ni completa campos ausentes', () => {
    for (const key of Object.keys(brevo)) {
        const injected = { ...brevo }; delete injected[key];
        assert.throws(() => cargar(heredado, injected), { message: 'Configuración SMTP web incompleta o inválida' });
        assert.equal(injected.SMTP_PASSWORD, key === 'SMTP_PASSWORD' ? undefined : brevo.SMTP_PASSWORD);
    }
    assert.throws(() => cargar(heredado, { SMTP_HOST: '' }), /Configuración SMTP web incompleta o inválida/);
});

test('Configuración de correo: archivo completo compatible cuando no hay SMTP inyectado y sin habilitar transporte', () => {
    const result = cargar({ ...brevo, MAIL_ENABLED: 'true' }, {});
    for (const [key, value] of Object.entries(brevo)) assert.equal(result[key], value);
    assert.equal(result.MAIL_ENABLED, 'false');
});

test('Configuración de correo: alojamiento sin .env acepta secretos completos y arranque sin SMTP conserva correo desactivado', () => {
    assert.equal(cargar(null, { ...brevo }).SMTP_HOST, brevo.SMTP_HOST);
    assert.deepEqual(cargar(null, {}), { MAIL_ENABLED: 'false', WHATSAPP_ENABLED: 'false' });
    assert.throws(() => cargar(brevo, { SMTP_PASSWORD: '' }), /Configuración SMTP web incompleta o inválida/);
});

test('Configuración de correo: configuración inválida rechazada con error genérico sin exponer secretos', () => {
    for (const invalid of [{ SMTP_SECURE: 'otro' }, { SMTP_PORT: '465' }, { SMTP_HOST: 'smtp.test/privado' },
        { SMTP_FROM: 'uno@example.test,dos@example.test' }, { SMTP_FROM: 'uno@example.test\r\nBcc: dos@example.test' },
        { SMTP_USER: 'usuario\r\nBcc: dos@example.test' }, { SMTP_PASSWORD: '' }]) {
        assert.throws(() => cargar(null, { ...brevo, ...invalid }), { message: 'Configuración SMTP web incompleta o inválida' });
    }
});

test('Configuración de correo: configuración Brevo exige STARTTLS y certificados válidos sin abrir conexiones', async () => {
    const prepared = cargar(null, { ...brevo });
    const simulation = { ...prepared, MAIL_ENABLED: 'true' };
    const { opciones } = configurarSmtp(simulation);
    assert.equal(opciones.host, 'smtp-relay.brevo.com'); assert.equal(opciones.port, 587);
    assert.equal(opciones.secure, false); assert.equal(opciones.requireTLS, true);
    assert.deepEqual(opciones.tls, { rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    assert.equal(opciones.logger, false); assert.equal(opciones.debug, false);
    let calls = 0;
    const service = crearServicioCorreo({ ...simulation, NODE_ENV: 'production' }, () => { calls++; throw Error('No debe abrir transporte'); });
    const result = await service({ id: 'folio-simulado', cliente: { correo: 'cliente@example.test' } }, '127.0.0.1', () => { throw Error('No debe generar adjunto'); });
    assert.equal(result.estado, 'no_disponible'); assert.equal(calls, 0);
});
