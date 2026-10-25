const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
require('tsx/cjs');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const { crearPersistenciaSolicitudes, serializarSolicitud } = require('../src/solicitud-persistencia');
const { registrarSolicitud } = require('../src/solicitud-registro');
const { crearServicioCorreo, configurarSmtp } = require('../src/solicitud-correo');
const { crearAlmacenCorreo } = require('../src/solicitud-correo-almacen');
const { opcionesPrueba, observarTransporte } = require('./brevo-diagnostico.cjs');
const root = path.resolve(__dirname, '../..');
const pg = '/usr/lib/postgresql/17/bin';
const sha = value => createHash('sha256').update(value).digest('hex');
const email = z.email().max(150).refine(value => !/[\r\n\x00]/.test(value));
const fail = () => { throw Error('Ensayo SMTP bloqueado; conserva los archivos y revisa el estado sin reenviar'); };

function archivo(directory, name, value, exclusivo = true) {
    const file = path.join(directory, name);
    const fd = fs.openSync(file, (exclusivo ? fs.constants.O_EXCL : fs.constants.O_TRUNC) | fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function privado(directory) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) fail();
    if (path.relative(root, fs.realpathSync(directory)).split(path.sep)[0] !== '..') fail();
}
function leer(directory, name) {
    privado(directory);
    const fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) fail();
        return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
}
const json = (directory, name) => JSON.parse(leer(directory, name));
function comando(binary, args, env, input) {
    const result = spawnSync(path.join(pg, binary), args, { env, input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw Error(`Falló ${binary} en el laboratorio SMTP; no se muestran argumentos ni salida privada`);
    return result.stdout;
}
function ambiente(directory, port) {
    return { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', PGHOST: '127.0.0.1', PGPORT: String(port),
        PGUSER: 'gaona_web5_admin', PGDATABASE: 'gaona_web5_aislada', PGCONNECT_TIMEOUT: '3' };
}
function metadata(directory) {
    const state = json(directory, 'laboratorio.json');
    if (state.version !== 1 || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 || state.port === 5432 || !/^[a-f\d-]{36}$/.test(state.id)) fail();
    return state;
}
async function conexion(directory, run) {
    const { port } = metadata(directory), env = ambiente(directory, port);
    const data = path.join(directory, 'postgres');
    if (fs.lstatSync(data).isSymbolicLink() || !fs.realpathSync(data).startsWith(fs.realpathSync(directory) + path.sep)) fail();
    comando('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], env);
    const db = new PrismaClient({ datasources: { db: { url: `postgresql://gaona_web5_web@127.0.0.1:${port}/gaona_web5_aislada?connection_limit=1` } }, log: [] });
    try {
        const [role] = await db.$queryRaw`SELECT current_database() AS base, current_user AS usuario, host(inet_server_addr()) AS host,
            inet_server_port() AS puerto, rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
            FROM pg_roles WHERE rolname=current_user`;
        if (role.base !== 'gaona_web5_aislada' || role.usuario !== 'gaona_web5_web' || role.host !== '127.0.0.1' || role.puerto !== port ||
            role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolreplication) fail();
        const [access] = await db.$queryRaw`SELECT has_table_privilege(current_user,'public.inventario','SELECT') AS inventario,
            has_table_privilege(current_user,'public.usuarios','SELECT') AS usuarios, has_table_privilege(current_user,'public.pagos','INSERT') AS pagos`;
        if (access.inventario || access.usuarios || access.pagos) fail();
        return await run(db, env);
    } finally {
        await db.$disconnect();
        comando('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], env);
    }
}
async function exclusivo(directory, run) {
    privado(directory);
    archivo(directory, 'ejecucion.lock', String(process.pid));
    try { return await run(); }
    finally { fs.unlinkSync(path.join(directory, 'ejecucion.lock')); }
}
function smtp(from, user = 'usuario-smtp-simulado', password = 'clave-smtp-simulada') {
    const env = { NODE_ENV: 'development', MAIL_ENABLED: 'true', WHATSAPP_ENABLED: 'false', SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_FROM: from, SMTP_USER: user, SMTP_PASSWORD: password };
    if (!configurarSmtp(env) || /^xkeysib-/i.test(password)) fail();
    return env;
}
function validarMensaje(message, preview, pdf) {
    if (message.from?.address !== preview.remitente || message.to?.address !== preview.destinatario || message.cc || message.bcc || message.replyTo ||
        JSON.stringify(message.envelope) !== JSON.stringify({ from: preview.remitente, to: [preview.destinatario] }) ||
        message.subject !== preview.asunto || message.attachments?.length !== 1 || message.attachments[0].filename !== preview.pdf ||
        !Buffer.isBuffer(message.attachments[0].content) || !message.attachments[0].content.equals(pdf)) fail();
}
async function documento(db, directory) {
    const preview = json(directory, 'resumen.json');
    const lab = metadata(directory);
    if (lab.resumen_sha256 !== sha(leer(directory, 'resumen.json'))) fail();
    if (!email.safeParse(preview.remitente).success || !email.safeParse(preview.destinatario).success || preview.prueba !== lab.id) fail();
    const [row] = await db.$queryRaw`SELECT r.comprobante,d.pdf,d.pdf_sha256,c.intentos,c.estado,c.mensaje_id
        FROM gaona_mensajeria.registros_web r JOIN gaona_mensajeria.documentos d ON d.solicitud_id=r.solicitud_id
        JOIN gaona_mensajeria.correos c ON c.solicitud_id=r.solicitud_id WHERE r.solicitud_id=${preview.folio}`;
    if (!row || row.comprobante.cliente.correo !== preview.destinatario || row.comprobante.id !== preview.folio ||
        row.comprobante.estimado.total !== '2900.35' || sha(serializarSolicitud(row.comprobante)) !== lab.comprobante_sha256) fail();
    const pdf = Buffer.from(row.pdf);
    if (sha(pdf) !== row.pdf_sha256 || sha(pdf) !== preview.sha256 || !pdf.equals(leer(directory, preview.pdf))) fail();
    return { preview, row, pdf };
}
async function simularDentro(db, directory) {
    const { preview, row, pdf } = await documento(db, directory);
    if (row.intentos !== 0 || row.estado !== 'pendiente' || fs.existsSync(path.join(directory, 'intento-reservado.json'))) fail();
    let calls = 0, raw;
    const service = crearServicioCorreo(smtp(preview.remitente), original => {
        const options = opcionesPrueba(original, preview.etapa);
        if (++calls !== 1 || options.host !== 'smtp-relay.brevo.com' || options.port !== 587 || !options.requireTLS || !options.tls.rejectUnauthorized) fail();
        const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
        const simulated = { async sendMail(message) {
            validarMensaje(message, preview, pdf);
            const info = await stream.sendMail(message); raw = info.message;
            return { accepted: [preview.destinatario], rejected: [], messageId: info.messageId };
        }, close() { stream.close(); } };
        return observarTransporte(simulated, options, preview.destinatario, message => validarMensaje(message,preview,pdf),
            value => archivo(directory,'diagnostico-simulado.json',JSON.stringify(value,null,2),false)).transporte;
    });
    const result = await service(row.comprobante, '127.0.0.1', async () => pdf);
    await service(row.comprobante, '127.0.0.1', async () => pdf);
    if (result.estado !== 'aceptado' || calls !== 1 || !raw || raw.includes(Buffer.from('clave-smtp-simulada'))) fail();
    archivo(directory, 'mensaje-simulado.eml', raw, false);
    archivo(directory, 'simulacion.json', JSON.stringify({ estado: 'aprobada', sha256: sha(pdf), intentos_reales: 0, mime_sha256: sha(raw) }), false);
    return preview;
}
async function preparar(directory, from, to, etapa = 'WEB-5') {
    if (!['WEB-5','WEB-5B'].includes(etapa) || !email.safeParse(from).success || !email.safeParse(to).success) fail();
    fs.mkdirSync(directory, { mode: 0o700 });
    privado(directory);
    return exclusivo(directory, async () => {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const port = server.address().port;
        await new Promise(resolve => server.close(resolve));
        if (port === 5432 || port < 1024) fail();
        const id = randomUUID(), env = ambiente(directory, port), data = path.join(directory, 'postgres');
        archivo(directory, 'laboratorio.json', JSON.stringify({ version: 1, port, id }));
        comando('initdb', ['-D', data, '-U', 'gaona_web5_admin', '--auth=trust', '--encoding=UTF8', '--locale=C', '--no-instructions'], env);
        let started = false;
        try {
            comando('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], env); started = true;
            comando('createdb', ['gaona_web5_aislada'], { ...env, PGDATABASE: 'postgres' });
            const sql = (args, input) => comando('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args], env, input);
            sql([], 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
            sql(['-f', path.join(root, 'tests/fixtures/supabase-estructura.sql')]);
            comando('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'api/propuestas/web/01-instalacion.sql')],
                { ...env, PGOPTIONS: '-c gaona.web3_fk_restrict_aprobado=si' });
            sql(['-f', path.join(root, 'api/propuestas/web/02-permisos.sql')]);
            sql([], "CREATE ROLE gaona_web5_web LOGIN IN ROLE gaona_web_publico NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;");
            const keys = { SOLICITUD_IDEMPOTENCY_KEY: randomBytes(32).toString('hex'), SOLICITUD_PDF_KEY: randomBytes(32).toString('hex') };
            sql([], `UPDATE gaona_mensajeria.configuracion SET idempotencia_huella='${sha(Buffer.from(keys.SOLICITUD_IDEMPOTENCY_KEY,'hex'))}', acceso_huella='${sha(Buffer.from(keys.SOLICITUD_PDF_KEY,'hex'))}' WHERE id=1;
                INSERT INTO public.categorias(id,nombre) VALUES ('web5-ficticia','PRUEBA SMTP FICTICIA');
                INSERT INTO public.productos(id,"idCategoria",nombre,"precioDesde",activo,tipo,"actualizadoEn") VALUES ('web5-producto','web5-ficticia','Producto ficticio SMTP',1250.15,true,'PRODUCTO',now());`);
            comando('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], env); started = false;
            return await conexion(directory, async db => {
                const store = crearPersistenciaSolicitudes(db, { ...smtp(from), ...keys, SOLICITUD_STORAGE: 'postgres' });
                const input = { cliente: { nombre: 'Cliente', apellido: `Ficticio SMTP`, telefono: '0000000000', correo: to },
                    descripcion: `PRUEBA SMTP FICTICIA. Sin pedido comercial ni datos de otros clientes.`, whatsappConsentimiento: false,
                    productos: [{ idProducto: 'web5-producto', cantidad: 2, medidasAprox: '90 x 210 cm ficticios' }] };
                const create = tx => registrarSolicitud(tx, input);
                const { comprobante } = await store.registrar(id, input, create, '127.0.0.1');
                const repeated = await store.registrar(id, input, create, '127.0.0.1');
                if (repeated.comprobante.id !== comprobante.id || !repeated.repetido || comprobante.estimado.subtotal !== '2500.30' ||
                    comprobante.estimado.iva !== '400.05' || comprobante.estimado.total !== '2900.35') fail();
                const pdf = await store.documento(comprobante);
                if (!pdf || pdf.subarray(0,5).toString() !== '%PDF-') fail();
                const preview = { ...(etapa === 'WEB-5B' ? {etapa} : {}), prueba: id, remitente: from, destinatario: to, asunto: `GAONA | Solicitud de cotización - ${comprobante.id}`,
                    folio: comprobante.id, pdf: `GAONA-Solicitud-${comprobante.id}.pdf`, subtotal: '2500.30', iva: '400.05', total: '2900.35', sha256: sha(pdf),
                    postgres: '17 local desechable, 127.0.0.1, identidad restringida sin BYPASSRLS', maximo_intentos_smtp: 1, supabase: 'sin conexión ni modificaciones' };
                archivo(directory, preview.pdf, pdf);
                archivo(directory, 'resumen.json', JSON.stringify(preview, null, 2));
                archivo(directory, 'laboratorio.json', JSON.stringify({ version: 1, port, id, resumen_sha256: sha(leer(directory,'resumen.json')),
                    comprobante_sha256: sha(serializarSolicitud(comprobante)) }), false);
                return simularDentro(db, directory);
            });
        } finally { if (started) comando('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], env); }
    });
}
async function simular(directory) {
    return exclusivo(directory, () => conexion(directory, db => simularDentro(db, directory)));
}
async function enviarUnaVez(directory, { user, password, confirmacion, fabrica }) {
    const preview = json(directory, 'resumen.json');
    if (confirmacion !== `AUTORIZO ${preview.folio} A ${preview.destinatario}` || typeof fabrica !== 'function') fail();
    const env = smtp(preview.remitente, user, password);
    return exclusivo(directory, async () => {
        const simulation = json(directory, 'simulacion.json');
        if (simulation.estado !== 'aprobada' || simulation.sha256 !== preview.sha256 || simulation.mime_sha256 !== sha(leer(directory,'mensaje-simulado.eml'))) fail();
        if (fs.existsSync(path.join(directory,'intento-reservado.json'))) fail();
        return conexion(directory, async db => {
            const { row, pdf } = await documento(db, directory);
            if (row.intentos !== 0 || row.estado !== 'pendiente') fail();
            archivo(directory, 'intento-reservado.json', JSON.stringify({ prueba: preview.prueba, folio: preview.folio, estado: 'reservado_sin_reintento', fecha: new Date().toISOString() }));
            let calls = 0, queue = null, diagnostico = null;
            const identificador = value => typeof value === 'string' && /^[a-z\d._@+<>-]{1,255}$/i.test(value) &&
                ![user,password].some(secret => secret && value.includes(secret)) ? value : undefined;
            const service = crearServicioCorreo(env, original => {
                const options = opcionesPrueba(original, preview.etapa);
                if (++calls !== 1 || options.host !== 'smtp-relay.brevo.com' || options.port !== 587 || options.secure || !options.requireTLS ||
                    options.tls.rejectUnauthorized !== true || options.tls.minVersion !== 'TLSv1.2' || options.pool || options.logger || options.debug) fail();
                const transport = fabrica(options);
                const guarded = { async sendMail(message) {
                    validarMensaje(message, preview, pdf);
                    const info = await transport.sendMail(message);
                    queue = typeof info.response === 'string' ? identificador(info.response.match(/(?:queued as|message id[:=]?)\s*<?([a-z\d._@+-]{1,200})>?/i)?.[1]) ?? null : null;
                    return { ...info, messageId: identificador(info.messageId) };
                }, close() { transport.close(); } };
                const observado = observarTransporte(guarded,options,preview.destinatario,message => validarMensaje(message,preview,pdf),
                    value => archivo(directory,'diagnostico-smtp.json',JSON.stringify(value,null,2),false));
                diagnostico = observado.diagnostico;
                return observado.transporte;
            }, Date.now, 25000, crearAlmacenCorreo(db));
            const result = await service(row.comprobante, '127.0.0.1', async () => pdf);
            const [saved] = await db.$queryRaw`SELECT estado,intentos,mensaje_id,proveedor_id,respuesta_smtp,codigo_error,adjunto_sha256
                FROM gaona_mensajeria.correos WHERE solicitud_id=${preview.folio}`;
            const report = { prueba: preview.prueba, folio: preview.folio, estado: result.estado, intentos: saved.intentos,
                mensaje_id: saved.mensaje_id, identificador_smtp: saved.proveedor_id, cola_smtp: queue, respuesta_smtp: saved.respuesta_smtp,
                codigo_error: saved.codigo_error, sha256: saved.adjunto_sha256, diagnostico, entrega: 'pendiente de comprobar en Brevo y buzón' };
            archivo(directory, 'resultado.json', JSON.stringify(report, null, 2));
            return report;
        });
    });
}

module.exports = { preparar, simular, enviarUnaVez, leer, json, sha, validarMensaje };
