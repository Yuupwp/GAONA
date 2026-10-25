import PDFDocument from "pdfkit";
import type { ComprobanteSolicitud } from "./solicitud-estimado";

const naranja = "#c47720";
const gris = "#6f6f6f";
const tinta = "#202020";
const crema = "#f7f6f3";
const margen = 48;
const ancho = 516;
const limite = 724;
const columnas = [226, 42, 120, 128];

export function generarSolicitudPdf(datos: ComprobanteSolicitud): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER", margin: margen, bufferPages: true,
      info: { Title: "Solicitud de cotización", Author: "GAONA" },
    });
    const partes: Buffer[] = [];
    doc.on("data", (parte: Buffer) => partes.push(parte));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(partes)));
    let y = 0;
    const moneda = (valor: string) => `$${valor.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} MXN`;
    const texto = (valor: string, x: number, top: number, tam = 10, negrita = false, color = tinta) => {
      doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(tam).fillColor(color)
        .text(valor, x, top, { lineBreak: false });
    };
    const lineas = (valor: string, espacio: number, tam = 10): string[] => {
      doc.font("Helvetica").fontSize(tam);
      return valor.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").split(/\r?\n/).flatMap(parrafo => {
        const resultado: string[] = [];
        let actual = "";
        for (const caracter of parrafo) {
          if (actual && doc.widthOfString(actual + caracter) > espacio) {
            const corte = actual.lastIndexOf(" ");
            if (corte > 0) {
              resultado.push(actual.slice(0, corte));
              actual = actual.slice(corte + 1);
            } else {
              resultado.push(actual);
              actual = "";
            }
          }
          actual += caracter;
        }
        resultado.push(actual);
        return resultado;
      });
    };
    const nuevaPagina = () => {
      if (y) doc.addPage();
      doc.rect(0, 0, 612, 12).fill(naranja);
      texto("G", margen, 36, 34, true, naranja);
      texto("GAONA", margen + 36, 43, 24, true);
      texto("Solicitud de cotización", margen, 84, 19, true);
      y = 120;
    };
    const espacio = (alto: number) => { if (y + alto > limite) nuevaPagina(); };
    const parrafo = (valor: string, tam = 10, color = tinta) => {
      for (const linea of lineas(valor, ancho, tam)) {
        espacio(tam + 5);
        texto(linea, margen, y, tam, false, color);
        y += tam + 5;
      }
      y += 8;
    };
    const cabeceraTabla = () => {
      doc.rect(margen, y, ancho, 28).fill(naranja);
      let x = margen;
      ["Producto / medidas / notas", "Cant.", "Desde / unidad", "Importe estimado"].forEach((titulo, i) => {
        texto(titulo, x + 7, y + 9, 9, true, "#ffffff");
        x += columnas[i];
      });
      y += 28;
    };
    try {
      nuevaPagina();
      parrafo(`Folio: ${datos.id}`, 10, gris);
      parrafo(`Fecha de generación: ${new Intl.DateTimeFormat("es-MX", {
        dateStyle: "long", timeStyle: "short", timeZone: "America/Monterrey",
      }).format(new Date())} (Monterrey)`, 10, gris);
      parrafo(`Solicitud registrada: ${new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium", timeZone: "America/Monterrey",
      }).format(new Date(datos.fecha))}`, 9, gris);
      parrafo("DATOS DEL CLIENTE", 11, naranja);
      parrafo(`${datos.cliente.nombre} ${datos.cliente.apellido}`);
      parrafo(`Teléfono: ${datos.cliente.telefono}`);
      if (datos.cliente.correo) parrafo(`Correo: ${datos.cliente.correo}`);
      if (datos.descripcion) parrafo(`Observaciones generales: ${datos.descripcion}`);
      espacio(64);
      cabeceraTabla();
      datos.estimado.productos.forEach((producto, indice) => {
        const detalle = `${indice + 1}. ${producto.nombre}\nMedidas aprox.: ${producto.medidasAprox || "No proporcionadas"}${producto.notas ? `\nNotas: ${producto.notas}` : ""}`;
        const celdas = [detalle, String(producto.cantidad), moneda(producto.precioUnitario), moneda(producto.importe)]
          .map((valor, i) => lineas(valor, columnas[i] - 14));
        const totalLineas = Math.max(...celdas.map(c => c.length));
        let inicio = 0;
        while (inicio < totalLineas) {
          let disponibles = Math.floor((limite - y - 16) / 14);
          if (disponibles < 1) {
            nuevaPagina();
            cabeceraTabla();
            disponibles = Math.floor((limite - y - 16) / 14);
          }
          const cantidad = Math.min(disponibles, totalLineas - inicio);
          const alto = cantidad * 14 + 16;
          doc.rect(margen, y, ancho, alto).fill(indice % 2 === 0 ? crema : "#ffffff");
          let x = margen;
          celdas.forEach((celda, columna) => {
            celda.slice(inicio, inicio + cantidad).forEach((linea, i) => texto(linea, x + 7, y + 8 + i * 14));
            x += columnas[columna];
          });
          y += alto;
          doc.moveTo(margen, y).lineTo(margen + ancho, y).strokeColor("#e3e1dd").stroke();
          inicio += cantidad;
        }
      });
      y += 18;
      espacio(115);
      [["Subtotal", datos.estimado.subtotal], ["IVA (16 %)", datos.estimado.iva], ["Total estimado", datos.estimado.total]].forEach(([titulo, valor], i) => {
        doc.rect(margen, y, ancho, 30).fill(i === 2 ? crema : "#ffffff");
        texto(titulo, margen + 12, y + 8, 11, i === 2);
        texto(moneda(valor), margen + 300, y + 8, 11, i === 2, i === 2 ? naranja : tinta);
        y += 32;
      });
      y += 15;
      espacio(86);
      parrafo("Los importes son estimados. El precio definitivo está sujeto a la confirmación de medidas, materiales y condiciones por parte de GAONA. Este documento es una solicitud de cotización y no constituye una cotización formal aprobada.", 10, gris);
      const paginas = doc.bufferedPageRange();
      for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
        doc.switchToPage(i);
        doc.moveTo(margen, 744).lineTo(margen + ancho, 744).strokeColor("#e3e1dd").stroke();
        texto("GAONA · Importes estimados", margen, 754, 9, false, gris);
        texto(`Página ${i + 1} de ${paginas.count}`, 470, 754, 9, false, gris);
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
