import { join } from "node:path";
import { homedir } from "node:os";
import express from "express";
import { crearEnsayoCorreoLocal, leerPrivado, validarConfiguracionEnsayo, guardiaOrigenEnsayo } from "./correo-ensayo-local";
import { crearPrismaWeb } from "./lib/prisma-web";
import { crearApiWeb } from "./api-web";
import { configurarSmtp } from "./solicitud-correo";
import { randomUUID } from "node:crypto";

async function iniciar() {
  const env = process.env;
  if (env.NODE_ENV !== "development" || env.GAONA_WEB_LOCAL !== "WEB5C_POSTGRES_LOCAL" || env.WEB_HOST !== "127.0.0.1" || env.WEB_PORT !== "3000" ||
    env.GAONA_WEB_LOCAL_DIR !== join(homedir(), ".local", "state", "gaona-web5c")) throw Error();
  const url = new URL(env.WEB_DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.username !== "gaona_web5c_web" || url.pathname !== "/gaona_web5c_aislada" || !url.port || url.port === "5432") throw Error();
  const db = crearPrismaWeb(env);
  const [role] = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; local: boolean }[]>`
    SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
      current_database()='gaona_web5c_aislada' AND current_user='gaona_web5c_web' AND host(inet_server_addr())='127.0.0.1' AS local
    FROM pg_roles WHERE rolname=current_user`;
  const [access] = await db.$queryRaw<{ usuarios: boolean; inventario: boolean; pagos: boolean }[]>`SELECT
    has_table_privilege(current_user,'public.usuarios','SELECT') AS usuarios,
    has_table_privilege(current_user,'public.inventario','SELECT') AS inventario,
    has_table_privilege(current_user,'public.pagos','INSERT') AS pagos`;
  if (!role?.local || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolreplication || access.usuarios || access.inventario || access.pagos) throw Error();
  const real = env.GAONA_WEB_LOCAL_SMTP === "confirmado";
  if (env.GAONA_WEB_LOCAL_SMTP && !real) throw Error();
  let config = real ? validarConfiguracionEnsayo(JSON.parse(leerPrivado(env.GAONA_WEB_LOCAL_DIR!, "destinatarios.json").toString())) : undefined;
  let usuario = "usuario-simulado", clave = "clave-simulada-no-real";
  if (real) {
    const { recibirConfiguracion } = require("../scripts/canal-smtp-local.cjs");
    const secretos = await recibirConfiguracion();
    if (typeof secretos.usuario !== "string" || typeof secretos.clave !== "string" || /^xkeysib-/i.test(secretos.clave)) throw Error();
    if (!config?.destinatarios.includes(secretos.destinatario)) throw Error();
    config = { ...config, destinatarios: [secretos.destinatario] };
    usuario = secretos.usuario; clave = secretos.clave;
    secretos.usuario = ""; secretos.clave = "";
  }
  const correoEnv = { ...env, MAIL_ENABLED: "true", WHATSAPP_ENABLED: "false", SMTP_HOST: real ? "smtp-relay.brevo.com" : "smtp.web5c.invalid", SMTP_PORT: "587",
    SMTP_SECURE: "false", SMTP_USER: usuario, SMTP_PASSWORD: clave, SMTP_FROM: config?.remitente ?? "gaona@example.test" };
  if (!configurarSmtp(correoEnv)) throw Error();
  const ensayo = crearEnsayoCorreoLocal(env.GAONA_WEB_LOCAL_DIR!, real ? "smtp" : "simulado", config, undefined, real ? randomUUID() : undefined);
  const { crearCatalogoLocal } = require("../scripts/catalogo-local.cjs");
  const catalogo: typeof db = crearCatalogoLocal(db);
  const app = express();
  app.use(guardiaOrigenEnsayo(real));
  app.use(crearApiWeb(catalogo, correoEnv, false, ensayo.fabrica, ensayo.politica));
  const server = app.listen(3000, "127.0.0.1", () => console.log(real ?
    "API pública local: ensayo SMTP local autorizado; máximo un intento por solicitud; sesión de 30 minutos." :
    "API pública local: http://localhost:3000 — PostgreSQL restringido; correo simulado, sin SMTP real."));
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (temporizador) clearTimeout(temporizador); server.close(() => { void db.$disconnect().finally(() => process.exit(0)); }); };
  if (real) temporizador = setTimeout(stop, 30 * 60 * 1000);
  process.once("SIGINT", stop);process.once("SIGTERM", stop);
}
void iniciar().catch(error => {
  console.error(error?.code === "SMTP_CONFIGURACION" ? "SMTP_CONFIGURACION: No se completó el canal privado de configuración" :
    "API local rechazada: comprueba PostgreSQL local y su configuración restringida");
  process.exit(1);
});
