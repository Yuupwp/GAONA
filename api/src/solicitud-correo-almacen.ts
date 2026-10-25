import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { EstadoCorreo } from "./solicitud-correo";

export type TrabajoCorreo = { solicitud_id: string; destinatario: string; mensaje_id: string; reserva: string };
export type CierreCorreo = { estado: EstadoCorreo; codigo?: string; proveedor?: string; respuesta?: number };
export interface AlmacenCorreo {
  estado(solicitud: string): Promise<EstadoCorreo>;
  reclamar(solicitud: string): Promise<TrabajoCorreo | null>;
  iniciar(trabajo: TrabajoCorreo, sha: string): Promise<boolean>;
  finalizar(trabajo: TrabajoCorreo, resultado: CierreCorreo): Promise<void>;
}

export function crearAlmacenCorreo(db: PrismaClient): AlmacenCorreo {
  const recuperar = async (solicitud: string) => {
    await db.$executeRaw`UPDATE gaona_mensajeria.correos SET estado = 'no_confirmado', codigo_error = 'PROCESO_INTERRUMPIDO', actualizado_en = now()
      WHERE solicitud_id = ${solicitud} AND estado IN ('preparando','enviando') AND vence_reserva <= now()`;
  };
  return {
    async estado(solicitud) {
      await recuperar(solicitud);
      const filas = await db.$queryRaw<{ estado: string }[]>`SELECT estado FROM gaona_mensajeria.correos WHERE solicitud_id = ${solicitud}`;
      if (["preparando", "enviando"].includes(filas[0]?.estado)) return "pendiente";
      return filas[0]?.estado as EstadoCorreo ?? "no_confirmado";
    },
    async reclamar(solicitud) {
      await recuperar(solicitud);
      const reserva = randomUUID();
      const filas = await db.$queryRaw<TrabajoCorreo[]>`UPDATE gaona_mensajeria.correos
        SET estado = 'preparando', reserva = ${reserva}::uuid, vence_reserva = now() + interval '2 minutes', actualizado_en = now()
        WHERE solicitud_id = ${solicitud} AND estado = 'pendiente' AND intentos = 0
        RETURNING solicitud_id, destinatario, mensaje_id, reserva::text`;
      return filas[0] ?? null;
    },
    async iniciar(trabajo, sha) {
      const filas = await db.$queryRaw<{ solicitud_id: string }[]>`UPDATE gaona_mensajeria.correos c
        SET estado = 'enviando', intentos = 1, adjunto_sha256 = ${sha}, actualizado_en = now(), vence_reserva = now() + interval '2 minutes'
        WHERE c.solicitud_id = ${trabajo.solicitud_id} AND c.reserva = ${trabajo.reserva}::uuid
          AND c.estado = 'preparando' AND c.intentos = 0 AND c.vence_reserva > now()
          AND EXISTS (SELECT 1 FROM gaona_mensajeria.documentos d WHERE d.solicitud_id = c.solicitud_id
            AND d.estado = 'disponible' AND d.pdf_sha256 = ${sha} AND d.retener_hasta > now())
        RETURNING c.solicitud_id`;
      return filas.length === 1;
    },
    async finalizar(trabajo, resultado) {
      const codigo = resultado.codigo ?? null;
      await db.$executeRaw`UPDATE gaona_mensajeria.correos SET estado = ${resultado.estado}, codigo_error = ${codigo},
        proveedor_id = COALESCE(proveedor_id, ${resultado.proveedor ?? null}), respuesta_smtp = ${resultado.respuesta ?? null}, actualizado_en = now()
        WHERE solicitud_id = ${trabajo.solicitud_id} AND reserva = ${trabajo.reserva}::uuid
          AND estado IN ('preparando','enviando','no_confirmado')`;
    },
  };
}
