import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { configurarSmtp } from "./solicitud-correo";
import { fechaLarga, moneda, type DatosCotizacionPdf } from "./cotizacion-pdf";

// Envío por correo de las cotizaciones hechas en la app de escritorio.
// Usa la misma configuración SMTP (Brevo) que la página: MAIL_ENABLED y SMTP_* en api/.env.

export type Transporte = {
  sendMail: (mensaje: SendMailOptions) => Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close: () => void;
};

export type FabricaTransporte = (opciones: SMTPTransport.Options) => Transporte;

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function crearMensaje(datos: DatosCotizacionPdf) {
  const primerNombre = datos.cliente.nombre.split(/\s+/)[0] ?? datos.cliente.nombre;
  const vigencia = datos.vigenciaHasta
    ? `Esta cotización es válida hasta el ${fechaLarga(datos.vigenciaHasta)}.`
    : "";
  const anticipo =
    datos.anticipoRequerido !== null
      ? `Para iniciar el trabajo se requiere un anticipo de ${moneda(datos.anticipoRequerido)}.`
      : "";

  const text = [
    "GAONA",
    `Hola, ${primerNombre}:`,
    `Te compartimos la cotización #${datos.folio} que preparamos para ti.`,
    "Conceptos:\n" +
      datos.conceptos.map((c) => `${c.cantidad} × ${c.nombre} — ${moneda(c.importe)}`).join("\n"),
    `Subtotal: ${moneda(datos.subtotal)}\nIVA (16%): ${moneda(datos.iva)}\nTotal: ${moneda(datos.total)}`,
    [vigencia, anticipo].filter(Boolean).join("\n"),
    "Adjuntamos el PDF con el detalle completo. Si tienes dudas o quieres confirmar, responde este correo o llámanos.",
    "Gracias por tu confianza.\n\nAtentamente,\nEquipo GAONA",
  ]
    .filter(Boolean)
    .join("\n\n");

  const filas = datos.conceptos
    .map(
      (c) =>
        `<tr><td style="padding:10px 4px;border-bottom:1px solid #ddd">${escapar(c.nombre)}</td><td style="padding:10px 4px;text-align:center;border-bottom:1px solid #ddd">${c.cantidad}</td><td style="padding:10px 4px;text-align:right;border-bottom:1px solid #ddd">${escapar(moneda(c.importe))}</td></tr>`
    )
    .join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f6f3;color:#202020;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 12px"><div style="max-width:600px;margin:auto;background:#fff;padding:24px;border-top:5px solid #c47720"><h1 style="color:#a15b12;font-size:24px">GAONA</h1><p>Hola, ${escapar(primerNombre)}:</p><p>Te compartimos la cotización <strong>#${escapar(datos.folio)}</strong> que preparamos para ti.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px"><thead><tr><th scope="col" align="left">Concepto</th><th scope="col">Cantidad</th><th scope="col" align="right">Importe</th></tr></thead><tbody>${filas}</tbody></table><p>Subtotal: ${escapar(moneda(datos.subtotal))}<br>IVA (16%): ${escapar(moneda(datos.iva))}<br><strong>Total: ${escapar(moneda(datos.total))}</strong></p>${vigencia || anticipo ? `<p>${escapar([vigencia, anticipo].filter(Boolean).join(" "))}</p>` : ""}<p>Adjuntamos el PDF con el detalle completo. Si tienes dudas o quieres confirmar, responde este correo o llámanos.</p><p>Gracias por tu confianza.</p><p>Atentamente,<br>Equipo GAONA</p></div></td></tr></table></body></html>`;

  return { asunto: `GAONA | Cotización #${datos.folio}`, text, html };
}

// Devuelve null si el correo no está configurado o está apagado (MAIL_ENABLED distinto de "true")
export function correoDisponible(env: NodeJS.ProcessEnv = process.env) {
  return configurarSmtp(env);
}

export async function enviarCotizacion(
  datos: DatosCotizacionPdf,
  destinatario: string,
  pdf: Buffer,
  env: NodeJS.ProcessEnv = process.env,
  fabrica: FabricaTransporte = (opciones) => nodemailer.createTransport(opciones)
): Promise<void> {
  const configuracion = configurarSmtp(env);
  if (!configuracion) {
    throw new Error("CORREO_NO_DISPONIBLE");
  }

  const mensaje = crearMensaje(datos);
  const transporte = fabrica(configuracion.opciones);

  try {
    const resultado = await transporte.sendMail({
      from: { address: configuracion.from, name: "GAONA" },
      to: destinatario,
      replyTo: configuracion.from,
      subject: mensaje.asunto,
      text: mensaje.text,
      html: mensaje.html,
      attachments: [
        { filename: `GAONA-Cotizacion-${datos.folio}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
    });

    if (!Array.isArray(resultado.accepted) || resultado.accepted.length === 0) {
      throw new Error("CORREO_RECHAZADO");
    }
  } finally {
    transporte.close();
  }
}
