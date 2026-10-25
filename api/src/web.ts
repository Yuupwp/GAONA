import "./entorno-publico";
import { entornoWeb } from "./entorno-web";
import { crearPrismaWeb } from "./lib/prisma-web";
import { auditarIdentidadWeb } from "./lib/seguridad-web";
import { crearApiWeb } from "./api-web";

const env = entornoWeb(process.env);
const PORT = Number(env.WEB_PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("WEB_PORT debe ser un puerto válido");
const HOST = env.WEB_HOST ?? "127.0.0.1";
const db = crearPrismaWeb(env);
const app = crearApiWeb(db, env);
const iniciar = async () => {
  const laboratorio = await auditarIdentidadWeb(db, env);
  if (!laboratorio) {
    const { verificar } = require("../scripts/verificar-web.cjs");
    const resultado: { ok: boolean } = await verificar(env);
    if (!resultado.ok) throw new Error();
  }
  app.listen(PORT, HOST, () => console.log(`API web en http://${HOST}:${PORT}`));
};
void iniciar().catch(() => {
    console.error("WEB6_VERIFICACION: API pública cerrada por conexión o permisos no verificados");
    void db.$disconnect().finally(() => { process.exitCode = 1; });
});
