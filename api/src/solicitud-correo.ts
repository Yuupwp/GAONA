import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import { LIMITE_PDF_BYTES } from "./solicitud-documento";
import { crearLimiteFrecuencia } from "./solicitud-controles";
import { createHash } from "node:crypto";
import type { AlmacenCorreo, TrabajoCorreo, CierreCorreo } from "./solicitud-correo-almacen";
import { correoValido as email } from "./solicitud-correo-validacion";
import { crearPlantillaCorreo } from "./solicitud-correo-plantilla";

export type EstadoCorreo = "pendiente" | "sin_correo" | "no_disponible" | "limitado" | "error_pdf" | "error" | "no_confirmado" | "aceptado";
export type ResultadoCorreo = { estado: EstadoCorreo };
type Transporte = {
  sendMail: (mensaje: SendMailOptions) => Promise<{ accepted?: unknown[]; rejected?: unknown[]; messageId?: unknown; response?: unknown }>;
  close: () => void;
};
type Fabrica = (opciones: SMTPTransport.Options) => Transporte;

export function configurarSmtp(env: NodeJS.ProcessEnv) {
  if (env.MAIL_ENABLED !== "true") return null;
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: pass, SMTP_FROM: from } = env;
  if (!host || !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host) ||
    !user || user.length > 320 || /[\r\n\x00]/.test(user) || !pass || pass.length > 2048 ||
    !email.safeParse(from).success || !/^(true|false)$/.test(env.SMTP_SECURE ?? "") ||
    !/^\d{1,5}$/.test(env.SMTP_PORT ?? "")) return null;
  const port = Number(env.SMTP_PORT);
  const secure = env.SMTP_SECURE === "true";
  if (port < 1 || port > 65535 || (port === 465 && !secure)) return null;
  const opciones: SMTPTransport.Options = {
    host, port, secure, requireTLS: !secure,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user, pass },
    connectionTimeout: 5000, greetingTimeout: 5000, dnsTimeout: 5000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
  return { opciones, from: from! };
}

export function crearServicioCorreo(
  env: NodeJS.ProcessEnv = process.env,
  fabrica: Fabrica = opciones => nodemailer.createTransport(opciones),
  ahora = Date.now,
  plazo = 25000,
  almacen?: AlmacenCorreo
) {
  const configuracion = env.NODE_ENV === "production" ? null : configurarSmtp(env);
  const permitir = crearLimiteFrecuencia(ahora);
  const intentos = new Map<string, { huella: string; pendiente: Promise<ResultadoCorreo>; resultado?: ResultadoCorreo }>();
  const huella = (datos: ComprobanteSolicitud) => createHash("sha256").update(JSON.stringify(datos)).digest("hex");
  let activos = 0;
  const intentar = async (datos: ComprobanteSolicitud, ip: string, obtenerPdf: () => Promise<Buffer>, trabajo?: TrabajoCorreo, cierre?: Partial<CierreCorreo>): Promise<ResultadoCorreo> => {
    if (!datos.cliente.correo) return { estado: "sin_correo" };
    if (!configuracion) return { estado: "no_disponible" };
    if (activos >= 2 || !permitir([
      { clave: `correo:${datos.cliente.correo.toLowerCase()}`, maximo: 3, periodo: 60 * 60 * 1000 },
      { clave: `ip:${ip}`, maximo: 5, periodo: 60 * 60 * 1000 },
      { clave: "global", maximo: 30, periodo: 60 * 60 * 1000 },
    ])) return { estado: "limitado" };
    activos++;
    let transporte: Transporte | undefined;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let envio: ReturnType<Transporte["sendMail"]> | undefined;
    try {
      let pdf: Buffer;
      try {
        pdf = await obtenerPdf();
        if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") return { estado: "error_pdf" };
      } catch {
        return { estado: "error_pdf" };
      }
      const folio = datos.id;
      const mensaje: SendMailOptions = {
        from: { name: "Equipo GAONA", address: configuracion.from },
        to: { address: datos.cliente.correo, name: "" },
        envelope: { from: configuracion.from, to: [datos.cliente.correo] },
        messageId: trabajo?.mensaje_id ?? `<solicitud-${folio}@${configuracion.from.split("@")[1]}>`,
        subject: `GAONA | Solicitud de cotización - ${folio}`,
        ...crearPlantillaCorreo(datos),
        attachments: [{ filename: `GAONA-Solicitud-${folio}.pdf`, content: pdf, contentType: "application/pdf" }],
        disableFileAccess: true, disableUrlAccess: true,
      };
      if (trabajo && almacen && !await almacen.iniciar(trabajo, createHash("sha256").update(pdf).digest("hex"))) return { estado: "no_confirmado" };
      transporte = fabrica(configuracion.opciones);
      envio = transporte.sendMail(mensaje);
      const resultado = await Promise.race([
        envio,
        new Promise<never>((_, reject) => {
          temporizador = setTimeout(() => reject(Object.assign(new Error("Tiempo de envío agotado"), { code: "ETIMEDOUT" })), plazo);
        }),
      ]);
      const aceptado = resultado.accepted?.some(destino => typeof destino === "string" && destino.toLowerCase() === datos.cliente.correo!.toLowerCase());
      if (cierre) {
        if (typeof resultado.messageId === "string" && resultado.messageId.length <= 255 && !/[\r\n\x00]/.test(resultado.messageId)) cierre.proveedor = resultado.messageId;
        const respuesta = typeof resultado.response === "string" ? Number(resultado.response.match(/^([2-5]\d{2})\b/)?.[1]) : NaN;
        if (Number.isInteger(respuesta)) cierre.respuesta = respuesta;
      }
      return { estado: aceptado && !resultado.rejected?.length ? "aceptado" : "error" };
    } catch (error) {
      const codigo = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
      if (cierre) cierre.codigo = codigo && ["EAUTH", "ECONNECTION", "ESOCKET", "ETIMEDOUT", "EDNS", "ETLS", "EENVELOPE", "EMESSAGE"].includes(codigo) ? codigo : "OTRO";
      return { estado: codigo && ["EAUTH", "ECONNECTION", "EDNS", "ETLS", "EENVELOPE"].includes(codigo) ? "error" : "no_confirmado" };
    } finally {
      if (temporizador) clearTimeout(temporizador);
      try { transporte?.close(); } catch {}
      if (envio) envio.then(() => { activos--; }, () => { activos--; });
      else activos--;
    }
  };
  const estadoDurable = async (datos: ComprobanteSolicitud): Promise<ResultadoCorreo> => {
    if (!datos.cliente.correo) return { estado: "sin_correo" };
    const estado = await almacen!.estado(datos.id);
    return { estado: estado === "pendiente" && !configuracion ? "no_disponible" : estado };
  };
  const procesarDurable = async (datos: ComprobanteSolicitud, ip: string, obtenerPdf: () => Promise<Buffer>): Promise<ResultadoCorreo> => {
    let trabajo: TrabajoCorreo | null = null;
    try {
      if (!configuracion) return await estadoDurable(datos);
      trabajo = await almacen!.reclamar(datos.id);
      if (!trabajo) return await estadoDurable(datos);
      if (trabajo.destinatario !== datos.cliente.correo) throw new Error("Destinatario incompatible");
      const cierre: Partial<CierreCorreo> = {};
      const resultado = await intentar(datos, ip, obtenerPdf, trabajo, cierre);
      await almacen!.finalizar(trabajo, { ...cierre, estado: resultado.estado });
      return resultado;
    } catch {
      if (trabajo) await almacen!.finalizar(trabajo, { estado: "no_confirmado", codigo: "OTRO" }).catch(() => {});
      return { estado: "no_confirmado" };
    }
  };
  const enviar = (datos: ComprobanteSolicitud, ip: string, obtenerPdf: () => Promise<Buffer>): Promise<ResultadoCorreo> => {
    if (!datos.cliente.correo) return Promise.resolve({ estado: "sin_correo" });
    if (!email.safeParse(datos.cliente.correo).success || !/^[a-z\d-]{1,80}$/i.test(datos.id)) return Promise.resolve({ estado: "error" });
    if (almacen) return procesarDurable(datos, ip, obtenerPdf);
    if (!configuracion) return Promise.resolve({ estado: "no_disponible" });
    const firma = huella(datos);
    const existente = intentos.get(datos.id);
    if (existente) return existente.huella === firma ? existente.pendiente : Promise.resolve({ estado: "no_confirmado" });
    if (intentos.size >= 2000) return Promise.resolve({ estado: "limitado" });
    const entrada: { huella: string; pendiente: Promise<ResultadoCorreo>; resultado?: ResultadoCorreo } = {
      huella: firma, pendiente: Promise.resolve().then(() => intentar(datos, ip, obtenerPdf)).catch(() => ({ estado: "no_confirmado" as const })).then(resultado => {
        entrada.resultado = resultado;
        return resultado;
      }),
    };
    intentos.set(datos.id, entrada);
    return entrada.pendiente;
  };
  const estado = (datos: ComprobanteSolicitud): ResultadoCorreo | Promise<ResultadoCorreo> => {
    if (almacen) return estadoDurable(datos);
    if (!datos.cliente.correo) return { estado: "sin_correo" };
    if (!configuracion) return { estado: "no_disponible" };
    const entrada = intentos.get(datos.id);
    if (!entrada || entrada.huella !== huella(datos)) return { estado: "no_confirmado" };
    return entrada.resultado ?? { estado: "pendiente" };
  };
  return Object.assign(enviar, { estado, iniciar(datos: ComprobanteSolicitud, ip: string, obtenerPdf: () => Promise<Buffer>) {
    if (!intentos.has(datos.id) && intentos.size >= 2000) return { estado: "limitado" as const };
    void enviar(datos, ip, obtenerPdf);
    return estado(datos);
  } });
}
