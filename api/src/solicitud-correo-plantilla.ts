import type { ComprobanteSolicitud } from "./solicitud-estimado";

const escapar = (texto: string) => texto.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const moneda = (valor: string) => `$${valor.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} MXN`;

export function crearPlantillaCorreo(datos: ComprobanteSolicitud) {
  const fecha = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long", timeStyle: "short", timeZone: "America/Monterrey",
  }).format(new Date(datos.fecha));
  const aviso = "Los precios son estimados y pueden variar después de confirmar medidas, materiales y condiciones del proyecto.";
  const productos = datos.estimado.productos;
  const text = [
    "GAONA", `Hola, ${datos.cliente.nombre}:`,
    "Hemos recibido tu solicitud de cotización en GAONA.",
    `Folio: ${datos.id}\nFecha de la solicitud: ${fecha} (hora de Monterrey)`,
    "Productos solicitados:\n" + productos.map(p => `${p.cantidad} × ${p.nombre} — ${moneda(p.importe)}`).join("\n"),
    `Subtotal estimado: ${moneda(datos.estimado.subtotal)}\nIVA (16%): ${moneda(datos.estimado.iva)}\nTotal estimado: ${moneda(datos.estimado.total)}`,
    "Adjuntamos el PDF de tu solicitud con el detalle de los productos e importes estimados.",
    aviso, "Esta solicitud no confirma una venta ni un precio final aprobado.",
    "Gracias por contactar a GAONA.\n\nAtentamente,\nEquipo GAONA",
  ].join("\n\n");
  const filas = productos.map(p => `<tr><td style="padding:10px 4px;border-bottom:1px solid #ddd">${escapar(p.nombre)}</td><td style="padding:10px 4px;text-align:center;border-bottom:1px solid #ddd">${p.cantidad}</td><td style="padding:10px 4px;text-align:right;border-bottom:1px solid #ddd">${escapar(moneda(p.importe))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f6f3;color:#202020;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 12px"><div style="max-width:600px;margin:auto;background:#fff;padding:24px;border-top:5px solid #c47720"><h1 style="color:#a15b12;font-size:24px">GAONA</h1><p>Hola, ${escapar(datos.cliente.nombre)}:</p><p>Hemos recibido tu solicitud de cotización en GAONA.</p><p style="overflow-wrap:anywhere"><strong>Folio: ${escapar(datos.id)}</strong><br>Fecha de la solicitud: ${escapar(fecha)} (hora de Monterrey)</p><h2 style="font-size:18px">Productos solicitados</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px"><thead><tr><th scope="col" align="left">Producto</th><th scope="col">Cantidad</th><th scope="col" align="right">Importe estimado</th></tr></thead><tbody>${filas}</tbody></table><p>Subtotal estimado: ${escapar(moneda(datos.estimado.subtotal))}<br>IVA (16%): ${escapar(moneda(datos.estimado.iva))}<br><strong>Total estimado: ${escapar(moneda(datos.estimado.total))}</strong></p><p>Adjuntamos el PDF de tu solicitud con el detalle de los productos e importes estimados.</p><p style="font-size:14px">${aviso} Esta solicitud no confirma una venta ni un precio final aprobado.</p><p>Gracias por contactar a GAONA.</p><p>Atentamente,<br>Equipo GAONA</p></div></td></tr></table></body></html>`;
  return { text, html };
}
