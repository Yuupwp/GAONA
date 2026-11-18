import nodemailer from "nodemailer";
import { configurarSmtp } from "./solicitud-correo";
import type { FabricaTransporte } from "./cotizacion-correo";

// Avisos al cliente sobre su pedido: confirmación con la fecha de entrega,
// cambios de estado y cambios de fecha. Usa el mismo SMTP que las cotizaciones.

export type EstadoPedido =
  | "EN_PROCESO"
  | "LISTO_PARA_INSTALAR"
  | "ENTREGADO"
  | "FACTURADO"
  | "CERRADO"
  | "CANCELADO";

export type CitaAviso = {
  tipo: "ENTREGA" | "INSTALACION";
  inicio: Date;
  fin: Date;
  direccion: string | null;
};

export type Aviso =
  | { tipo: "creado"; cita: CitaAviso | null }
  | { tipo: "estado"; estado: EstadoPedido; cita: CitaAviso | null }
  | { tipo: "fecha"; cita: CitaAviso };

export type DatosAviso = {
  folio: string;
  nombreCliente: string;
  aviso: Aviso;
};

// Lo que se le contesta a la app para que avise si el correo salió o no
export type ResultadoAviso = "enviado" | "sin_correo" | "no_configurado" | "fallo" | "no_solicitado";

const ZONA = "America/Monterrey";

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function diaLargo(valor: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: ZONA,
  }).format(valor);
}

function hora(valor: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ZONA,
  }).format(valor);
}

function textoCita(cita: CitaAviso): string {
  const que = cita.tipo === "INSTALACION" ? "La instalación" : "La entrega";
  const donde = cita.direccion ? ` en ${cita.direccion}` : "";
  return `${que} está programada para el ${diaLargo(cita.inicio)}, de ${hora(cita.inicio)} a ${hora(cita.fin)}${donde}.`;
}

// Título y párrafos de cada aviso
function contenido(datos: DatosAviso): { asunto: string; titulo: string; parrafos: string[] } {
  const { folio, aviso } = datos;
  const cita = aviso.cita ? textoCita(aviso.cita) : "";

  if (aviso.tipo === "creado") {
    return {
      asunto: `GAONA | Tu pedido #${folio} está confirmado`,
      titulo: "Tu pedido está confirmado",
      parrafos: [
        `Recibimos la aprobación de tu cotización y ya registramos tu pedido #${folio}. Comenzamos a prepararlo.`,
        cita || "En cuanto tengamos lista la fecha de entrega te la haremos saber.",
      ],
    };
  }

  if (aviso.tipo === "fecha") {
    return {
      asunto: `GAONA | Nueva fecha para tu pedido #${folio}`,
      titulo: "Cambiamos la fecha de tu pedido",
      parrafos: [`Hubo un cambio en la agenda de tu pedido #${folio}.`, cita],
    };
  }

  const porEstado: Record<EstadoPedido, { titulo: string; parrafos: string[] }> = {
    EN_PROCESO: {
      titulo: "Tu pedido está en proceso",
      parrafos: [`Estamos trabajando en tu pedido #${folio}.`, cita],
    },
    LISTO_PARA_INSTALAR: {
      titulo: "Tu pedido está listo",
      parrafos: [
        `Tu pedido #${folio} ya está listo.`,
        cita || "Nos pondremos en contacto contigo para acordar la fecha de entrega.",
      ],
    },
    ENTREGADO: {
      titulo: "Tu pedido fue entregado",
      parrafos: [`Tu pedido #${folio} quedó entregado. Esperamos que lo disfrutes.`],
    },
    FACTURADO: {
      titulo: "Tu pedido fue facturado",
      parrafos: [`Ya emitimos la factura de tu pedido #${folio}.`],
    },
    CERRADO: {
      titulo: "Tu pedido quedó cerrado",
      parrafos: [`Tu pedido #${folio} quedó cerrado. Gracias por tu compra.`],
    },
    CANCELADO: {
      titulo: "Tu pedido fue cancelado",
      parrafos: [`Tu pedido #${folio} fue cancelado. Si no esperabas este cambio, contáctanos.`],
    },
  };

  const elegido = porEstado[aviso.estado];
  return { asunto: `GAONA | Pedido #${folio}: ${elegido.titulo.toLowerCase()}`, ...elegido };
}

export function crearMensajeAviso(datos: DatosAviso) {
  const { asunto, titulo, parrafos } = contenido(datos);
  const primerNombre = datos.nombreCliente.split(/\s+/)[0] || datos.nombreCliente;
  const cuerpo = parrafos.filter(Boolean);
  const cierre = "Si tienes dudas, responde este correo o llámanos.";

  const text = [
    "GAONA",
    `Hola, ${primerNombre}:`,
    titulo,
    ...cuerpo,
    cierre,
    "Atentamente,\nEquipo GAONA",
  ].join("\n\n");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f6f3;color:#202020;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 12px"><div style="max-width:600px;margin:auto;background:#fff;padding:24px;border-top:5px solid #c47720"><h1 style="color:#a15b12;font-size:24px">GAONA</h1><p>Hola, ${escapar(primerNombre)}:</p><h2 style="font-size:18px">${escapar(titulo)}</h2>${cuerpo
    .map((p) => `<p>${escapar(p)}</p>`)
    .join("")}<p>${escapar(cierre)}</p><p>Atentamente,<br>Equipo GAONA</p></div></td></tr></table></body></html>`;

  return { asunto, text, html };
}

// Las pruebas cambian el transporte para no mandar correos reales
export const opcionesAviso: { fabrica?: FabricaTransporte } = {};

// Nunca lanza: el pedido ya quedó guardado y el correo es solo un aviso
export async function avisarCliente(
  destinatario: string | null,
  datos: DatosAviso,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResultadoAviso> {
  if (!destinatario) return "sin_correo";

  const configuracion = configurarSmtp(env);
  if (!configuracion && !opcionesAviso.fabrica) return "no_configurado";

  const mensaje = crearMensajeAviso(datos);
  const fabrica = opcionesAviso.fabrica ?? ((opciones) => nodemailer.createTransport(opciones));

  try {
    const transporte = fabrica(configuracion?.opciones ?? {});
    try {
      const resultado = await transporte.sendMail({
        from: { address: configuracion?.from ?? "pruebas@example.invalid", name: "GAONA" },
        to: destinatario,
        replyTo: configuracion?.from,
        subject: mensaje.asunto,
        text: mensaje.text,
        html: mensaje.html,
      });
      return Array.isArray(resultado.accepted) && resultado.accepted.length > 0 ? "enviado" : "fallo";
    } finally {
      transporte.close();
    }
  } catch {
    console.error("No se pudo enviar el aviso del pedido");
    return "fallo";
  }
}
