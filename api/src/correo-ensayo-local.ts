import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";
import type { EnsayoCorreo } from "./api-web";
import type { ComprobanteSolicitud } from "./solicitud-estimado";
import type { RequestHandler } from "express";

type Modo = "simulado" | "smtp";
export type ConfiguracionEnsayo = { version: 1; habilitado: false; remitente: string; destinatarios: string[] };
const direccion = z.email().max(150).refine(v => !/[\r\n\x00]/.test(v));
const fallar = () => { throw Error("Ensayo local rechazado"); };

export function guardiaOrigenEnsayo(real: boolean): RequestHandler {
  return (req, res, next) => {
    if (real && req.method !== "GET" && req.get("Origin") !== "http://127.0.0.1:5500") {
      res.status(403).json({ error: "Origen no autorizado para el ensayo local" }); return;
    }
    next();
  };
}

export function validarConfiguracionEnsayo(value: unknown): ConfiguracionEnsayo {
  const r = z.object({ version: z.literal(1), habilitado: z.literal(false), remitente: z.literal("gaona.proyint1@gmail.com"),
    destinatarios: z.array(direccion).min(1).max(3) }).strict().safeParse(value);
  if (!r.success || new Set(r.data.destinatarios).size !== r.data.destinatarios.length) return fallar();
  return r.data;
}

export function leerPrivado(directorio: string, nombre: string): Buffer {
  const fd = openSync(join(directorio, nombre), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid?.() || (s.mode & 0o077)) return fallar();
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function guardar(directorio: string, nombre: string, value: string | Buffer) {
  const fd = openSync(join(directorio, nombre), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directorio, constants.O_RDONLY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

export function crearEnsayoCorreoLocal(directorio: string, modo: Modo, configuracion?: ConfiguracionEnsayo,
  crearTransporte = (opciones: SMTPTransport.Options) => nodemailer.createTransport(opciones), sesion?: string) {
  if (sesion && !/^[a-f\d-]{36}$/.test(sesion)) return fallar();
  const config = configuracion ? validarConfiguracionEnsayo(configuracion) : undefined;
  if (modo === "smtp" && !config) return fallar();
  const permitidos = new Set(config?.destinatarios);
  const permitir = (correo?: string) => !config || !!correo && permitidos.has(correo);
  const leerOrigen = (id: string): { modo: Modo; correo?: string; sesion?: string } | undefined => {
    if (!/^[a-f\d-]{36}$/.test(id)) return fallar();
    try {
      const r = JSON.parse(leerPrivado(directorio, `origen-correo-${id}.json`).toString());
      if (r.id !== id || !["simulado", "smtp"].includes(r.modo) || (r.correo && !direccion.safeParse(r.correo).success)) return fallar();
      return r;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { leerPrivado(directorio, `correo-simulado-${id}.eml`); return { modo: "simulado" }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  };
  const politica: EnsayoCorreo = {
    permitir,
    async registrar(datos: ComprobanteSolicitud, nuevo) {
      let origen = leerOrigen(datos.id);
      if (!origen && nuevo) {
        guardar(directorio, `origen-correo-${datos.id}.json`, JSON.stringify({ id: datos.id, modo, correo: datos.cliente.correo, sesion }));
        origen = leerOrigen(datos.id);
      }
      return origen?.modo === modo && origen.correo === datos.cliente.correo && (!sesion || origen.sesion === sesion) && permitir(datos.cliente.correo);
    },
    async presentar(datos, resultado) {
      const origen = leerOrigen(datos.id);
      if (origen?.modo === "simulado") return { estado: resultado.estado === "aceptado" ? "simulado" : resultado.estado, modo: "simulado" };
      if (origen?.modo === "smtp") return { ...resultado, modo: "smtp" };
      return { estado: ["aceptado", "pendiente"].includes(resultado.estado) ? "no_confirmado" : resultado.estado, modo: "desconocido" };
    },
  };
  const fabrica = (opciones: SMTPTransport.Options) => {
    let close = () => {};
    return {
      async sendMail(mensaje: SendMailOptions) {
        const id = typeof mensaje.messageId === "string" ? mensaje.messageId.match(/^<solicitud-([a-f\d-]{36})@/)?.[1] : undefined;
        const to = typeof mensaje.to === "object" && !Array.isArray(mensaje.to) ? mensaje.to?.address : undefined;
        const from = typeof mensaje.from === "object" && !Array.isArray(mensaje.from) ? mensaje.from.address : undefined;
        const origen = id ? leerOrigen(id) : undefined;
        if (!id || !to || !permitir(to) || origen?.modo !== modo || origen.correo !== to || (sesion && origen.sesion !== sesion) || mensaje.cc || mensaje.bcc || mensaje.replyTo ||
          JSON.stringify(mensaje.envelope) !== JSON.stringify({ from, to: [to] }) ||
          mensaje.attachments?.length !== 1 || !Buffer.isBuffer(mensaje.attachments[0].content)) return fallar();
        if (modo === "simulado") {
          const stream = nodemailer.createTransport({ streamTransport: true, buffer: true }); close = () => stream.close();
          const info = await stream.sendMail(mensaje);
          if (!Buffer.isBuffer(info.message)) return fallar();
          guardar(directorio, `correo-simulado-${id}.eml`, info.message);
          return { accepted: info.envelope.to, rejected: [], messageId: info.messageId };
        }
        if (from !== config!.remitente || opciones.host !== "smtp-relay.brevo.com" || opciones.port !== 587 || opciones.secure !== false ||
          opciones.requireTLS !== true || opciones.tls?.rejectUnauthorized !== true || opciones.debug || opciones.logger) return fallar();
        guardar(directorio, `intento-smtp-${id}.json`, JSON.stringify({ id, maximo: 1, creado: new Date().toISOString(), modo }));
        if (sesion) guardar(directorio, `sesion-smtp-${sesion}.json`, JSON.stringify({ solicitud: id, maximo: 1 }));
        const options = { ...opciones, dnsTimeout: 10000, connectionTimeout: 15000 };
        const transporte = crearTransporte(options); close = () => transporte.close();
        const { observarTransporte } = require("../scripts/brevo-diagnostico.cjs");
        const observado = observarTransporte(transporte, options, to, () => {}, (diagnostico: { estado: string }) =>
          guardar(directorio, `diagnostico-${diagnostico.estado === "iniciado" ? "inicio" : "fin"}-${id}.json`, JSON.stringify(diagnostico)));
        return observado.transporte.sendMail(mensaje);
      },
      close() { close(); },
    };
  };
  return { politica, fabrica };
}
