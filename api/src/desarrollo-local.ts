import { crearPrismaWeb } from "./lib/prisma-web";
import { crearEnsayoCorreoLocal } from "./correo-ensayo-local";
import { configurarSmtp } from "./solicitud-correo";

async function iniciar() {
  const local = require("../scripts/desarrollo-local.cjs");
  if (process.env.NODE_ENV !== "development" || process.env.GAONA_DESARROLLO_DIR !== local.directory) throw Error();
  const state = local.runtime(), config = local.config();
  const env = { NODE_ENV: "development", WEB_DATABASE_URL: `postgresql://gaona_desarrollo_web:${state.webPassword}@127.0.0.1:${state.pgPort}/gaona_desarrollo_local?connection_limit=3`,
    SOLICITUD_STORAGE: "postgres", SOLICITUD_IDEMPOTENCY_KEY: state.idempotencia, SOLICITUD_PDF_KEY: state.acceso,
    MAIL_ENABLED: "true", WHATSAPP_ENABLED: "false", SMTP_HOST: "smtp.simulado.invalid", SMTP_PORT: "587", SMTP_SECURE: "false",
    SMTP_USER: "simulado", SMTP_PASSWORD: "simulado", SMTP_FROM: "gaona@example.test" };
  process.env.SOLICITUD_PDF_KEY = state.acceso;
  const { crearApiWeb } = require("./api-web");
  const db = crearPrismaWeb(env);
  const [role] = await db.$queryRaw<{ seguro: boolean }[]>`SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)
    AND current_user='gaona_desarrollo_web' AND current_database()='gaona_desarrollo_local' AND host(inet_server_addr())='127.0.0.1'
    AND NOT has_table_privilege(current_user,'public.usuarios','SELECT')
    AND NOT has_table_privilege(current_user,'public.inventario','SELECT')
    AND NOT has_table_privilege(current_user,'public.pagos','INSERT') AS seguro FROM pg_roles WHERE rolname=current_user`;
  if (!role?.seguro || !configurarSmtp(env)) throw Error();
  const ensayo = crearEnsayoCorreoLocal(local.directory, "simulado");
  const app = crearApiWeb(db, env, false, ensayo.fabrica, ensayo.politica);
  const server = app.listen(config.apiPort, "127.0.0.1");
  const stop = () => server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
void iniciar().catch(() => { console.error("API local rechazada: revisa la inicialización y los permisos del laboratorio independiente"); process.exit(1); });
