import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ComprobanteSolicitud } from "./solicitud-estimado";

const duracion = 30 * 60 * 1000;
const configurada = process.env.SOLICITUD_PDF_KEY;
if (configurada && !/^[a-f\d]{64}$/i.test(configurada)) {
  throw new Error("SOLICITUD_PDF_KEY debe contener 64 caracteres hexadecimales");
}
const clave = configurada ? Buffer.from(configurada, "hex") : randomBytes(32);
const contexto = Buffer.from("GAONA:solicitud-pdf:v1");

export function emitirAcceso(comprobante: ComprobanteSolicitud, ahora = Date.now()) {
  const expiraEn = ahora + duracion;
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  cifrador.setAAD(contexto);
  const contenido = Buffer.from(JSON.stringify({ expiraEn, comprobante }));
  const cifrado = Buffer.concat([cifrador.update(contenido), cifrador.final()]);
  const token = Buffer.concat([iv, cifrador.getAuthTag(), cifrado]).toString("base64url");
  if (token.length > 90000) throw new Error("Comprobante demasiado extenso");
  return { token, expiraEn: new Date(expiraEn).toISOString() };
}

export function leerAcceso(token: unknown, ahora = Date.now()): ComprobanteSolicitud | null {
  try {
    if (typeof token !== "string" || token.length < 40 || token.length > 90000 || !/^[\w-]+$/.test(token)) return null;
    const datos = Buffer.from(token, "base64url");
    const descifrador = createDecipheriv("aes-256-gcm", clave, datos.subarray(0, 12));
    descifrador.setAAD(contexto);
    descifrador.setAuthTag(datos.subarray(12, 28));
    const contenido = Buffer.concat([descifrador.update(datos.subarray(28)), descifrador.final()]);
    const { expiraEn, comprobante } = JSON.parse(contenido.toString("utf8"));
    if (!Number.isFinite(expiraEn) || ahora >= expiraEn) return null;
    return comprobante;
  } catch {
    return null;
  }
}
