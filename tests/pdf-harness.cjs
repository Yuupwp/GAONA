const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
apiRequire('tsx/cjs');
const { transformSync } = apiRequire('esbuild');
const { Prisma } = apiRequire('@prisma/client');
const fixture = [
    { id: 'simulado-1', nombre: 'Puerta de roble', precioDesde: new Prisma.Decimal('1250.15'), categoria: { nombre: 'Puertas' } },
    { id: 'simulado-2', nombre: 'Ventana de aluminio', precioDesde: new Prisma.Decimal('0.10'), categoria: { nombre: 'Ventanas' } }
];
const valid = {
    cliente: { nombre: 'Cliente', apellido: 'Simulado', telefono: '5555555555', correo: 'prueba@example.test' },
    descripcion: 'Datos simulados para pruebas aisladas',
    productos: [
        { idProducto: fixture[0].id, cantidad: 2, medidasAprox: '90 x 210 cm', notas: 'Acabado natural' },
        { idProducto: fixture[1].id, cantidad: 3, medidasAprox: '120 x 100 cm' }
    ]
};
function createHarness(options = {}) {
    let app;
    const express = apiRequire('express');
    const state = { writes: 0, queries: [], imports: [], failPdf: false, failReceipt: false, failWrite: false,
        mailCalls: 0, messages: [], smtp: [], mailMode: 'accepted', closes: 0 };
    const transportFactory = smtp => {
        state.smtp.push(smtp);
        const stream = apiRequire('nodemailer').createTransport({ streamTransport: true, buffer: true });
        return {
            async sendMail(message) {
                state.mailCalls++;
                if (options.mailGate) await options.mailGate;
                if (state.mailMode === 'pending') return new Promise(() => {});
                if (['ECONNECTION', 'EAUTH', 'ETIMEDOUT', 'ESOCKET', 'EENVELOPE'].includes(state.mailMode)) {
                    throw Object.assign(Error('Detalle privado simulado'), { code: state.mailMode });
                }
                const info = await stream.sendMail(message);
                state.messages.push({ message, raw: info.message });
                return { accepted: state.mailMode === 'rejected' ? [] : info.envelope.to,
                    rejected: state.mailMode === 'rejected' ? info.envelope.to : [] };
            },
            close() { state.closes++; stream.close(); }
        };
    };
    const prisma = options.prisma ?? {
        producto: { findMany: async query => {
            state.queries.push(query);
            return fixture.filter(p => !query.where.id || query.where.id.in.includes(p.id));
        } },
        solicitud: { create: async query => {
            if (state.failWrite) throw Error('Fallo de base simulada');
            state.writes++;
            state.saved = query.data;
            return { id: `11111111-2222-4333-8444-${555555555554 + state.writes}`, creadoEn: new Date('2026-10-22T12:00:00Z') };
        } }
    };
    const whatsappStore = options.whatsappStoreFactory ? options.whatsappStoreFactory(prisma) : options.whatsappStore;
    const factory = Object.assign(() => {
        app = express();
        app.listen = (...args) => { state.listenArgs = args; };
        return app;
    }, { json: express.json });
    function evaluar(archivo) {
        const source = transformSync(readFileSync(path.join(__dirname, '../api/src/', archivo), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
        const module = { exports: {} };
        vm.runInNewContext(source, {
            module, exports: module.exports,
            require(name) {
                state.imports.push(name);
                if (name === 'express') return factory;
                if (name === 'dotenv/config' || name === './entorno-publico') return {};
                if (name === './lib/prisma') return { prisma };
                if (name === './lib/prisma-web') return { crearPrismaWeb: env => { state.webEnv = env; return prisma; }, esConexionRemota: () => false };
                if (name === './lib/seguridad-web') return { auditarIdentidadWeb: async () => true };
                if (name === './api-web') return evaluar('api-web.ts');
                if (name === './entorno-web') return apiRequire('./src/entorno-web');
                if (name === './clientes') return { clientesRouter: options.clientesRouter ?? express.Router() };
                if (name === './empleado') return { empleadosRouter: options.empleadosRouter ?? express.Router() };
                if (name === './solicitud-correo') return {
                    crearServicioCorreo: (_env, _fabrica, _ahora, _plazo, almacen) => {
                        state.correoEnv = _env;
                        return apiRequire('./src/solicitud-correo').crearServicioCorreo(options.env ?? _env, transportFactory, options.now ?? Date.now, options.timeout ?? 25000, almacen);
                    }
                };
                if (name === './solicitud-whatsapp') return {
                    ...apiRequire('./src/solicitud-whatsapp'),
                    crearServicioWhatsapp: () => {
                        state.whatsappCreated = true;
                        return apiRequire('./src/solicitud-whatsapp').crearServicioWhatsapp(options.whatsappEnv ?? {}, whatsappStore, options.whatsappFetch);
                    }
                };
                if (name === './solicitud-controles') return {
                    ...apiRequire('./src/solicitud-controles'),
                    crearControlSolicitudes: (_ahora, reintentar) => apiRequire('./src/solicitud-controles').crearControlSolicitudes(options.now ?? Date.now, reintentar)
                };
                if (name === './solicitud-pdf') return { generarSolicitudPdf: async data => {
                    if (state.failPdf) throw Error('Fallo simulado PDF');
                    return apiRequire('./src/solicitud-pdf').generarSolicitudPdf(data);
                } };
                if (name === './solicitud-acceso') return {
                    ...apiRequire('./src/solicitud-acceso'),
                    emitirAcceso: data => {
                        if (state.failReceipt) throw Error('Fallo simulado comprobante');
                        return apiRequire('./src/solicitud-acceso').emitirAcceso(data);
                    }
                };
                if (name.startsWith('./solicitud-')) return apiRequire('./src/' + name.slice(2));
                return apiRequire(name);
            }, process: { env: options.apiEnv ?? {} }, Promise, console: { log() {}, error() {} }
        });
        return module.exports;
    }
    const explicitEntry = options.entry ?? process.env.GAONA_TEST_ENTRY;
    const entry = explicitEntry ?? 'api-web.ts';
    const exported = evaluar(entry);
    if (entry === 'api-web.ts') exported.crearApiWeb(prisma, options.apiEnv ?? {}, options.incluirWhatsapp ?? !explicitEntry);
    return { app, state, whatsappStore };
}
module.exports = { createHarness, fixture, valid, apiRequire };
