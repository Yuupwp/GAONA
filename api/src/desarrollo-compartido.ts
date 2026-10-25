async function iniciar() {
  const shared = require("../scripts/entorno-compartido.cjs");
  const env: NodeJS.ProcessEnv = shared.entorno(process.env.WEB_CORREO_MODO === "smtp");
  await shared.verificar(env);
  process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
  const { crearPrismaWeb } = require("./lib/prisma-web");
  const { auditarIdentidadWeb } = require("./lib/seguridad-web");
  const { crearApiWeb } = require("./api-web");
  const { crearEnsayoCorreoLocal } = require("./correo-ensayo-local");
  if (env.SOLICITUD_STORAGE === "data-api") {
    const { crearClienteDataApi, crearPersistenciaDataApi, crearEnsayoDataApi } = require("./data-api");
    const client = crearClienteDataApi(env), storage = crearPersistenciaDataApi(env, client);
    const simulated = { ...env, MAIL_ENABLED: "true", WHATSAPP_ENABLED: "false", SMTP_HOST: "smtp.simulado.invalid", SMTP_PORT: "587",
      SMTP_SECURE: "false", SMTP_USER: "usuario-simulado", SMTP_PASSWORD: "clave-simulada", SMTP_FROM: "gaona@example.test" };
    const real = env.WEB_CORREO_MODO === "smtp";
    const transport = real ? crearEnsayoDataApi(shared.directory, client, { modo: "smtp", destinatario: env.WEB_SMTP_DESTINATARIO,
      fabrica: require("../scripts/smtp-compartido.cjs").fabricaCotizacionesBrevo(env) }) : crearEnsayoDataApi(shared.directory, client);
    const server = crearApiWeb(undefined, real ? env : simulated, false, transport.fabrica, transport.politica, { catalogo: () => client.catalogo(), persistencia: storage }).listen(Number(env.WEB_PORT), "127.0.0.1");
    const stop = () => server.close(() => process.exit(0));
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    return;
  }
  const db = crearPrismaWeb(env);
  try {
    await auditarIdentidadWeb(db, env);
    const simulated = { ...env, MAIL_ENABLED: "true", WHATSAPP_ENABLED: "false", SMTP_HOST: "smtp.simulado.invalid", SMTP_PORT: "587",
      SMTP_SECURE: "false", SMTP_USER: "usuario-simulado", SMTP_PASSWORD: "clave-simulada", SMTP_FROM: "gaona@example.test" };
    const transport = crearEnsayoCorreoLocal(shared.directory, "simulado");
    const server = crearApiWeb(db, simulated, false, transport.fabrica, transport.politica).listen(Number(env.WEB_PORT), "127.0.0.1");
    const stop = () => server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch { await db.$disconnect(); throw Error(); }
}
void iniciar().catch(() => { console.error("WEB_COMPARTIDA: API cerrada por configuración, conexión o permisos no verificados; no se muestran secretos"); process.exit(1); });
export {};
