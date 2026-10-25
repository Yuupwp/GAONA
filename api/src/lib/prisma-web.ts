import { PrismaClient } from "@prisma/client";

export function esConexionRemota(env: NodeJS.ProcessEnv): boolean {
  try { return !["127.0.0.1", "localhost", "[::1]"].includes(new URL(env.WEB_DATABASE_URL!).hostname); }
  catch { return false; }
}

export function crearPrismaWeb(env: NodeJS.ProcessEnv) {
  const url = env.WEB_DATABASE_URL;
  try {
    if (!url) throw new Error();
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2) throw new Error();
  } catch {
    throw new Error("Configura WEB_DATABASE_URL explícitamente para el backend web; no se utiliza la conexión administrativa como respaldo");
  }
  if (esConexionRemota(env)) {
    try { require("../../scripts/verificar-web.cjs").validarEntorno(env); }
    catch { throw new Error("WEB_DATABASE_URL remota requiere identidad web explícita, TLS estricto y CA verificada"); }
  }
  return new PrismaClient({ datasources: { db: { url } } });
}
