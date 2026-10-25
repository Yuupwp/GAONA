export function crearAplicacionDataApi(env: NodeJS.ProcessEnv, directorio: string,
  client: ReturnType<typeof import("./data-api").crearClienteDataApi>, crearTransporte?: unknown) {
  const { crearPersistenciaDataApi, crearEnsayoDataApi } = require("./data-api");
  const { crearApiWeb } = require("./api-web");
  const storage = crearPersistenciaDataApi(env, client);
  const real = env.WEB_CORREO_MODO === "smtp";
  const config = real ? env : { ...env, MAIL_ENABLED: "true", WHATSAPP_ENABLED: "false", SMTP_HOST: "smtp.simulado.invalid",
    SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "usuario-simulado", SMTP_PASSWORD: "clave-simulada", SMTP_FROM: "gaona@example.test" };
  const transport = real ? crearEnsayoDataApi(directorio, client, { modo: "smtp", destinatario: env.WEB_SMTP_DESTINATARIO,
    fabrica: require("../scripts/smtp-compartido.cjs").fabricaCotizacionesBrevo(env, crearTransporte) }) : crearEnsayoDataApi(directorio, client);
  return crearApiWeb(undefined, config, false, transport.fabrica, transport.politica, { catalogo: () => client.catalogo(), persistencia: storage });
}

async function iniciar() {
  const shared = require("../scripts/entorno-compartido.cjs");
  const env: NodeJS.ProcessEnv = shared.entorno(process.env.WEB_SMTP_SESION === "temporal");
  if (env.WEB_SMTP_SESION === "temporal") env.WEB_SMTP_DESTINATARIO = process.env.WEB_SMTP_DESTINATARIO;
  await shared.verificar(env);
  process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
  const { crearPrismaWeb } = require("./lib/prisma-web");
  const { auditarIdentidadWeb } = require("./lib/seguridad-web");
  const { crearApiWeb } = require("./api-web");
  const { crearEnsayoCorreoLocal } = require("./correo-ensayo-local");
  if (env.SOLICITUD_STORAGE === "data-api") {
    const { crearClienteDataApi } = require("./data-api");
    const client = crearClienteDataApi(env);
    const server = crearAplicacionDataApi(env, shared.directory, client).listen(Number(env.WEB_PORT), "127.0.0.1");
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
if (require.main === module) void iniciar().catch(() => { console.error("WEB_COMPARTIDA: API cerrada por configuración, conexión o permisos no verificados; no se muestran secretos"); process.exit(1); });
