import PDFDocument from "pdfkit";

// PDF de una cotización formal hecha en la app de escritorio.
// Usa el mismo diseño que el PDF de solicitudes de la página (solicitud-pdf.ts).

export interface DatosCotizacionPdf {
  folio: string;
  estado: string;
  creadoEn: Date;
  vigenciaHasta: Date | null;
  elaboradaPor: string;
  cliente: {
    nombre: string;
    telefono: string;
    correo: string | null;
    direccion: string | null;
  };
  conceptos: {
    nombre: string;
    medidas: string | null;
    cantidad: number;
    precio: number;
    importe: number;
  }[];
  subtotal: number;
  iva: number;
  total: number;
  anticipoRequerido: number | null;
}

const naranja = "#c47720";
const gris = "#6f6f6f";
const tinta = "#202020";
const crema = "#f7f6f3";
const margen = 48;
const ancho = 516;
const limite = 724;
const columnas = [246, 50, 110, 110];

const formatoMoneda = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function moneda(valor: number): string {
  return `$${formatoMoneda.format(valor)} MXN`;
}

export function fechaLarga(valor: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeZone: "America/Monterrey",
  }).format(valor);
}

export function generarCotizacionPdf(datos: DatosCotizacionPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: margen,
      bufferPages: true,
      info: { Title: `Cotización ${datos.folio}`, Author: "GAONA" },
    });
    const partes: Buffer[] = [];
    doc.on("data", (parte: Buffer) => partes.push(parte));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(partes)));

    let y = 0;

    const texto = (valor: string, x: number, top: number, tam = 10, negrita = false, color = tinta) => {
      doc
        .font(negrita ? "Helvetica-Bold" : "Helvetica")
        .fontSize(tam)
        .fillColor(color)
        .text(valor, x, top, { lineBreak: false });
    };

    // Parte un texto en renglones que quepan en el espacio dado
    const lineas = (valor: string, espacio: number, tam = 10): string[] => {
      doc.font("Helvetica").fontSize(tam);
      return valor
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .split(/\r?\n/)
        .flatMap((parrafo) => {
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
      texto("Cotización", margen, 84, 19, true);
      texto(`#${datos.folio}`, margen + ancho - 110, 88, 14, true, naranja);
      y = 120;
    };

    const espacio = (alto: number) => {
      if (y + alto > limite) nuevaPagina();
    };

    const parrafo = (valor: string, tam = 10, color = tinta) => {
      for (const linea of lineas(valor, ancho, tam)) {
        espacio(tam + 5);
        texto(linea, margen, y, tam, false, color);
        y += tam + 5;
      }
      y += 6;
    };

    const cabeceraTabla = () => {
      doc.rect(margen, y, ancho, 28).fill(naranja);
      let x = margen;
      ["Concepto / medidas", "Cant.", "Precio unitario", "Importe"].forEach((titulo, i) => {
        texto(titulo, x + 7, y + 9, 9, true, "#ffffff");
        x += columnas[i];
      });
      y += 28;
    };

    try {
      nuevaPagina();

      parrafo(`Fecha: ${fechaLarga(datos.creadoEn)}`, 10, gris);
      parrafo(
        datos.vigenciaHasta
          ? `Vigencia: hasta el ${fechaLarga(datos.vigenciaHasta)}`
          : "Vigencia: sujeta a confirmación con GAONA",
        10,
        gris
      );
      parrafo(`Elaboró: ${datos.elaboradaPor}`, 10, gris);

      y += 4;
      parrafo("DATOS DEL CLIENTE", 11, naranja);
      parrafo(datos.cliente.nombre);
      parrafo(`Teléfono: ${datos.cliente.telefono}`);
      if (datos.cliente.correo) parrafo(`Correo: ${datos.cliente.correo}`);
      if (datos.cliente.direccion) parrafo(`Dirección: ${datos.cliente.direccion}`);

      espacio(64);
      cabeceraTabla();

      datos.conceptos.forEach((concepto, indice) => {
        const detalle = `${indice + 1}. ${concepto.nombre}${concepto.medidas ? `\nMedidas: ${concepto.medidas}` : ""}`;
        const celdas = [
          detalle,
          formatoMoneda.format(concepto.cantidad).replace(/\.00$/, ""),
          moneda(concepto.precio),
          moneda(concepto.importe),
        ].map((valor, i) => lineas(valor, columnas[i] - 14));

        const totalLineas = Math.max(...celdas.map((c) => c.length));
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
            celda
              .slice(inicio, inicio + cantidad)
              .forEach((linea, i) => texto(linea, x + 7, y + 8 + i * 14));
            x += columnas[columna];
          });
          y += alto;
          doc.moveTo(margen, y).lineTo(margen + ancho, y).strokeColor("#e3e1dd").stroke();
          inicio += cantidad;
        }
      });

      y += 18;
      const totales: [string, number][] = [
        ["Subtotal", datos.subtotal],
        ["IVA (16 %)", datos.iva],
        ["Total", datos.total],
      ];
      if (datos.anticipoRequerido !== null) totales.push(["Anticipo requerido", datos.anticipoRequerido]);

      espacio(totales.length * 32 + 10);
      totales.forEach(([titulo, valor], i) => {
        const resaltado = titulo === "Total";
        doc.rect(margen, y, ancho, 30).fill(resaltado ? crema : "#ffffff");
        texto(titulo, margen + 12, y + 8, 11, resaltado);
        texto(moneda(valor), margen + 300, y + 8, 11, resaltado, resaltado ? naranja : tinta);
        y += 32;
        if (i === totales.length - 1) y += 4;
      });

      y += 12;
      espacio(90);
      parrafo("CONDICIONES", 11, naranja);
      const condiciones = [
        "Precios en pesos mexicanos (MXN) con IVA incluido en el total.",
        datos.vigenciaHasta
          ? `Esta cotización es válida hasta el ${fechaLarga(datos.vigenciaHasta)}.`
          : "Los precios pueden cambiar si no se confirma el pedido en un plazo razonable.",
        datos.anticipoRequerido !== null
          ? `Para iniciar el trabajo se requiere un anticipo de ${moneda(datos.anticipoRequerido)}.`
          : "No se requiere anticipo para iniciar el trabajo.",
        "Cualquier cambio en medidas o materiales puede modificar el precio final.",
      ];
      condiciones.forEach((c) => parrafo(`• ${c}`, 10, gris));

      const paginas = doc.bufferedPageRange();
      for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
        doc.switchToPage(i);
        doc.moveTo(margen, 744).lineTo(margen + ancho, 744).strokeColor("#e3e1dd").stroke();
        texto(`GAONA · Cotización #${datos.folio}`, margen, 754, 9, false, gris);
        texto(`Página ${i + 1} de ${paginas.count}`, 470, 754, 9, false, gris);
      }

      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
