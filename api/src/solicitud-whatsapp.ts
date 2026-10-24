import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import { LIMITE_PDF_BYTES } from "./solicitud-documento";

export const CONSENTIMIENTO_WHATSAPP = "Acepto recibir mi solicitud de cotización en PDF mediante WhatsApp al número proporcionado.";
export const VERSION_CONSENTIMIENTO_WHATSAPP = "gaona-whatsapp-pdf-v1";
export type EstadoWhatsapp = "sin_consentimiento" | "no_disponible" | "limitado" | "pendiente" | "aceptado" | "enviado" | "entregado" | "leido" | "error" | "no_confirmado";
export type EventoWhatsapp = { correlacion?: string; mensaje: string; destinatario: string; estado: "enviado" | "entregado" | "leido" | "error"; fecha: string };
export type RegistroWhatsapp = { comprobante: ComprobanteSolicitud; repetido: boolean };
export type TrabajoWhatsapp = { id: string; destinatario: string };
export interface AlmacenWhatsapp {
  disponible(): Promise<boolean>;
  registrar(clave: string, huella: string, consentimiento: boolean, destinatario: string | null, crear: (tx: Prisma.TransactionClient) => Promise<ComprobanteSolicitud>): Promise<RegistroWhatsapp>;
  reclamar(solicitud: string): Promise<TrabajoWhatsapp | null>;
  guardarPdf(id: string, pdf: Buffer): Promise<void>;
  iniciarEnvio(id: string, media: string): Promise<boolean>;
  finalizar(id: string, estado: "aceptado" | "error" | "no_confirmado", mensaje?: string, destinatarioProveedor?: string): Promise<void>;
  estado(solicitud: string): Promise<EstadoWhatsapp>;
  pdf(solicitud: string): Promise<Buffer | null>;
  evento(evento: EventoWhatsapp): Promise<void>;
}

export function normalizarTelefonoWhatsapp(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\+[\d ()-]+$/.test(valor.trim())) return null;
  const numero = valor.trim().replace(/[ ()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(numero) ? numero : null;
}

export function configurarWhatsapp(env: NodeJS.ProcessEnv) {
  if (env.WHATSAPP_STORAGE !== "postgres") return null;
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: numeroId, WHATSAPP_BUSINESS_ACCOUNT_ID: cuentaId,
    WHATSAPP_GRAPH_VERSION: version, WHATSAPP_TEMPLATE_NAME: plantilla, WHATSAPP_TEMPLATE_LANGUAGE: idioma,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: verificar, WHATSAPP_APP_SECRET: secreto, WHATSAPP_IDEMPOTENCY_KEY: clave } = env;
  if (!token || token.length > 4096 || /[\s\x00]/.test(token) || !/^\d{5,30}$/.test(numeroId ?? "") ||
    !/^\d{5,30}$/.test(cuentaId ?? "") || !/^v\d{1,3}\.0$/.test(version ?? "") ||
    !/^[a-z][a-z\d_]{0,99}$/.test(plantilla ?? "") || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(idioma ?? "") ||
    !verificar || verificar.length < 16 || verificar.length > 256 || /[\r\n\x00]/.test(verificar) ||
    !/^[a-f\d]{32}$/i.test(secreto ?? "") || !/^[a-f\d]{64}$/i.test(clave ?? "") ||
    !["test", "production"].includes(env.WHATSAPP_MODE ?? "")) return null;
  const permitidos = (env.WHATSAPP_TEST_RECIPIENTS ?? "").split(",").filter(Boolean);
  if (env.WHATSAPP_MODE === "test" && (!permitidos.length || permitidos.length > 5 || permitidos.some(n => normalizarTelefonoWhatsapp(n) !== n))) return null;
  return { token: token!, numeroId: numeroId!, cuentaId: cuentaId!, version: version!, plantilla: plantilla!, idioma: idioma!,
    verificar, secreto: secreto!, clave: clave!, modo: env.WHATSAPP_MODE, permitidos };
}
export type ConfiguracionWhatsapp = NonNullable<ReturnType<typeof configurarWhatsapp>>;

class ErrorMeta extends Error {
  constructor(readonly incierto: boolean) { super("No se pudo confirmar la operación de WhatsApp"); }
}
export function crearClienteMeta(config: ConfiguracionWhatsapp, pedir: typeof fetch = fetch, plazo = 10000) {
  const solicitar = async (ruta: string, datos: BodyInit) => {
    try {
      const respuesta = await pedir(`https://graph.facebook.com/${config.version}/${ruta}`, {
        method: "POST", headers: { Authorization: `Bearer ${config.token}`, ...(typeof datos === "string" ? { "Content-Type": "application/json" } : {}) },
        body: datos, signal: AbortSignal.timeout(plazo), redirect: "error",
      });
      if (!respuesta.ok) {
        await respuesta.body?.cancel().catch(() => {});
        throw new ErrorMeta(respuesta.status >= 500);
      }
      const lector = respuesta.body?.getReader();
      if (!lector) throw new ErrorMeta(true);
      const partes: Buffer[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await lector.read();
          if (done) break;
          total += value.length;
          if (total > 65536) { await lector.cancel(); throw new ErrorMeta(true); }
          partes.push(Buffer.from(value));
        }
      } finally { lector.releaseLock(); }
      return JSON.parse(Buffer.concat(partes).toString()) as Record<string, unknown>;
    } catch (error) {
      throw error instanceof ErrorMeta ? error : new ErrorMeta(true);
    }
  };
  return {
    async subir(pdf: Buffer, nombre: string) {
      if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") throw new ErrorMeta(false);
      const datos = new FormData();
      datos.set("messaging_product", "whatsapp");
      datos.set("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), nombre);
      const respuesta = await solicitar(`${config.numeroId}/media`, datos);
      if (typeof respuesta.id !== "string" || !/^\d{1,80}$/.test(respuesta.id)) throw new ErrorMeta(true);
      return respuesta.id;
    },
    async enviar(media: string, destinatario: string, folio: string, correlacion: string) {
      const respuesta = await solicitar(`${config.numeroId}/messages`, JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: destinatario.slice(1), type: "template",
        biz_opaque_callback_data: correlacion,
        template: { name: config.plantilla, language: { code: config.idioma }, components: [
          { type: "header", parameters: [{ type: "document", document: { id: media, filename: `GAONA-Solicitud-${folio}.pdf` } }] },
          { type: "body", parameters: [{ type: "text", text: folio.slice(0, 8).toUpperCase() }] },
        ] },
      }));
      const mensajes = respuesta.messages as { id?: unknown }[] | undefined;
      const id = mensajes?.[0]?.id;
      if (typeof id !== "string" || !/^wamid\.[\w+/=.-]{1,500}$/.test(id)) throw new ErrorMeta(true);
      const contactos = respuesta.contacts as { wa_id?: unknown }[] | undefined;
      const receptor = contactos?.[0]?.wa_id;
      if (receptor !== undefined && (typeof receptor !== "string" || !/^[1-9]\d{7,14}$/.test(receptor))) throw new ErrorMeta(true);
      return { id, destinatarioProveedor: typeof receptor === "string" ? `+${receptor}` : destinatario };
    },
  };
}

export function firmaWhatsappValida(cuerpo: Buffer, firma: unknown, secreto: string) {
  if (typeof firma !== "string" || !/^sha256=[a-f\d]{64}$/.test(firma)) return false;
  return timingSafeEqual(createHmac("sha256", secreto).update(cuerpo).digest(), Buffer.from(firma.slice(7), "hex"));
}

export function crearServicioWhatsapp(env: NodeJS.ProcessEnv = process.env, almacen?: AlmacenWhatsapp, pedir: typeof fetch = fetch) {
  const config = configurarWhatsapp(env);
  const cliente = config ? crearClienteMeta(config, pedir) : null;
  const conectado = async () => Boolean(config && almacen && await almacen.disponible().catch(() => false));
  const habilitado = env.WHATSAPP_ENABLED === "true";
  const activo = async () => habilitado && await conectado();
  return {
    config,
    async registrar(clave: string | undefined, datos: unknown, consentimiento: boolean, telefono: string, crear: (tx: Prisma.TransactionClient) => Promise<ComprobanteSolicitud>) {
      if (!config || !almacen) return null;
      if (!await conectado()) {
        if (habilitado) throw new Error("La persistencia de solicitudes no está disponible");
        return null;
      }
      const huella = createHmac("sha256", Buffer.from(config.clave, "hex")).update(JSON.stringify(datos)).digest("hex");
      const id = createHmac("sha256", Buffer.from(config.clave, "hex")).update(clave ?? `datos:${huella}`).digest("hex");
      return almacen.registrar(id, huella, consentimiento, normalizarTelefonoWhatsapp(telefono), crear);
    },
    async enviar(datos: ComprobanteSolicitud, consentimiento: boolean, obtenerPdf: () => Promise<Buffer>): Promise<{ estado: EstadoWhatsapp }> {
      if (!consentimiento) return { estado: "sin_consentimiento" };
      if (!await activo() || !config || !cliente || !almacen) return { estado: "no_disponible" };
      const destinatario = normalizarTelefonoWhatsapp(datos.cliente.telefono);
      if (!destinatario || (config.modo === "test" && !config.permitidos.includes(destinatario))) return { estado: "no_disponible" };
      let trabajo: TrabajoWhatsapp | null = null;
      let enviando = false;
      try {
        trabajo = await almacen.reclamar(datos.id);
        if (!trabajo) return { estado: await almacen.estado(datos.id) };
        if (trabajo.destinatario !== destinatario) throw new ErrorMeta(false);
        const pdf = await obtenerPdf();
        await almacen.guardarPdf(trabajo.id, pdf);
        const media = await cliente.subir(pdf, `GAONA-Solicitud-${datos.id}.pdf`);
        if (!await almacen.iniciarEnvio(trabajo.id, media)) return { estado: await almacen.estado(datos.id) };
        enviando = true;
        const mensaje = await cliente.enviar(media, destinatario, datos.id, trabajo.id);
        await almacen.finalizar(trabajo.id, "aceptado", mensaje.id, mensaje.destinatarioProveedor);
        return { estado: await almacen.estado(datos.id) };
      } catch (error) {
        const estado = enviando && (!(error instanceof ErrorMeta) || error.incierto) ? "no_confirmado" : "error";
        if (trabajo) await almacen.finalizar(trabajo.id, estado).catch(() => {});
        return { estado };
      }
    },
    async estado(solicitud: string, telefono?: string): Promise<EstadoWhatsapp> {
      if (!await conectado() || !almacen) return "no_disponible";
      const estado = await almacen.estado(solicitud);
      const fueraDePrueba = config?.modo === "test" && telefono !== undefined && !config.permitidos.includes(normalizarTelefonoWhatsapp(telefono) ?? "");
      return estado === "pendiente" && (!habilitado || fueraDePrueba) ? "no_disponible" : estado;
    },
    async pdf(solicitud: string) {
      if (!await conectado() || !almacen) return null;
      return almacen.pdf(solicitud);
    },
    async evento(evento: EventoWhatsapp) {
      if (!await conectado() || !almacen) return false;
      await almacen.evento(evento);
      return true;
    },
  };
}
