import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { generarCotizacionPdf, type DatosCotizacionPdf } from "./cotizacion-pdf";
import { correoDisponible, enviarCotizacion, type FabricaTransporte } from "./cotizacion-correo";
import { correoValido } from "./solicitud-correo-validacion";

export const cotizacionesRouter = Router();

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

const IVA = 0.16;

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Igual que en Finanzas: el folio son los primeros 8 caracteres del id
export function folioDe(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

// "AAAA-MM-DD" con la hora local, para que la pantalla no cambie de día
export function soloFecha(valor: Date | null): string | null {
  if (!valor) return null;
  const mes = String(valor.getMonth() + 1).padStart(2, "0");
  const dia = String(valor.getDate()).padStart(2, "0");
  return `${valor.getFullYear()}-${mes}-${dia}`;
}

function inicioDeHoy(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
}

export class ErrorNegocio extends Error {
  constructor(public estado: number, mensaje: string) {
    super(mensaje);
  }
}

// Usuario que hace la acción. Si la app no lo manda, se usa el primer
// administrador activo (el mismo criterio que usa Finanzas).
export async function usuarioQueRegistra(
  tx: Prisma.TransactionClient,
  idUsuario: string | undefined
): Promise<string> {
  const usuario = idUsuario
    ? await tx.usuario.findFirst({
        where: { id: idUsuario, activo: true },
        select: { id: true },
      })
    : await tx.usuario.findFirst({
        where: { activo: true, rol: { nombre: "ADMINISTRADOR" } },
        orderBy: { creadoEn: "asc" },
        select: { id: true },
      });

  if (!usuario) {
    throw new ErrorNegocio(
      409,
      "No se encontró un usuario activo que registre la acción. Vuelve a iniciar sesión."
    );
  }

  return usuario.id;
}

function responderError(res: import("express").Response, error: unknown, mensaje: string) {
  if (error instanceof ErrorNegocio) {
    res.status(error.estado).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: mensaje });
}

// Solicitudes que todavía se pueden cotizar
const SOLICITUD_ABIERTA = {
  estado: { in: ["NUEVA" as const, "EN_REVISION" as const, "VISITA_PROGRAMADA" as const] },
};

// Una cotización enviada cuya vigencia ya pasó se marca como vencida
async function marcarVencidas(): Promise<void> {
  await prisma.cotizacion.updateMany({
    where: { estado: "ENVIADA", vigenciaHasta: { lt: inicioDeHoy() } },
    data: { estado: "VENCIDA" },
  });
}

const seleccionCotizacion = {
  id: true,
  estado: true,
  subtotal: true,
  iva: true,
  total: true,
  anticipoRequerido: true,
  vigenciaHasta: true,
  fechaAprobacion: true,
  pdfUrl: true,
  creadoEn: true,
  usuario: { select: { nombre: true, apellido: true } },
  solicitud: {
    select: {
      id: true,
      origen: true,
      descripcion: true,
      cliente: {
        select: { id: true, nombre: true, apellido: true, telefono: true, correo: true, direccion: true },
      },
    },
  },
  detalles: {
    select: {
      id: true,
      concepto: true,
      descripcion: true,
      cantidad: true,
      precioUnitario: true,
      subtotal: true,
      medidas: true,
    },
  },
  pedido: { select: { id: true } },
} satisfies Prisma.CotizacionSelect;

type CotizacionBD = Prisma.CotizacionGetPayload<{ select: typeof seleccionCotizacion }>;

function aRespuesta(c: CotizacionBD) {
  const cliente = c.solicitud.cliente;
  return {
    id: c.id,
    folio: folioDe(c.id),
    estado: c.estado,
    cliente: `${cliente.nombre} ${cliente.apellido}`.trim(),
    idCliente: cliente.id,
    telefono: cliente.telefono,
    correo: cliente.correo,
    origen: c.solicitud.origen,
    solicitud: c.solicitud.descripcion,
    subtotal: redondear(Number(c.subtotal)),
    iva: redondear(Number(c.iva)),
    total: redondear(Number(c.total)),
    anticipoRequerido:
      c.anticipoRequerido === null ? null : redondear(Number(c.anticipoRequerido)),
    vigenciaHasta: soloFecha(c.vigenciaHasta),
    fechaAprobacion: soloFecha(c.fechaAprobacion),
    creadoEn: soloFecha(c.creadoEn),
    elaboradaPor: `${c.usuario.nombre} ${c.usuario.apellido}`.trim(),
    pdfUrl: c.pdfUrl,
    idPedido: c.pedido?.id ?? null,
    folioPedido: c.pedido ? folioDe(c.pedido.id) : null,
    conceptos: c.detalles.map((d) => ({
      id: d.id,
      tipo: d.concepto,
      nombre: d.descripcion,
      cantidad: Number(d.cantidad),
      precio: redondear(Number(d.precioUnitario)),
      subtotal: redondear(Number(d.subtotal)),
      medidas: d.medidas,
    })),
  };
}

// ---------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------

const fechaTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.");

const conceptoSchema = z.object({
  nombre: z.string().trim().min(1, "Cada concepto necesita un nombre.").max(200),
  cantidad: z
    .number({ error: "La cantidad debe ser un número." })
    .positive("La cantidad debe ser mayor a 0.")
    .max(99999),
  precio: z
    .number({ error: "El precio debe ser un número." })
    .positive("El precio debe ser mayor a 0.")
    .max(99999999),
  tipo: z.enum(["PRODUCTO", "MATERIAL", "MANO_OBRA", "FLETE"]).optional(),
  idProducto: z.string().trim().min(1).nullable().optional(),
  medidas: z.string().trim().max(120).nullable().optional(),
});

const nuevaSchema = z.object({
  idCliente: z.string().trim().min(1, "Selecciona un cliente."),
  idSolicitud: z.string().trim().min(1).nullable().optional(),
  conceptos: z.array(conceptoSchema).min(1, "Agrega al menos un concepto.").max(100),
  anticipoRequerido: z.number().min(0, "Escribe un anticipo válido.").nullable().optional(),
  vigenciaHasta: fechaTexto.nullable().optional(),
  idUsuario: z.string().trim().min(1).optional(),
});

const estadoSchema = z.object({
  estado: z.enum(["ENVIADA", "APROBADA", "RECHAZADA"], {
    error: "Estado no válido.",
  }),
  idUsuario: z.string().trim().min(1).optional(),
});

// A qué estados puede pasar cada uno
const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ["ENVIADA"],
  ENVIADA: ["APROBADA", "RECHAZADA"],
};

// ---------------------------------------------------------------------
// GET /cotizaciones  ->  lista completa (la pantalla filtra y pagina)
// ---------------------------------------------------------------------

cotizacionesRouter.get("/", async (_req, res) => {
  try {
    await marcarVencidas();

    const cotizaciones = await prisma.cotizacion.findMany({
      orderBy: { creadoEn: "desc" },
      select: seleccionCotizacion,
    });

    // correoActivo le dice a la pantalla si puede ofrecer "Enviar por correo"
    res.json({ items: cotizaciones.map(aRespuesta), correoActivo: correoDisponible() !== null });
  } catch (error) {
    responderError(res, error, "No se pudieron cargar las cotizaciones.");
  }
});

// ---------------------------------------------------------------------
// GET /cotizaciones/opciones  ->  clientes y sus solicitudes abiertas
// (para el formulario "Nueva cotización")
// ---------------------------------------------------------------------

cotizacionesRouter.get("/opciones", async (_req, res) => {
  try {
    const clientes = await prisma.cliente.findMany({
      orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
      select: {
        id: true,
        nombre: true,
        apellido: true,
        telefono: true,
        solicitudes: {
          where: SOLICITUD_ABIERTA,
          orderBy: { creadoEn: "desc" },
          select: {
            id: true,
            origen: true,
            estado: true,
            descripcion: true,
            creadoEn: true,
            detalles: {
              select: {
                cantidad: true,
                medidasAprox: true,
                medidasReales: true,
                notas: true,
                producto: { select: { id: true, nombre: true, precioDesde: true } },
              },
            },
          },
        },
      },
    });

    res.json({
      clientes: clientes.map((c) => ({
        id: c.id,
        nombre: `${c.nombre} ${c.apellido}`.trim(),
        telefono: c.telefono,
        solicitudes: c.solicitudes.map((s) => ({
          id: s.id,
          origen: s.origen,
          estado: s.estado,
          descripcion: s.descripcion,
          creadoEn: soloFecha(s.creadoEn),
          productos: s.detalles.map((d) => ({
            idProducto: d.producto.id,
            nombre: d.producto.nombre,
            cantidad: d.cantidad,
            precio: redondear(Number(d.producto.precioDesde)),
            medidas: d.medidasReales ?? d.medidasAprox ?? null,
            notas: d.notas,
          })),
        })),
      })),
    });
  } catch (error) {
    responderError(res, error, "No se pudieron cargar los clientes.");
  }
});

// ---------------------------------------------------------------------
// POST /cotizaciones  ->  guardar una cotización nueva como borrador
// ---------------------------------------------------------------------

cotizacionesRouter.post("/", async (req, res) => {
  const resultado = nuevaSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const datos = resultado.data;

  // Los totales siempre se calculan aquí, no se confía en la pantalla
  const conceptos = datos.conceptos.map((c) => ({
    ...c,
    cantidad: redondear(c.cantidad),
    precio: redondear(c.precio),
    subtotal: redondear(c.cantidad * c.precio),
  }));
  const subtotal = redondear(conceptos.reduce((s, c) => s + c.subtotal, 0));
  const iva = redondear(subtotal * IVA);
  const total = redondear(subtotal + iva);
  const anticipo =
    datos.anticipoRequerido === null || datos.anticipoRequerido === undefined
      ? null
      : redondear(datos.anticipoRequerido);

  if (anticipo !== null && anticipo > total) {
    res.status(400).json({ error: `El anticipo no puede superar el total ($${total.toFixed(2)}).` });
    return;
  }

  // Mediodía para que la zona horaria no mueva el día
  const vigencia = datos.vigenciaHasta ? new Date(`${datos.vigenciaHasta}T12:00:00`) : null;

  if (vigencia && vigencia < inicioDeHoy()) {
    res.status(400).json({ error: "La vigencia no puede ser una fecha pasada." });
    return;
  }

  try {
    const creada = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { id: datos.idCliente },
        select: { id: true },
      });
      if (!cliente) throw new ErrorNegocio(404, "El cliente no existe.");

      const idUsuario = await usuarioQueRegistra(tx, datos.idUsuario);

      // Con solicitud: se cotiza la que pidió el cliente (por ejemplo, desde la página).
      // Sin solicitud: se crea una de escritorio para dejar el registro.
      let idSolicitud: string;

      if (datos.idSolicitud) {
        const solicitud = await tx.solicitud.findFirst({
          where: { id: datos.idSolicitud, idCliente: cliente.id },
          select: { id: true, estado: true },
        });
        if (!solicitud) throw new ErrorNegocio(404, "La solicitud no pertenece a este cliente.");
        if (solicitud.estado === "CANCELADA") {
          throw new ErrorNegocio(409, "La solicitud está cancelada.");
        }
        idSolicitud = solicitud.id;
      } else {
        const solicitud = await tx.solicitud.create({
          data: {
            idCliente: cliente.id,
            idUsuarioAsignado: idUsuario,
            origen: "ESCRITORIO",
            estado: "COTIZADA",
            descripcion: "Cotización creada desde la app de escritorio.",
          },
          select: { id: true },
        });
        idSolicitud = solicitud.id;
      }

      const cotizacion = await tx.cotizacion.create({
        data: {
          idSolicitud,
          idUsuario,
          estado: "BORRADOR",
          subtotal,
          iva,
          total,
          anticipoRequerido: anticipo,
          vigenciaHasta: vigencia,
          detalles: {
            create: conceptos.map((c) => ({
              idProducto: c.idProducto ?? null,
              concepto: c.tipo ?? (c.idProducto ? "PRODUCTO" : "MANO_OBRA"),
              descripcion: c.nombre,
              cantidad: c.cantidad,
              precioUnitario: c.precio,
              subtotal: c.subtotal,
              medidas: c.medidas ?? null,
            })),
          },
        },
        select: seleccionCotizacion,
      });

      await tx.solicitud.update({
        where: { id: idSolicitud },
        data: { estado: "COTIZADA", idUsuarioAsignado: idUsuario },
      });

      return cotizacion;
    });

    res.status(201).json(aRespuesta(creada));
  } catch (error) {
    responderError(res, error, "No se pudo guardar la cotización.");
  }
});

// ---------------------------------------------------------------------
// PATCH /cotizaciones/:id/estado  ->  enviar, aprobar o rechazar
// ---------------------------------------------------------------------

cotizacionesRouter.patch("/:id/estado", async (req, res) => {
  const resultado = estadoSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const nuevo = resultado.data.estado;

  try {
    await marcarVencidas();

    const actualizada = await prisma.$transaction(async (tx) => {
      const actual = await tx.cotizacion.findUnique({
        where: { id: req.params.id },
        select: { estado: true },
      });
      if (!actual) throw new ErrorNegocio(404, "La cotización no existe.");

      if (!(TRANSICIONES[actual.estado] ?? []).includes(nuevo)) {
        throw new ErrorNegocio(
          409,
          actual.estado === "VENCIDA"
            ? "La cotización ya venció. Crea una nueva con fecha vigente."
            : "La cotización no puede pasar a ese estado."
        );
      }

      // Solo cambia si sigue en el estado que se leyó (evita doble clic o dos equipos a la vez)
      const cambio = await tx.cotizacion.updateMany({
        where: { id: req.params.id, estado: actual.estado },
        data: {
          estado: nuevo,
          fechaAprobacion: nuevo === "APROBADA" ? new Date() : undefined,
        },
      });
      if (cambio.count === 0) {
        throw new ErrorNegocio(409, "Otra persona cambió la cotización. Recarga la pantalla.");
      }

      return tx.cotizacion.findUniqueOrThrow({
        where: { id: req.params.id },
        select: seleccionCotizacion,
      });
    });

    res.json(aRespuesta(actualizada));
  } catch (error) {
    responderError(res, error, "No se pudo cambiar el estado de la cotización.");
  }
});

// ---------------------------------------------------------------------
// POST /cotizaciones/:id/pedido  ->  convertir una cotización aprobada en pedido
// ---------------------------------------------------------------------

cotizacionesRouter.post("/:id/pedido", async (req, res) => {
  const idUsuario =
    typeof req.body?.idUsuario === "string" && req.body.idUsuario.trim() !== ""
      ? req.body.idUsuario.trim()
      : undefined;

  try {
    const pedido = await prisma.$transaction(async (tx) => {
      const cotizacion = await tx.cotizacion.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          estado: true,
          total: true,
          pedido: { select: { id: true } },
          solicitud: { select: { idCliente: true } },
        },
      });

      if (!cotizacion) throw new ErrorNegocio(404, "La cotización no existe.");
      if (cotizacion.pedido) {
        throw new ErrorNegocio(409, `Esta cotización ya tiene el pedido #${folioDe(cotizacion.pedido.id)}.`);
      }
      if (cotizacion.estado !== "APROBADA") {
        throw new ErrorNegocio(409, "Solo una cotización aprobada se puede convertir en pedido.");
      }

      const usuario = await usuarioQueRegistra(tx, idUsuario);

      return tx.pedido.create({
        data: {
          idCotizacion: cotizacion.id,
          idCliente: cotizacion.solicitud.idCliente,
          estado: "EN_PROCESO",
          total: cotizacion.total, // copia congelada del total
          historial: {
            create: { idUsuario: usuario, estadoAnterior: null, estadoNuevo: "EN_PROCESO" },
          },
        },
        select: { id: true },
      });
    });

    res.status(201).json({ id: pedido.id, folio: folioDe(pedido.id) });
  } catch (error) {
    // Dos clics a la vez: el índice único de idCotizacion lo detiene
    if ((error as { code?: string })?.code === "P2002") {
      res.status(409).json({ error: "Esta cotización ya tiene un pedido." });
      return;
    }
    responderError(res, error, "No se pudo crear el pedido.");
  }
});

// ---------------------------------------------------------------------
// PDF y correo
// ---------------------------------------------------------------------

// Las pruebas cambian el transporte para no mandar correos reales
export const opcionesCorreo: { fabrica?: FabricaTransporte } = {};

async function datosParaPdf(id: string): Promise<{ datos: DatosCotizacionPdf; estado: string; correo: string | null; idCliente: string } | null> {
  const c = await prisma.cotizacion.findUnique({ where: { id }, select: seleccionCotizacion });
  if (!c) return null;

  const r = aRespuesta(c);
  const cliente = c.solicitud.cliente;

  return {
    estado: c.estado,
    correo: cliente.correo,
    idCliente: cliente.id,
    datos: {
      folio: r.folio,
      estado: r.estado,
      creadoEn: c.creadoEn,
      vigenciaHasta: c.vigenciaHasta,
      elaboradaPor: r.elaboradaPor,
      cliente: {
        nombre: r.cliente,
        telefono: cliente.telefono,
        correo: cliente.correo,
        direccion: cliente.direccion,
      },
      conceptos: r.conceptos.map((k) => ({
        nombre: k.nombre,
        medidas: k.medidas,
        cantidad: k.cantidad,
        precio: k.precio,
        importe: k.subtotal,
      })),
      subtotal: r.subtotal,
      iva: r.iva,
      total: r.total,
      anticipoRequerido: r.anticipoRequerido,
    },
  };
}

// GET /cotizaciones/:id/pdf  ->  el PDF de la cotización (se abre en el navegador)
cotizacionesRouter.get("/:id/pdf", async (req, res) => {
  try {
    const encontrada = await datosParaPdf(req.params.id);
    if (!encontrada) {
      res.status(404).json({ error: "La cotización no existe." });
      return;
    }

    const pdf = await generarCotizacionPdf(encontrada.datos);
    res
      .status(200)
      .type("application/pdf")
      .set("Content-Disposition", `inline; filename="GAONA-Cotizacion-${encontrada.datos.folio}.pdf"`)
      .set("Cache-Control", "no-store")
      .send(pdf);
  } catch (error) {
    responderError(res, error, "No se pudo generar el PDF.");
  }
});

// Evita mandar dos veces la misma cotización por doble clic
const enviando = new Set<string>();
const ultimoEnvio = new Map<string, number>();
const ESPERA_ENTRE_ENVIOS = 60 * 1000;

const envioSchema = z.object({
  correo: correoValido,
  idUsuario: z.string().trim().min(1).optional(),
});

// POST /cotizaciones/:id/enviar  ->  manda el PDF por correo al cliente.
// Si la cotización era borrador, pasa a "Enviada".
cotizacionesRouter.post("/:id/enviar", async (req, res) => {
  const resultado = envioSchema.safeParse({
    ...req.body,
    correo: typeof req.body?.correo === "string" ? req.body.correo.trim() : req.body?.correo,
  });

  if (!resultado.success) {
    res.status(400).json({ error: "Escribe un correo válido." });
    return;
  }

  const id = req.params.id;
  const destinatario = resultado.data.correo;

  if (!correoDisponible() && !opcionesCorreo.fabrica) {
    res.status(503).json({
      error: "El envío de correos no está configurado. Revisa MAIL_ENABLED y SMTP_* en api/.env.",
    });
    return;
  }

  if (enviando.has(id)) {
    res.status(409).json({ error: "Esta cotización ya se está enviando." });
    return;
  }

  const antes = ultimoEnvio.get(id);
  if (antes && Date.now() - antes < ESPERA_ENTRE_ENVIOS) {
    res.status(429).json({ error: "Esta cotización se acaba de enviar. Espera un minuto para reenviarla." });
    return;
  }

  enviando.add(id);

  try {
    await marcarVencidas();
    const encontrada = await datosParaPdf(id);

    if (!encontrada) {
      res.status(404).json({ error: "La cotización no existe." });
      return;
    }

    if (encontrada.estado === "RECHAZADA" || encontrada.estado === "VENCIDA") {
      res.status(409).json({
        error: `La cotización está ${encontrada.estado === "RECHAZADA" ? "rechazada" : "vencida"}; no se puede enviar.`,
      });
      return;
    }

    const pdf = await generarCotizacionPdf(encontrada.datos);

    try {
      await enviarCotizacion(encontrada.datos, destinatario, pdf, process.env, opcionesCorreo.fabrica);
    } catch (error) {
      console.error("No se pudo enviar la cotización por correo:", (error as Error)?.message);
      res.status(502).json({
        error: "El servidor de correo no aceptó el mensaje. Revisa el correo del cliente e inténtalo de nuevo.",
      });
      return;
    }

    ultimoEnvio.set(id, Date.now());

    // Si el cliente no tenía correo, se guarda el que se usó
    if (!encontrada.correo) {
      await prisma.cliente.update({ where: { id: encontrada.idCliente }, data: { correo: destinatario } });
    }

    // Un borrador enviado pasa a "Enviada"
    if (encontrada.estado === "BORRADOR") {
      await prisma.cotizacion.updateMany({ where: { id, estado: "BORRADOR" }, data: { estado: "ENVIADA" } });
    }

    res.json({
      enviadoA: destinatario,
      estado: encontrada.estado === "BORRADOR" ? "ENVIADA" : encontrada.estado,
    });
  } catch (error) {
    responderError(res, error, "No se pudo enviar la cotización.");
  } finally {
    enviando.delete(id);
  }
});
