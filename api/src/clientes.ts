import { Router } from "express";
import { z } from "zod";
import { prisma } from "./lib/prisma";

export const clientesRouter = Router();

// Utilidades
// Un pedido está "activo" mientras no se haya entregado, cerrado o cancelado
const ESTADOS_PEDIDO_ACTIVO = ["EN_PROCESO", "LISTO_PARA_INSTALAR"];

function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

// Deja el teléfono en 10 dígitos (quita lada +52 / 52 si viene)
function normalizarTelefono(texto: string): string {
  let digitos = soloDigitos(texto);
  if (digitos.length === 12 && digitos.startsWith("52")) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

function formatearTelefono(texto: string): string {
  const d = normalizarTelefono(texto);
  if (d.length !== 10) return texto.trim();
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function esErrorPrisma(error: unknown, codigo: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === codigo
  );
}

// Validación de datos
const clienteSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(100, "El nombre es demasiado largo."),
  apellido: z
    .string()
    .trim()
    .min(1, "El apellido es obligatorio.")
    .max(100, "El apellido es demasiado largo."),
  telefono: z
    .string()
    .trim()
    .refine(
      (valor) => normalizarTelefono(valor).length === 10,
      "El teléfono debe tener 10 dígitos."
    ),
  correo: z
    .string()
    .trim()
    .max(150, "El correo es demasiado largo.")
    .optional()
    .refine(
      (valor) => !valor || z.email().safeParse(valor).success,
      "El correo no es válido."
    )
    .transform((valor) => (valor ? valor.toLowerCase() : null)),
  direccion: z
    .string()
    .trim()
    .max(250, "La dirección es demasiado larga.")
    .optional()
    .transform((valor) => (valor ? valor : null)),
});

// Busca otro cliente con el mismo teléfono (para evitar duplicados)
async function buscarDuplicado(telefono: string, excluirId?: string) {
  const objetivo = normalizarTelefono(telefono);
  const existentes = await prisma.cliente.findMany({
    select: { id: true, nombre: true, apellido: true, telefono: true },
  });
  return existentes.find(
    (c) => c.id !== excluirId && normalizarTelefono(c.telefono) === objetivo
  );
}

// Cálculos a partir de pedidos y pagos
type PedidoConPagos = {
  estado: string;
  total: unknown;
  pagos: { monto: unknown }[];
};

// Saldo = total de cada pedido (sin cancelados) - lo pagado en ese pedido
function calcularSaldo(pedidos: PedidoConPagos[]): number {
  const saldo = pedidos
    .filter((p) => p.estado !== "CANCELADO")
    .reduce((acumulado, p) => {
      const pagado = p.pagos.reduce((suma, x) => suma + Number(x.monto), 0);
      return acumulado + Math.max(0, Number(p.total) - pagado);
    }, 0);
  return redondear(saldo);
}

// GET /clientes

clientesRouter.get("/", async (req, res) => {
  const filtro = String(req.query.filtro ?? "todos");
  const busqueda = normalizarTexto(String(req.query.busqueda ?? ""));
  const busquedaDigitos = soloDigitos(busqueda);
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);
  const limite = Math.min(
    50,
    Math.max(1, parseInt(String(req.query.limite ?? "8"), 10) || 8)
  );

  try {
    const clientes = await prisma.cliente.findMany({
      orderBy: { creadoEn: "desc" },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        telefono: true,
        correo: true,
        direccion: true,
        solicitudes: { select: { estado: true, origen: true } },
        pedidos: {
          select: {
            estado: true,
            total: true,
            pagos: { select: { monto: true } },
          },
        },
      },
    });

    const todos = clientes.map((c) => {
      const nuevasWeb = c.solicitudes.filter(
        (s) => s.estado === "NUEVA" && s.origen === "WEB"
      ).length;

      return {
        id: c.id,
        nombre: c.nombre,
        apellido: c.apellido,
        telefono: c.telefono,
        correo: c.correo,
        direccion: c.direccion,
        origen: c.solicitudes.some((s) => s.origen === "WEB")
          ? ("WEB" as const)
          : ("MANUAL" as const),
        solicitudNueva: nuevasWeb > 0,
        solicitudesNuevas: nuevasWeb,
        totalPedidos: c.pedidos.length,
        pedidoActivo: c.pedidos.some((p) =>
          ESTADOS_PEDIDO_ACTIVO.includes(p.estado)
        ),
        saldoPendiente: calcularSaldo(c.pedidos),
      };
    });

    // Las tarjetas de arriba cuentan a todos los clientes, sin filtros
    const resumen = {
      total: todos.length,
      conSaldo: todos.filter((c) => c.saldoPendiente > 0).length,
      solicitudesNuevas: todos.reduce((s, c) => s + c.solicitudesNuevas, 0),
    };

    const filtrados = todos.filter((c) => {
      if (filtro === "nueva" && !c.solicitudNueva) return false;
      if (filtro === "saldo" && c.saldoPendiente <= 0) return false;
      if (filtro === "pedido" && !c.pedidoActivo) return false;

      if (busqueda) {
        const texto = normalizarTexto(
          `${c.nombre} ${c.apellido} ${c.correo ?? ""}`
        );
        const coincideTexto = texto.includes(busqueda);
        const coincideTelefono =
          busquedaDigitos.length > 0 &&
          soloDigitos(c.telefono).includes(busquedaDigitos);
        if (!coincideTexto && !coincideTelefono) return false;
      }
      return true;
    });

    const total = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    const paginaActual = Math.min(pagina, totalPaginas);
    const items = filtrados.slice(
      (paginaActual - 1) * limite,
      paginaActual * limite
    );

    res.json({
      items,
      total,
      pagina: paginaActual,
      limite,
      totalPaginas,
      resumen,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron obtener los clientes." });
  }
});

// GET /clientes/:id

// Título legible de una solicitud: su descripción o los productos pedidos
function tituloSolicitud(s: {
  descripcion: string | null;
  detalles: {
    cantidad: number;
    medidasAprox: string | null;
    producto: { nombre: string };
  }[];
}): string {
  if (s.descripcion) return s.descripcion;
  if (s.detalles.length === 0) return "Solicitud sin productos";

  return s.detalles
    .map((d) => {
      const cantidad = d.cantidad > 1 ? `${d.cantidad} × ` : "";
      const medidas = d.medidasAprox ? ` ${d.medidasAprox}` : "";
      return `${cantidad}${d.producto.nombre}${medidas}`;
    })
    .join(", ");
}

clientesRouter.get("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const cliente = await prisma.cliente.findUnique({
      where: { id },
      include: {
        solicitudes: {
          orderBy: { creadoEn: "desc" },
          include: {
            detalles: {
              include: { producto: { select: { nombre: true } } },
            },
          },
        },
        pedidos: {
          orderBy: { creadoEn: "desc" },
          include: { pagos: { select: { monto: true, tipo: true } } },
        },
      },
    });

    if (!cliente) {
      res.status(404).json({ error: "El cliente no existe." });
      return;
    }

    const [cotizaciones, citas] = await Promise.all([
      prisma.cotizacion.findMany({
        where: { solicitud: { idCliente: id } },
        orderBy: { creadoEn: "desc" },
        select: {
          id: true,
          estado: true,
          total: true,
          vigenciaHasta: true,
          creadoEn: true,
        },
      }),
      prisma.cita.findMany({
        where: {
          OR: [{ solicitud: { idCliente: id } }, { pedido: { idCliente: id } }],
        },
        orderBy: { inicio: "desc" },
        select: {
          id: true,
          tipo: true,
          estado: true,
          inicio: true,
          fin: true,
          direccion: true,
        },
      }),
    ]);

    const pagos = cliente.pedidos
      .filter((p) => p.estado !== "CANCELADO")
      .flatMap((p) => p.pagos);

    const anticipos = pagos
      .filter((p) => p.tipo === "ANTICIPO")
      .reduce((suma, p) => suma + Number(p.monto), 0);
    const otrosPagos = pagos
      .filter((p) => p.tipo !== "ANTICIPO")
      .reduce((suma, p) => suma + Number(p.monto), 0);

    res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        telefono: cliente.telefono,
        correo: cliente.correo,
        direccion: cliente.direccion,
        origen: cliente.solicitudes.some((s) => s.origen === "WEB")
          ? "WEB"
          : "MANUAL",
        creadoEn: cliente.creadoEn,
      },
      finanzas: {
        anticipos: redondear(anticipos),
        pagos: redondear(otrosPagos),
        saldo: calcularSaldo(cliente.pedidos),
      },
      solicitudes: cliente.solicitudes.map((s) => ({
        id: s.id,
        titulo: tituloSolicitud(s),
        estado: s.estado,
        origen: s.origen,
        creadoEn: s.creadoEn,
      })),
      cotizaciones: cotizaciones.map((c) => ({
        id: c.id,
        estado: c.estado,
        total: Number(c.total),
        vigenciaHasta: c.vigenciaHasta,
        creadoEn: c.creadoEn,
      })),
      pedidos: cliente.pedidos.map((p) => {
        const pagado = p.pagos.reduce((suma, x) => suma + Number(x.monto), 0);
        return {
          id: p.id,
          estado: p.estado,
          total: Number(p.total),
          pagado: redondear(pagado),
          saldo: redondear(Math.max(0, Number(p.total) - pagado)),
          creadoEn: p.creadoEn,
        };
      }),
      citas,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo obtener el cliente." });
  }
});

// POST /clientes

clientesRouter.post("/", async (req, res) => {
  const resultado = clienteSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0].message });
    return;
  }

  const datos = resultado.data;

  try {
    const duplicado = await buscarDuplicado(datos.telefono);
    if (duplicado) {
      res.status(409).json({
        error: `Ya existe un cliente con ese teléfono: ${duplicado.nombre} ${duplicado.apellido}.`,
      });
      return;
    }

    const cliente = await prisma.cliente.create({
      data: { ...datos, telefono: formatearTelefono(datos.telefono) },
      select: { id: true },
    });

    res.status(201).json(cliente);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar el cliente." });
  }
});


// PUT /clientes/:id
clientesRouter.put("/:id", async (req, res) => {
  const id = req.params.id;
  const resultado = clienteSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0].message });
    return;
  }

  const datos = resultado.data;

  try {
    const duplicado = await buscarDuplicado(datos.telefono, id);
    if (duplicado) {
      res.status(409).json({
        error: `Ya existe otro cliente con ese teléfono: ${duplicado.nombre} ${duplicado.apellido}.`,
      });
      return;
    }

    const cliente = await prisma.cliente.update({
      where: { id },
      data: { ...datos, telefono: formatearTelefono(datos.telefono) },
      select: { id: true },
    });

    res.json(cliente);
  } catch (error) {
    if (esErrorPrisma(error, "P2025")) {
      res.status(404).json({ error: "El cliente no existe." });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "No se pudo actualizar el cliente." });
  }
});


// DELETE /clientes/:id
// Se bloquea si el cliente ya tiene pedidos o cotizaciones, porque ahí
// hay dinero e historial de por medio. 

clientesRouter.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const cliente = await prisma.cliente.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!cliente) {
      res.status(404).json({ error: "El cliente no existe." });
      return;
    }

    const [pedidos, cotizaciones] = await Promise.all([
      prisma.pedido.count({ where: { idCliente: id } }),
      prisma.cotizacion.count({ where: { solicitud: { idCliente: id } } }),
    ]);

    if (pedidos > 0 || cotizaciones > 0) {
      const motivos: string[] = [];
      if (pedidos > 0) motivos.push(`${pedidos} pedido(s)`);
      if (cotizaciones > 0) motivos.push(`${cotizaciones} cotización(es)`);

      res.status(409).json({
        error: `No se puede eliminar: el cliente tiene ${motivos.join(" y ")} registrados.`,
      });
      return;
    }

    await prisma.$transaction([
      prisma.cita.deleteMany({ where: { solicitud: { idCliente: id } } }),
      prisma.solicitud.deleteMany({ where: { idCliente: id } }),
      prisma.cliente.delete({ where: { id } }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo eliminar el cliente." });
  }
});