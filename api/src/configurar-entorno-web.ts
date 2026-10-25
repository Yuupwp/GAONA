import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { configurarSmtp } from "./solicitud-correo";

const clavesSmtp = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;

export function cargarEntornoWeb(destino: NodeJS.ProcessEnv = process.env, ruta = resolve(__dirname, "../.env")) {
  let privadas: Record<string, string> = {};
  try { privadas = parse(readFileSync(ruta)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("No se pudo cargar la configuración privada de la API web");
  }
  const inyectadas = Object.fromEntries(Object.entries(destino).filter(([, valor]) => valor !== undefined));
  const resultado: NodeJS.ProcessEnv = { ...privadas, ...inyectadas, MAIL_ENABLED: "false", WHATSAPP_ENABLED: "false" };
  const fuente = clavesSmtp.some(clave => destino[clave] !== undefined) ? destino : privadas;
  for (const clave of clavesSmtp) {
    delete resultado[clave];
    if (fuente[clave] !== undefined) resultado[clave] = fuente[clave];
  }
  if (clavesSmtp.some(clave => resultado[clave] !== undefined) && !configurarSmtp({ ...resultado, MAIL_ENABLED: "true" })) {
    throw new Error("Configuración SMTP web incompleta o inválida");
  }
  Object.assign(destino, resultado);
}
