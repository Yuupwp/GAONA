import { Router } from "express";
import { z } from "zod";
import { prisma } from "./lib/prisma";

export const finanzasRouter = Router();

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// El pedido no tiene un número consecutivo, así que se muestra un folio
// corto tomado de su id (los primeros 8 caracteres, en mayúsculas).
function folioDe(idPedido: string): string {
  return idPedido.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function suma(montos: { monto: unknown }[]): number {
  return redondear(montos.reduce((total, p) => total + Number(p.monto), 0));
}

function entero(valor: unknown, porDefecto: number, min: number, max: number) {
  const numero = Number.parseInt(String(valor ?? ""), 10);
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(Math.max(numero, min), max);
}

function inicioDeMes(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
}

const FILTROS = ["todos", "saldo", "sinAnticipo", "liquidados"] as const;
type Filtro = (typeof FILTROS)[number];

// Un pedido cancelado nunca cuenta como cuenta por cobrar
const PEDIDOS_VALIDOS = { estado: { not: "CANCELADO" as const } };

// ---------------------------------------------------------------------
// Validación del pago
// ---------------------------------------------------------------------

const pagoSchema = z.object({
  idPedido: z.string().trim().min(1, "Selecciona un pedido."),
  tipo: z.enum(["ANTICIPO", "PARCIAL", "LIQUIDACION"], {
    error: "Selecciona el tipo de pago.",
  }),
  metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"], {
    error: "Selecciona el método de pago.",
  }),
  monto: z
    .number({ error: "El monto debe ser un número." })
    .positive("El monto debe ser mayor a 0.")
    .max(99999999, "El monto es demasiado grande."),
  referencia: z
    .string()
    .trim()
    .max(100, "La referencia es demasiado larga.")
    .optional(),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.")
    .optional(),
  // Opcional: cuando exista el login real, la app mandará el usuario que registra
  idUsuario: z.string().trim().min(1).optional(),
});

// ---------------------------------------------------------------------
// GET /finanzas/resumen  ->  las 4 tarjetas de arriba
// ---------------------------------------------------------------------

finanzasRouter.get("/resumen", async (_req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: PEDIDOS_VALIDOS,
      select: {
        total: true,
        pagos: { select: { monto: true, tipo: true } },
      },
    });

    let porCobrar = 0;
    let anticipos = 0;
    let conSaldo = 0;

    for (const p of pedidos) {
      const saldo = Math.max(0, Number(p.total) - suma(p.pagos));
      porCobrar += saldo;
      if (saldo > 0.004) conSaldo += 1;
      anticipos += suma(p.pagos.filter((x) => x.tipo === "ANTICIPO"));
    }

    const cobradoMes = await prisma.pago.aggregate({
      _sum: { monto: true },
      where: {
        fecha: { gte: inicioDeMes() },
        pedido: PEDIDOS_VALIDOS,
      },
    });

    res.json({
      porCobrar: redondear(porCobrar),
      anticiposRecibidos: redondear(anticipos),
      cobradoMes: redondear(Number(cobradoMes._sum.monto ?? 0)),
      pedidosConSaldo: conSaldo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar el resumen financiero." });
  }
});

// ---------------------------------------------------------------------
// GET /finanzas/cuentas  ->  pestaña "Cuentas por cobrar"
// ---------------------------------------------------------------------

finanzasRouter.get("/cuentas", async (req, res) => {
  const filtro: Filtro = FILTROS.includes(req.query.filtro as Filtro)
    ? (req.query.filtro as Filtro)
    : "todos";
  const busqueda = normalizarTexto(String(req.query.busqueda ?? ""));
  const limite = entero(req.query.limite, 8, 1, 100);
  let pagina = entero(req.query.pagina, 1, 1, 100000);

  try {
    const pedidos = await prisma.pedido.findMany({
      where: PEDIDOS_VALIDOS,
      orderBy: { creadoEn: "desc" },
      select: {
        id: true,
        estado: true,
        total: true,
        creadoEn: true,
        cliente: {
          select: { nombre: true, apellido: true, telefono: true },
        },
        pagos: { select: { monto: true, tipo: true } },
      },
    });

    const todas = pedidos.map((p) => {
      const total = Number(p.total);
      const pagado = suma(p.pagos);
      const saldo = redondear(Math.max(0, total - pagado));
      const tieneAnticipo = p.pagos.some((x) => x.tipo === "ANTICIPO");

      return {
        id: p.id,
        folio: folioDe(p.id),
        estado: p.estado,
        creadoEn: p.creadoEn,
        cliente: {
          nombre: p.cliente.nombre,
          apellido: p.cliente.apellido,
          telefono: p.cliente.telefono,
        },
        total: redondear(total),
        pagado,
        saldo,
        tieneAnticipo,
      };
    });

    const filtradas = todas.filter((c) => {
      if (filtro === "saldo" && c.saldo <= 0) return false;
      if (filtro === "sinAnticipo" && (c.tieneAnticipo || c.saldo <= 0))
        return false;
      if (filtro === "liquidados" && c.saldo > 0) return false;

      if (busqueda) {
        const texto = normalizarTexto(
          `${c.cliente.nombre} ${c.cliente.apellido} ${c.folio} ${c.cliente.telefono}`
        );
        if (!texto.includes(busqueda.replace(/^#/, ""))) return false;
      }

      return true;
    });

    const total = filtradas.length;
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    pagina = Math.min(pagina, totalPaginas);

    res.json({
      items: filtradas.slice((pagina - 1) * limite, pagina * limite),
      total,
      pagina,
      limite,
      totalPaginas,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar las cuentas por cobrar." });
  }
});

// ---------------------------------------------------------------------
// GET /finanzas/pedidos-pendientes  ->  opciones del formulario "Registrar pago"
// ---------------------------------------------------------------------

finanzasRouter.get("/pedidos-pendientes", async (_req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: PEDIDOS_VALIDOS,
      orderBy: { creadoEn: "desc" },
      select: {
        id: true,
        total: true,
        cliente: { select: { nombre: true, apellido: true } },
        pagos: { select: { monto: true, tipo: true } },
      },
    });

    const items = pedidos
      .map((p) => {
        const total = Number(p.total);
        return {
          id: p.id,
          folio: folioDe(p.id),
          cliente: `${p.cliente.nombre} ${p.cliente.apellido}`,
          total: redondear(total),
          saldo: redondear(Math.max(0, total - suma(p.pagos))),
          tieneAnticipo: p.pagos.some((x) => x.tipo === "ANTICIPO"),
        };
      })
      .filter((p) => p.saldo > 0);

    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar los pedidos." });
  }
});

// ---------------------------------------------------------------------
// GET /finanzas/pagos  ->  pestaña "Historial de pagos"
// ---------------------------------------------------------------------

finanzasRouter.get("/pagos", async (req, res) => {
  const busqueda = normalizarTexto(String(req.query.busqueda ?? ""));
  const limite = entero(req.query.limite, 8, 1, 100);
  let pagina = entero(req.query.pagina, 1, 1, 100000);

  try {
    const pagos = await prisma.pago.findMany({
      where: { pedido: PEDIDOS_VALIDOS },
      orderBy: { fecha: "desc" },
      select: {
        id: true,
        idPedido: true,
        tipo: true,
        metodo: true,
        monto: true,
        referencia: true,
        fecha: true,
        usuario: { select: { nombre: true, apellido: true } },
        pedido: {
          select: {
            cliente: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    const todos = pagos.map((p) => ({
      id: p.id,
      idPedido: p.idPedido,
      folio: folioDe(p.idPedido),
      tipo: p.tipo,
      metodo: p.metodo,
      monto: redondear(Number(p.monto)),
      referencia: p.referencia,
      fecha: p.fecha,
      cliente: `${p.pedido.cliente.nombre} ${p.pedido.cliente.apellido}`,
      registradoPor: `${p.usuario.nombre} ${p.usuario.apellido}`,
    }));

    const filtrados = busqueda
      ? todos.filter((p) =>
          normalizarTexto(
            `${p.cliente} ${p.folio} ${p.referencia ?? ""}`
          ).includes(busqueda.replace(/^#/, ""))
        )
      : todos;

    const total = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    pagina = Math.min(pagina, totalPaginas);

    res.json({
      items: filtrados.slice((pagina - 1) * limite, pagina * limite),
      total,
      pagina,
      limite,
      totalPaginas,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar el historial de pagos." });
  }
});

// ---------------------------------------------------------------------
// GET /finanzas/pedidos/:id  ->  detalle de un pedido con sus pagos
// ---------------------------------------------------------------------

finanzasRouter.get("/pedidos/:id", async (req, res) => {
  try {
    const pedido = await prisma.pedido.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        estado: true,
        total: true,
        creadoEn: true,
        cliente: {
          select: { nombre: true, apellido: true, telefono: true, correo: true },
        },
        cotizacion: { select: { anticipoRequerido: true } },
        pagos: {
          orderBy: { fecha: "desc" },
          select: {
            id: true,
            tipo: true,
            metodo: true,
            monto: true,
            referencia: true,
            fecha: true,
            usuario: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    if (!pedido) {
      res.status(404).json({ error: "El pedido no existe." });
      return;
    }

    const total = Number(pedido.total);
    const pagado = suma(pedido.pagos);
    const anticipoRequerido =
      pedido.cotizacion.anticipoRequerido === null
        ? null
        : redondear(Number(pedido.cotizacion.anticipoRequerido));
    const anticipoPagado = suma(
      pedido.pagos.filter((p) => p.tipo === "ANTICIPO")
    );

    res.json({
      id: pedido.id,
      folio: folioDe(pedido.id),
      estado: pedido.estado,
      creadoEn: pedido.creadoEn,
      cliente: pedido.cliente,
      total: redondear(total),
      pagado,
      saldo: redondear(Math.max(0, total - pagado)),
      anticipoRequerido,
      anticipoPagado,
      pagos: pedido.pagos.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        metodo: p.metodo,
        monto: redondear(Number(p.monto)),
        referencia: p.referencia,
        fecha: p.fecha,
        registradoPor: `${p.usuario.nombre} ${p.usuario.apellido}`,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar el detalle del pedido." });
  }
});

// ---------------------------------------------------------------------
// POST /finanzas/pagos  ->  registrar un anticipo / pago parcial / liquidación
// ---------------------------------------------------------------------

class ErrorNegocio extends Error {
  constructor(public estado: number, mensaje: string) {
    super(mensaje);
  }
}

finanzasRouter.post("/pagos", async (req, res) => {
  const resultado = pagoSchema.safeParse(req.body);

  if (!resultado.success) {
    res
      .status(400)
      .json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const datos = resultado.data;
  const monto = redondear(datos.monto);

  try {
    const pago = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: datos.idPedido },
        select: {
          id: true,
          estado: true,
          total: true,
          pagos: { select: { monto: true, tipo: true } },
        },
      });

      if (!pedido) {
        throw new ErrorNegocio(404, "El pedido no existe.");
      }

      if (pedido.estado === "CANCELADO") {
        throw new ErrorNegocio(409, "El pedido está cancelado: no admite pagos.");
      }

      const saldo = redondear(Number(pedido.total) - suma(pedido.pagos));

      if (saldo <= 0) {
        throw new ErrorNegocio(409, "El pedido ya está liquidado.");
      }

      if (monto > saldo) {
        throw new ErrorNegocio(
          409,
          `El monto supera el saldo pendiente ($${saldo.toFixed(2)}).`
        );
      }

      if (datos.tipo === "ANTICIPO" && pedido.pagos.some((p) => p.tipo === "ANTICIPO")) {
        throw new ErrorNegocio(
          409,
          "Este pedido ya tiene un anticipo. Registra el pago como Parcial o Liquidación."
        );
      }

      if (datos.tipo === "LIQUIDACION" && monto !== saldo) {
        throw new ErrorNegocio(
          409,
          `Una liquidación debe cubrir todo el saldo ($${saldo.toFixed(2)}).`
        );
      }

      if (datos.tipo !== "LIQUIDACION" && monto === saldo) {
        throw new ErrorNegocio(
          409,
          "Este pago cubre todo el saldo: regístralo como Liquidación."
        );
      }

      // Usuario que registra el pago. Mientras el login de la app sea simulado,
      // se usa el primer administrador activo.
      const usuario = datos.idUsuario
        ? await tx.usuario.findFirst({
            where: { id: datos.idUsuario, activo: true },
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
          "No hay un usuario administrador activo que registre el pago. Crea uno en el módulo de Empleados."
        );
      }

      return tx.pago.create({
        data: {
          idPedido: pedido.id,
          idUsuario: usuario.id,
          tipo: datos.tipo,
          metodo: datos.metodo,
          monto,
          referencia: datos.referencia || null,
          // Mediodía para que la zona horaria no mueva el día
          fecha: datos.fecha ? new Date(`${datos.fecha}T12:00:00`) : new Date(),
        },
        select: { id: true },
      });
    });

    res.status(201).json(pago);
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      res.status(error.estado).json({ error: error.message });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "No se pudo registrar el pago." });
  }
});