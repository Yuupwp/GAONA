const { performance } = require('node:perf_hooks');
const versionNodemailer = require('nodemailer/package.json').version;
const codigos = new Set(['EDNS','ETIMEOUT','ETIMEDOUT','ENODATA','ENOTFOUND','EAI_AGAIN','ESERVFAIL','ENOTIMP',
    'ECONNREFUSED','EREFUSED','ECANCELLED','EFORMERR','EBADRESP','ECONNRESET','EHOSTUNREACH','ENETUNREACH',
    'EAUTH','ECONNECTION','ESOCKET','ETLS','EENVELOPE','EMESSAGE','EPROTOCOL','EREQUIRETLS','ERR_ACCESS_DENIED']);
const comandos = new Set(['CONN','EHLO','HELO','STARTTLS','AUTH','AUTH LOGIN','AUTH PLAIN','AUTH XOAUTH2','MAIL FROM','RCPT TO','DATA','QUIT']);
const token = (value, allowed) => value === undefined || value === null ? null : allowed.has(value) ? value : 'OTRO';

function opcionesPrueba(options, etapa = 'WEB-5') {
    if (!['WEB-5','WEB-5B'].includes(etapa)) throw Error('Perfil de ensayo no válido');
    return etapa === 'WEB-5B' ? { ...options, dnsTimeout: 10000, connectionTimeout: 15000 } : options;
}

function observarTransporte(transport, options, destinatario, validar, guardar) {
    const diagnostico = { estado: 'sin_iniciar', codigo_error: null, codigo_original: null, comando: null,
        duracion_ms: 0, node: process.version, nodemailer: versionNodemailer, aceptacion_smtp: null, respuesta_smtp: null,
        limites_ms: { dns: options.dnsTimeout, conexion: options.connectionTimeout, saludo: options.greetingTimeout,
            socket: options.socketTimeout, operacion: 25000 } };
    return { diagnostico, transporte: {
        async sendMail(message) {
            validar(message);
            const inicio = performance.now();
            diagnostico.estado = 'iniciado';
            guardar(diagnostico);
            try {
                const info = await transport.sendMail(message);
                diagnostico.estado = 'completado';
                diagnostico.aceptacion_smtp = !!info.accepted?.some(value => typeof value === 'string' && value.toLowerCase() === destinatario.toLowerCase()) && !info.rejected?.length;
                const code = typeof info.response === 'string' ? Number(info.response.match(/^([2-5]\d{2})\b/)?.[1]) : NaN;
                diagnostico.respuesta_smtp = Number.isInteger(code) ? code : null;
                return info;
            } catch (error) {
                diagnostico.estado = 'error';
                diagnostico.codigo_error = token(error?.code, codigos);
                diagnostico.codigo_original = token(error?.originalCode, codigos);
                diagnostico.comando = token(error?.command, comandos);
                const responseCode = error?.responseCode;
                diagnostico.respuesta_smtp = Number.isInteger(responseCode) && responseCode >= 200 && responseCode <= 599 ? responseCode : null;
                throw error;
            } finally {
                diagnostico.duracion_ms = Math.round(performance.now() - inicio);
                guardar(diagnostico);
            }
        },
        close() { transport.close(); }
    } };
}

module.exports = { opcionesPrueba, observarTransporte };
