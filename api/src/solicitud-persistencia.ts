import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import { generarSolicitudPdf } from "./solicitud-pdf";
import { LIMITE_PDF_BYTES } from "./solicitud-documento";
import { crearAlmacenCorreo } from "./solicitud-correo-almacen";
import { configurarSmtp } from "./solicitud-correo";
import { configurarWhatsapp, normalizarTelefonoWhatsapp } from "./solicitud-whatsapp";
import { reservarEnvioWhatsapp } from "./solicitud-whatsapp-almacen";
import { ErrorSolicitud, type DatosSolicitud } from "./solicitud-registro";

export const serializarSolicitud = (valor: unknown) => JSON.stringify(valor, (_clave, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Registro = { solicitud_id: string | null; huella: string; comprobante: ComprobanteSolicitud | null; retener_hasta: Date };
type Documento = { comprobante: ComprobanteSolicitud; estado: string | null; pdf: Uint8Array | null; pdf_sha256: string | null; retener_hasta: Date; intentos: number };

export function crearPersistenciaSolicitudes(db: PrismaClient, env: NodeJS.ProcessEnv = process.env, generar = generarSolicitudPdf) {
  const activa = (env.SOLICITUD_STORAGE ?? "memory") !== "memory" || env.NODE_ENV === "production";
  const configurada = env.SOLICITUD_STORAGE === "postgres" && /^[a-f\d]{64}$/i.test(env.SOLICITUD_IDEMPOTENCY_KEY ?? "") && /^[a-f\d]{64}$/i.test(env.SOLICITUD_PDF_KEY ?? "");
  const hmac = (valor: string) => createHmac("sha256", Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY!, "hex")).update(valor).digest("hex");
  const correoActivo = env.NODE_ENV !== "production" && configurarSmtp(env) !== null;
  const whatsappConfigurado = configurarWhatsapp(env) !== null;
  const correo = crearAlmacenCorreo(db);
  const disponible = async () => {
    if (!configurada) return false;
    try {
      const filas = await db.$queryRaw<{ version: number; idempotencia_huella: string | null; acceso_huella: string | null; legado_huella: string | null; legado: boolean }[]>`
        SELECT version, idempotencia_huella, acceso_huella, legado_huella,
          EXISTS (SELECT 1 FROM gaona_mensajeria.registros_web WHERE version_operacion = 1) AS legado
        FROM gaona_mensajeria.configuracion WHERE id = 1`;
      const legado = !filas[0]?.legado || /^[a-f\d]{64}$/i.test(env.WHATSAPP_IDEMPOTENCY_KEY ?? "") && filas[0].legado_huella === hash(Buffer.from(env.WHATSAPP_IDEMPOTENCY_KEY!, "hex"));
      return legado && filas[0]?.version === 2 && filas[0].idempotencia_huella === hash(Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY!, "hex")) &&
        filas[0].acceso_huella === hash(Buffer.from(env.SOLICITUD_PDF_KEY!, "hex"));
    } catch { return false; }
  };
  return {
    activa, correo, disponible,
    async registrar(clave: string | undefined, datos: DatosSolicitud, crear: (tx: Prisma.TransactionClient) => Promise<ComprobanteSolicitud>, ip = "desconocida") {
      if (typeof clave !== "string" || !/^[\w-]{16,80}$/.test(clave)) throw new ErrorSolicitud(400, "CLAVE_INVALIDA", "Se requiere un identificador válido para este intento");
      if (!await disponible()) throw new ErrorSolicitud(503, "PERSISTENCIA_NO_DISPONIBLE", "El registro persistente no está disponible. No se ha iniciado un registro nuevo.");
      const id = hmac(`solicitud:${clave}`), huella = hmac(`contenido:${serializarSolicitud(datos)}`);
      return db.$transaction(async tx => {
        if (/^[a-f\d]{64}$/i.test(env.WHATSAPP_IDEMPOTENCY_KEY ?? "")) {
          const legacy = (valor: string) => createHmac("sha256", Buffer.from(env.WHATSAPP_IDEMPOTENCY_KEY!, "hex")).update(valor).digest("hex");
          const anteriores = await tx.$queryRaw<Registro[]>`SELECT solicitud_id, huella, comprobante, retener_hasta FROM gaona_mensajeria.registros_web WHERE clave = ${legacy(clave)}`;
          if (anteriores[0]) {
            if (anteriores[0].huella !== legacy(JSON.stringify(datos))) throw new ErrorSolicitud(409, "CLAVE_CONFLICTO", "El identificador anterior está asociado a otros datos.");
            if (!anteriores[0].comprobante || anteriores[0].retener_hasta.getTime() <= Date.now()) throw new ErrorSolicitud(410, "COMPROBANTE_EXPIRADO", "La solicitud anterior sigue registrada; no vuelvas a registrarla.", anteriores[0].solicitud_id ?? undefined);
            return { comprobante: anteriores[0].comprobante, repetido: true };
          }
        }
        const origen = hmac(`origen:${ip}`);
        const nuevas = await tx.$queryRaw<{ clave: string }[]>`INSERT INTO gaona_mensajeria.registros_web (clave, huella, origen_huella, version_operacion)
          VALUES (${id}, ${huella}, ${origen}, 2) ON CONFLICT (clave) DO NOTHING RETURNING clave`;
        if (!nuevas.length) {
          const filas = await tx.$queryRaw<Registro[]>`SELECT solicitud_id, huella, comprobante, retener_hasta FROM gaona_mensajeria.registros_web WHERE clave = ${id}`;
          if (!filas[0] || filas[0].huella !== huella) throw new ErrorSolicitud(409, "CLAVE_CONFLICTO", "El identificador ya está asociado a otros datos. La solicitud original no se ha modificado.");
          if (!filas[0].comprobante || filas[0].retener_hasta.getTime() <= Date.now()) throw new ErrorSolicitud(410, "COMPROBANTE_EXPIRADO", "La solicitud sigue registrada. Su comprobante ya no está disponible; no vuelvas a registrarla.", filas[0].solicitud_id ?? undefined);
          return { comprobante: filas[0].comprobante, repetido: true };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(713428994)`;
        const cuotas = await tx.$queryRaw<{ total: bigint; origen: bigint }[]>`SELECT count(*) AS total,
          count(*) FILTER (WHERE origen_huella = ${origen}) AS origen FROM gaona_mensajeria.registros_web
          WHERE creado_en > now() - interval '15 minutes' AND solicitud_id IS NOT NULL`;
        if (Number(cuotas[0]?.total ?? 0) >= 100 || Number(cuotas[0]?.origen ?? 0) >= 10) throw new ErrorSolicitud(429, "LIMITE_REGISTROS", "Demasiadas solicitudes. Intenta más tarde con el mismo identificador.");
        const comprobante = await crear(tx);
        await tx.$executeRaw`UPDATE gaona_mensajeria.registros_web SET solicitud_id = ${comprobante.id}, comprobante = ${JSON.stringify(comprobante)}::jsonb, actualizado_en = now() WHERE clave = ${id}`;
        await tx.$executeRaw`INSERT INTO gaona_mensajeria.documentos (solicitud_id) VALUES (${comprobante.id})`;
        if (comprobante.cliente.correo) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(713428993)`;
          const conteo = await tx.$queryRaw<{ total: bigint; destinatario: bigint }[]>`SELECT count(*) AS total,
            count(*) FILTER (WHERE lower(destinatario) = lower(${comprobante.cliente.correo})) AS destinatario
            FROM gaona_mensajeria.correos WHERE creado_en > now() - interval '1 hour' AND estado NOT IN ('limitado','no_disponible')`;
          const limitado = Number(conteo[0]?.total ?? 0) >= 30 || Number(conteo[0]?.destinatario ?? 0) >= 3;
          const estado = !correoActivo ? "no_disponible" : limitado ? "limitado" : "pendiente";
          const dominio = configurarSmtp(env)?.from.split("@")[1] ?? "gaona.invalid";
          const mensaje = `<solicitud-${comprobante.id}@${dominio}>`;
          await tx.$executeRaw`INSERT INTO gaona_mensajeria.correos (solicitud_id, destinatario, autorizacion_texto, autorizacion_version, estado, mensaje_id)
            VALUES (${comprobante.id}, ${comprobante.cliente.correo}, 'Correo opcional proporcionado para recibir el PDF de la solicitud', 'gaona-correo-pdf-v1', ${estado}, ${mensaje})`;
        }
        if (whatsappConfigurado) await reservarEnvioWhatsapp(tx, comprobante, datos.whatsappConsentimiento, normalizarTelefonoWhatsapp(datos.cliente.telefono));
        return { comprobante, repetido: false };
      }, { maxWait: 10000, timeout: 15000 });
    },
    async documento(datos: ComprobanteSolicitud): Promise<Buffer | null> {
      for (let intento = 0; intento < 200; intento++) {
        const filas = await db.$queryRaw<Documento[]>`SELECT r.comprobante, d.estado, d.pdf, d.pdf_sha256, d.intentos, LEAST(r.retener_hasta, d.retener_hasta) AS retener_hasta
          FROM gaona_mensajeria.registros_web r LEFT JOIN gaona_mensajeria.documentos d ON d.solicitud_id = r.solicitud_id WHERE r.solicitud_id = ${datos.id}`;
        const fila = filas[0];
        if (!fila) return null;
        if (fila.retener_hasta.getTime() <= Date.now() || fila.estado === "expirado") throw new ErrorSolicitud(410, "PDF_EXPIRADO", "El documento ya no está disponible. La solicitud sigue registrada.");
        if (!fila.estado || !fila.comprobante) throw new Error("Documento persistente incompleto");
        if (fila.estado === "disponible") {
          const pdf = Buffer.from(fila.pdf!);
          if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-" || hash(pdf) !== fila.pdf_sha256) throw new Error("Integridad del documento no verificable");
          return pdf;
        }
        const reserva = randomUUID();
        const reclamados = await db.$queryRaw<{ solicitud_id: string }[]>`UPDATE gaona_mensajeria.documentos
          SET estado = 'generando', reserva = ${reserva}::uuid, vence_reserva = now() + interval '2 minutes', intentos = intentos + 1, actualizado_en = now(), codigo_error = NULL
          WHERE solicitud_id = ${datos.id} AND intentos < 3 AND retener_hasta > now()
            AND (estado IN ('pendiente','error') OR (estado = 'generando' AND vence_reserva <= now())) RETURNING solicitud_id`;
        if (reclamados.length) {
          try {
            const pdf = await generar(fila.comprobante);
            if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF no válido");
            const sha = hash(pdf);
            const guardados = await db.$queryRaw<{ solicitud_id: string }[]>`UPDATE gaona_mensajeria.documentos
              SET estado = 'disponible', pdf = ${pdf}, pdf_sha256 = ${sha}, actualizado_en = now(), codigo_error = NULL
              WHERE solicitud_id = ${datos.id} AND estado = 'generando' AND reserva = ${reserva}::uuid AND vence_reserva > now() RETURNING solicitud_id`;
            if (guardados.length) return pdf;
          } catch {
            await db.$executeRaw`UPDATE gaona_mensajeria.documentos SET estado = 'error', codigo_error = 'GENERACION_FALLIDA', actualizado_en = now()
              WHERE solicitud_id = ${datos.id} AND estado = 'generando' AND reserva = ${reserva}::uuid`;
            throw new Error("No se pudo preparar el documento persistente");
          }
        } else if (fila.estado === "error" && fila.intentos >= 3) throw new Error("Se requiere revisión de la generación del PDF");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("Documento en preparación; consulta más tarde");
    },
  };
}
