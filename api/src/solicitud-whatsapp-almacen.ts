import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import { CONSENTIMIENTO_WHATSAPP, VERSION_CONSENTIMIENTO_WHATSAPP, type AlmacenWhatsapp, type EstadoWhatsapp } from "./solicitud-whatsapp";
import { LIMITE_PDF_BYTES } from "./solicitud-documento";

type Fila = { id: string; destinatario: string; estado: string; mensaje_id: string | null; destinatario_proveedor: string | null; actualizado_en: Date };

export async function reservarEnvioWhatsapp(tx: Prisma.TransactionClient, comprobante: ComprobanteSolicitud, consentimiento: boolean, destinatario: string | null) {
  if (consentimiento && destinatario) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(713428991)`;
    const cantidad = await tx.$queryRaw<{ total: bigint; destinatario: bigint }[]>`
      SELECT count(*) AS total, count(*) FILTER (WHERE destinatario = ${destinatario}) AS destinatario
      FROM gaona_mensajeria.envios WHERE creado_en > now() - interval '1 hour' AND estado <> 'limitado'`;
    const limitado = Number(cantidad[0]?.total ?? 0) >= 30 || Number(cantidad[0]?.destinatario ?? 0) >= 3;
    await tx.$executeRaw`INSERT INTO gaona_mensajeria.envios
      (id, solicitud_id, canal, destinatario, consentimiento_texto, consentimiento_version, estado)
      VALUES (${randomUUID()}::uuid, ${comprobante.id}, 'whatsapp', ${destinatario}, ${CONSENTIMIENTO_WHATSAPP},
        ${VERSION_CONSENTIMIENTO_WHATSAPP}, ${limitado ? "limitado" : "pendiente"})`;
  }
}

export function crearAlmacenWhatsapp(prisma: PrismaClient): AlmacenWhatsapp {
  const versionDos = async () => {
    const filas = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM gaona_mensajeria.configuracion WHERE id = 1`;
    return filas[0]?.version === 2;
  };
  return {
    async disponible() {
      try {
        const filas = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM gaona_mensajeria.configuracion WHERE id = 1`;
        return filas[0]?.version === 1 || filas[0]?.version === 2;
      } catch { return false; }
    },
    async registrar(clave, huella, consentimiento, destinatario, crear) {
      if (await versionDos()) throw new Error("La versión 2 requiere el registro común de solicitudes");
      return prisma.$transaction(async tx => {
        const nuevas = await tx.$queryRaw<{ clave: string }[]>`INSERT INTO gaona_mensajeria.registros_web (clave, huella)
          VALUES (${clave}, ${huella}) ON CONFLICT (clave) DO NOTHING RETURNING clave`;
        if (!nuevas.length) {
          const anteriores = await tx.$queryRaw<{ huella: string; comprobante: ComprobanteSolicitud | null }[]>`
            SELECT huella, comprobante FROM gaona_mensajeria.registros_web WHERE clave = ${clave} FOR UPDATE`;
          if (anteriores[0]?.huella !== huella || !anteriores[0]?.comprobante) throw new Error("Intento persistente incompatible");
          return { comprobante: anteriores[0].comprobante, repetido: true };
        }
        const comprobante = await crear(tx);
        await tx.$executeRaw`UPDATE gaona_mensajeria.registros_web SET solicitud_id = ${comprobante.id},
          comprobante = ${JSON.stringify(comprobante)}::jsonb WHERE clave = ${clave}`;
        await reservarEnvioWhatsapp(tx, comprobante, consentimiento, destinatario);
        const config = await tx.$queryRaw<{ version: number }[]>`SELECT version FROM gaona_mensajeria.configuracion WHERE id = 1`;
        if (config[0]?.version === 2) await tx.$executeRaw`INSERT INTO gaona_mensajeria.documentos (solicitud_id) VALUES (${comprobante.id}) ON CONFLICT DO NOTHING`;
        return { comprobante, repetido: false };
      }, { maxWait: 10000, timeout: 15000 });
    },
    async reclamar(solicitud) {
      const filas = await prisma.$queryRaw<{ id: string; destinatario: string }[]>`
        UPDATE gaona_mensajeria.envios SET estado = 'preparando', actualizado_en = now()
        WHERE solicitud_id = ${solicitud} AND canal = 'whatsapp' AND estado = 'pendiente' RETURNING id, destinatario`;
      return filas[0] ?? null;
    },
    async guardarPdf(id, pdf) {
      if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF inválido");
      const sha = createHash("sha256").update(pdf).digest("hex");
      if (await versionDos()) {
        await prisma.$executeRaw`UPDATE gaona_mensajeria.documentos d SET estado = 'disponible', pdf = ${pdf}, pdf_sha256 = ${sha}, actualizado_en = now()
          FROM gaona_mensajeria.envios e WHERE e.id = ${id}::uuid AND e.solicitud_id = d.solicitud_id AND e.estado = 'preparando'
          AND d.estado IN ('pendiente','error') AND d.retener_hasta > now()`;
        const filas = await prisma.$queryRaw<{ pdf_sha256: string }[]>`SELECT d.pdf_sha256 FROM gaona_mensajeria.documentos d
          JOIN gaona_mensajeria.envios e ON e.solicitud_id = d.solicitud_id WHERE e.id = ${id}::uuid AND d.estado = 'disponible' AND d.retener_hasta > now()`;
        if (filas[0]?.pdf_sha256 !== sha) throw new Error("Documento canónico incompatible");
        return;
      }
      const filas = await prisma.$queryRaw<{ id: string }[]>`UPDATE gaona_mensajeria.envios SET pdf = ${pdf}, pdf_sha256 = ${sha}, actualizado_en = now()
        WHERE id = ${id}::uuid AND estado = 'preparando' AND pdf IS NULL RETURNING id`;
      if (!filas.length) throw new Error("Documento persistente ya preparado");
    },
    async iniciarEnvio(id, media) {
      if (await versionDos()) {
        const filas = await prisma.$queryRaw<{ id: string }[]>`UPDATE gaona_mensajeria.envios e SET estado = 'enviando', media_id = ${media}, actualizado_en = now()
          WHERE e.id = ${id}::uuid AND e.estado = 'preparando' AND EXISTS (SELECT 1 FROM gaona_mensajeria.documentos d
            WHERE d.solicitud_id = e.solicitud_id AND d.estado = 'disponible' AND d.retener_hasta > now()) RETURNING e.id`;
        return filas.length === 1;
      }
      const filas = await prisma.$queryRaw<{ id: string }[]>`UPDATE gaona_mensajeria.envios SET estado = 'enviando', media_id = ${media}, actualizado_en = now()
        WHERE id = ${id}::uuid AND estado = 'preparando' AND pdf IS NOT NULL RETURNING id`;
      return filas.length === 1;
    },
    async finalizar(id, estado, mensaje, destinatarioProveedor) {
      await prisma.$executeRaw`UPDATE gaona_mensajeria.envios SET estado = ${estado}, mensaje_id = COALESCE(mensaje_id, ${mensaje ?? null}),
        destinatario_proveedor = COALESCE(destinatario_proveedor, ${destinatarioProveedor ?? null}), actualizado_en = now()
        WHERE id = ${id}::uuid AND estado IN ('preparando', 'enviando', 'no_confirmado')
        AND (mensaje_id IS NULL OR mensaje_id = ${mensaje ?? null})`;
    },
    async estado(solicitud) {
      const filas = await prisma.$queryRaw<Fila[]>`SELECT id, destinatario, destinatario_proveedor, estado, mensaje_id, actualizado_en FROM gaona_mensajeria.envios
        WHERE solicitud_id = ${solicitud} AND canal = 'whatsapp'`;
      const fila = filas[0];
      if (!fila) return "sin_consentimiento";
      if (["preparando", "enviando"].includes(fila.estado)) return Date.now() - fila.actualizado_en.getTime() > 60000 ? "no_confirmado" : "pendiente";
      return fila.estado as EstadoWhatsapp;
    },
    async pdf(solicitud) {
      if (await versionDos()) {
        const filas = await prisma.$queryRaw<{ pdf: Uint8Array; pdf_sha256: string }[]>`SELECT pdf, pdf_sha256 FROM gaona_mensajeria.documentos
          WHERE solicitud_id = ${solicitud} AND estado = 'disponible' AND retener_hasta > now()`;
        if (!filas[0]) return null;
        const pdf = Buffer.from(filas[0].pdf);
        if (createHash("sha256").update(pdf).digest("hex") !== filas[0].pdf_sha256) throw new Error("Documento canónico no verificable");
        return pdf;
      }
      const filas = await prisma.$queryRaw<{ pdf: Uint8Array | null; pdf_sha256: string | null }[]>`SELECT pdf, pdf_sha256 FROM gaona_mensajeria.envios
        WHERE solicitud_id = ${solicitud} AND canal = 'whatsapp'`;
      const fila = filas[0];
      if (!fila?.pdf) return null;
      const pdf = Buffer.from(fila.pdf);
      if (createHash("sha256").update(pdf).digest("hex") !== fila.pdf_sha256) throw new Error("PDF persistente no verificable");
      return pdf;
    },
    async evento(evento) {
      await prisma.$transaction(async tx => {
        const filas = await tx.$queryRaw<Fila[]>`SELECT id, destinatario, destinatario_proveedor, estado, mensaje_id, actualizado_en FROM gaona_mensajeria.envios
          WHERE ((${evento.correlacion ?? ""} <> '' AND id::text = ${evento.correlacion ?? ""}) OR (${evento.correlacion ?? ""} = '' AND mensaje_id = ${evento.mensaje})) AND canal = 'whatsapp' FOR UPDATE`;
        const fila = filas[0];
        if (!fila || (fila.mensaje_id && fila.mensaje_id !== evento.mensaje) ||
          ((fila.destinatario_proveedor ?? fila.destinatario) !== evento.destinatario && (!evento.correlacion || evento.correlacion !== fila.id || Boolean(fila.mensaje_id))) ||
          !["enviando", "no_confirmado", "aceptado", "enviado", "entregado", "leido", "error"].includes(fila.estado)) return;
        const nuevos = await tx.$queryRaw<{ envio_id: string }[]>`INSERT INTO gaona_mensajeria.eventos (envio_id, mensaje_id, estado, fecha_proveedor)
          VALUES (${fila.id}::uuid, ${evento.mensaje}, ${evento.estado}, ${evento.fecha}::timestamptz)
          ON CONFLICT DO NOTHING RETURNING envio_id`;
        if (!nuevos.length) return;
        const orden: Record<string, number> = { enviado: 1, entregado: 2, leido: 3 };
        const anterior = orden[fila.estado] ?? 0;
        const siguiente = orden[evento.estado] ?? 0;
        if ((siguiente > anterior && !(fila.estado === "error" && evento.estado === "enviado")) || (evento.estado === "error" && anterior < 2)) {
          await tx.$executeRaw`UPDATE gaona_mensajeria.envios SET estado = ${evento.estado}, mensaje_id = ${evento.mensaje}, destinatario_proveedor = ${evento.destinatario}, actualizado_en = now()
            WHERE id = ${fila.id}::uuid`;
        }
      });
    },
  };
}
