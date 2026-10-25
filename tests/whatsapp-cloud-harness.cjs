const { randomUUID } = require('node:crypto');
const whatsappEnv = { WHATSAPP_ENABLED: 'true', WHATSAPP_STORAGE: 'postgres', WHATSAPP_MODE: 'test',
    WHATSAPP_GRAPH_VERSION: 'v26.0', WHATSAPP_ACCESS_TOKEN: 'token-simulado-no-real', WHATSAPP_PHONE_NUMBER_ID: '111111111111',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '222222222222', WHATSAPP_TEMPLATE_NAME: 'gaona_solicitud_pdf', WHATSAPP_TEMPLATE_LANGUAGE: 'es_MX',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verificacion-simulada-no-real', WHATSAPP_APP_SECRET: 'a'.repeat(32), WHATSAPP_IDEMPOTENCY_KEY: 'b'.repeat(64),
    WHATSAPP_TEST_RECIPIENTS: '+15555550101' };
function createStore(prisma) {
    const registros = new Map(), trabajos = new Map(), eventos = new Set();
    return {
        registros, trabajos, eventos, ready: true,
        async disponible() { return this.ready; },
        async registrar(clave, huella, consentimiento, destinatario, crear) {
            if (registros.has(clave)) {
                const entry = registros.get(clave);
                if (entry.huella !== huella) throw Error('Conflicto simulado');
                return { comprobante: await entry.promise, repetido: true };
            }
            const entry = { huella, promise: Promise.resolve().then(() => crear(prisma)).then(comprobante => {
                if (consentimiento) trabajos.set(comprobante.id, { id: randomUUID(), destinatario, estado: 'pendiente' });
                return comprobante;
            }) };
            registros.set(clave, entry);
            return { comprobante: await entry.promise, repetido: false };
        },
        async reclamar(solicitud) {
            const t = trabajos.get(solicitud);
            if (!t || t.estado !== 'pendiente') return null;
            t.estado = 'preparando'; return { id: t.id, destinatario: t.destinatario };
        },
        async guardarPdf(id, pdf) { const t = [...trabajos.values()].find(t => t.id === id); if (t.pdf) throw Error('PDF duplicado'); t.pdf = pdf; },
        async iniciarEnvio(id, media) { const t = [...trabajos.values()].find(t => t.id === id); if (t.estado !== 'preparando') return false; t.media = media; t.estado = 'enviando'; return true; },
        async finalizar(id, estado, mensaje, destinatarioProveedor) { const t = [...trabajos.values()].find(t => t.id === id); if (['preparando', 'enviando', 'no_confirmado'].includes(t.estado)) { t.estado = estado; t.mensaje = mensaje; t.destinatarioProveedor = destinatarioProveedor; } },
        async estado(solicitud) { const t = trabajos.get(solicitud); return !t ? 'sin_consentimiento' : ['preparando', 'enviando'].includes(t.estado) ? 'pendiente' : t.estado; },
        async pdf(solicitud) { return trabajos.get(solicitud)?.pdf ?? null; },
        async evento(e) {
            const t = [...trabajos.values()].find(t => e.correlacion ? t.id === e.correlacion : t.mensaje === e.mensaje);
            if (!t || t.mensaje && t.mensaje !== e.mensaje || (t.destinatarioProveedor ?? t.destinatario) !== e.destinatario && (!e.correlacion || t.mensaje)) return;
            const key = JSON.stringify(e); if (eventos.has(key)) return; eventos.add(key);
            const rank = { enviado: 1, entregado: 2, leido: 3 };
            if ((rank[e.estado] ?? 0) > (rank[t.estado] ?? 0) || e.estado === 'error' && (rank[t.estado] ?? 0) < 2) { t.estado = e.estado; t.mensaje = e.mensaje; t.destinatarioProveedor = e.destinatario; }
        }
    };
}
function createMeta() {
    const state = { calls: [], mode: 'ok' };
    const fetch = async (url, options) => {
        state.calls.push({ url, options });
        if (state.mode === 'connection') throw TypeError('Conexión simulada');
        if (url.endsWith('/media')) return Response.json({ id: '333333333333' });
        if (state.mode === 'rejected') return Response.json({ error: { message: 'Detalle interno simulado' } }, { status: 400 });
        if (state.mode === 'limited') return Response.json({}, { status: 429 });
        if (state.mode === 'ambiguous') throw new DOMException('Tiempo simulado', 'TimeoutError');
        if (state.mode === 'server') return Response.json({}, { status: 503 });
        return Response.json({ messages: [{ id: 'wamid.simulado1' }], ...(state.recipient ? { contacts: [{ wa_id: state.recipient }] } : {}) });
    };
    return { state, fetch };
}
module.exports = { whatsappEnv, createStore, createMeta };
