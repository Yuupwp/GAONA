import { createHash } from "node:crypto";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import { generarSolicitudPdf } from "./solicitud-pdf";

export const LIMITE_PDF_BYTES = 2 * 1024 * 1024;

export function crearDocumentos(generar = generarSolicitudPdf, ahora = Date.now, capacidad = 32) {
  const documentos = new Map<string, { vence: number; contenido: Promise<Buffer> }>();
  const producir = async (datos: ComprobanteSolicitud) => {
    const pdf = await generar(datos);
    if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") {
      throw new Error("Documento no válido o demasiado grande");
    }
    return pdf;
  };
  return async (datos: ComprobanteSolicitud, retener = false) => {
    const tiempo = ahora();
    for (const [id, documento] of documentos) if (documento.vence <= tiempo) documentos.delete(id);
    const clave = createHash("sha256").update(JSON.stringify(datos)).digest("hex");
    const existente = documentos.get(clave);
    if (existente) return existente.contenido;
    if (documentos.size >= capacidad) {
      if (retener) throw new Error("Capacidad temporal de documentos agotada");
      return producir(datos);
    }
    const entrada = { vence: Number.POSITIVE_INFINITY, contenido: Promise.resolve().then(() => producir(datos)).then(pdf => {
      entrada.vence = ahora() + 31 * 60 * 1000;
      return pdf;
    }).catch(error => {
      documentos.delete(clave);
      throw error;
    }) };
    documentos.set(clave, entrada);
    return entrada.contenido;
  };
}
