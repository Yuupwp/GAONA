import { Router } from "express";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { ErrorNegocio, folioDe, soloFecha, usuarioQueRegistra } from "./cotizaciones";

export const pedidosRouter = Router();

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function suma(montos: { monto: unknown }[]): number {
  return redondear(montos.reduce((total, p) => total + Number(p.monto), 0));
}

// Un pedido cerrado o cancelado ya no cambia de estado
const ESTADOS_FINALES = ["CERRADO", "CANCELADO"];

const estadoSchema = z.object({
  estado: z.enum(
    ["EN_PROCESO", "LISTO_PARA_INSTALAR", "ENTREGADO", "FACTURADO", "CERRADO", "CANCELADO"],
    { error: "Estado no válido." }
  ),
});

// ---------------------------------------------------------------------
// GET /pedidos  ->  lista completa (la pantalla filtra y pagina)
// ---------------------------------------------------------------------

pedidosRouter.get("/", async (_req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      orderBy: { creadoEn: "desc" },
      select: {
        id: true,
        idCotizacion: true,
        estado: true,
        total: true,
        creadoEn: true,
        cliente: { select: { nombre: true, apellido: true, telefono: true } },
        pagos: { select: { monto: true } },
      },
    });

    res.json({
      items: pedidos.map((p) => ({
        id: p.id,
        folio: folioDe(p.id),
        cliente: `${p.cliente.nombre} ${p.cliente.apellido}`.trim(),
        telefono: p.cliente.telefono,
        estado: p.estado,
        total: redondear(Number(p.total)),
        pagado: suma(p.pagos),
        creadoEn: soloFecha(p.creadoEn),
        folioCotizacion: folioDe(p.idCotizacion),
      })),
    });
  } catch (error) {
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudieron cargar los pedidos." });
  }
});

// ---------------------------------------------------------------------
// GET /pedidos/:id  ->  detalle con conceptos e historial de estados
// ---------------------------------------------------------------------

pedidosRouter.get("/:id", async (req, res) => {
  try {
    const p = await prisma.pedido.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        idCotizacion: true,
        estado: true,
        total: true,
        creadoEn: true,
        cliente: { select: { nombre: true, apellido: true, telefono: true } },
        pagos: { select: { monto: true } },
        cotizacion: {
          select: {
            detalles: { select: { descripcion: true, cantidad: true, subtotal: true } },
          },
        },
        historial: {
          orderBy: { fecha: "desc" },
          select: {
            estadoAnterior: true,
            estadoNuevo: true,
            fecha: true,
            usuario: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    if (!p) {
      res.status(404).json({ error: "El pedido no existe." });
      return;
    }

    res.json({
      id: p.id,
      folio: folioDe(p.id),
      cliente: `${p.cliente.nombre} ${p.cliente.apellido}`.trim(),
      telefono: p.cliente.telefono,
      estado: p.estado,
      total: redondear(Number(p.total)),
      pagado: suma(p.pagos),
      creadoEn: soloFecha(p.creadoEn),
      folioCotizacion: folioDe(p.idCotizacion),
      conceptos: p.cotizacion.detalles.map((d) => ({
        nombre: d.descripcion,
        cantidad: Number(d.cantidad),
        subtotal: redondear(Number(d.subtotal)),
      })),
      historial: p.historial.map((h) => ({
        estadoAnterior: h.estadoAnterior,
        estadoNuevo: h.estadoNuevo,
        fecha: h.fecha,
        usuario: `${h.usuario.nombre} ${h.usuario.apellido}`.trim(),
      })),
    });
  } catch (error) {
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudo cargar el pedido." });
  }
});

// ---------------------------------------------------------------------
// PATCH /pedidos/:id/estado  ->  cambiar el estado y dejarlo en el historial
// ---------------------------------------------------------------------

pedidosRouter.patch("/:id/estado", async (req, res) => {
  const resultado = estadoSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const { estado: nuevo } = resultado.data;

  try {
    await prisma.$transaction(async (tx) => {
      const actual = await tx.pedido.findUnique({
        where: { id: req.params.id },
        select: { estado: true },
      });

      if (!actual) throw new ErrorNegocio(404, "El pedido no existe.");
      if (actual.estado === nuevo) throw new ErrorNegocio(409, "El pedido ya está en ese estado.");
      if (ESTADOS_FINALES.includes(actual.estado)) {
        throw new ErrorNegocio(
          409,
          `El pedido está ${actual.estado === "CERRADO" ? "cerrado" : "cancelado"} y ya no cambia de estado.`
        );
      }

      const usuario = await usuarioQueRegistra(tx, req.usuario!.id);

      // Solo cambia si sigue en el estado que se leyó (evita que dos equipos choquen)
      const cambio = await tx.pedido.updateMany({
        where: { id: req.params.id, estado: actual.estado },
        data: { estado: nuevo },
      });
      if (cambio.count === 0) {
        throw new ErrorNegocio(409, "Otra persona cambió el pedido. Recarga la pantalla.");
      }

      await tx.historialPedido.create({
        data: {
          idPedido: req.params.id,
          idUsuario: usuario,
          estadoAnterior: actual.estado,
          estadoNuevo: nuevo,
        },
      });
    });

    res.json({ id: req.params.id, estado: nuevo });
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      res.status(error.estado).json({ error: error.message });
      return;
    }
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudo cambiar el estado del pedido." });
  }
});
