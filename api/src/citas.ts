import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { ErrorNegocio, folioDe, soloFecha } from "./cotizaciones";

export const citasRouter = Router();

// ---------------------------------------------------------------------
// Reglas
// - MEDICION: visita para medir; va ligada a una solicitud del cliente.
// - ENTREGA / INSTALACION: van ligadas a un pedido.
// - Un empleado no puede tener dos citas activas que se encimen.
// ---------------------------------------------------------------------

// Una cita "activa" ocupa la agenda del responsable
const CITA_ACTIVA = { in: ["PROGRAMADA" as const, "REPROGRAMADA" as const] };
const SOLICITUD_ABIERTA = { in: ["NUEVA" as const, "EN_REVISION" as const, "VISITA_PROGRAMADA" as const] };
const PEDIDO_ACTIVO = { in: ["EN_PROCESO" as const, "LISTO_PARA_INSTALAR" as const, "ENTREGADO" as const] };

const fechaTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.");
const horaTexto = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora no es válida.");

function inicioDeHoy(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
}

// "2026-11-12" + "09:30" en la hora local del equipo
function aFecha(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}:00`);
}

function horaDe(valor: Date): string {
  return `${String(valor.getHours()).padStart(2, "0")}:${String(valor.getMinutes()).padStart(2, "0")}`;
}

const seleccionCita = {
  id: true,
  tipo: true,
  estado: true,
  inicio: true,
  fin: true,
  direccion: true,
  notas: true,
  idUsuario: true,
  usuario: { select: { nombre: true, apellido: true } },
  solicitud: {
    select: { id: true, cliente: { select: { nombre: true, apellido: true, telefono: true } } },
  },
  pedido: {
    select: { id: true, cliente: { select: { nombre: true, apellido: true, telefono: true } } },
  },
} satisfies Prisma.CitaSelect;

type CitaBD = Prisma.CitaGetPayload<{ select: typeof seleccionCita }>;

function aRespuesta(c: CitaBD) {
  const cliente = c.solicitud?.cliente ?? c.pedido?.cliente ?? null;
  return {
    id: c.id,
    tipo: c.tipo,
    estado: c.estado,
    fecha: soloFecha(c.inicio),
    horaInicio: horaDe(c.inicio),
    horaFin: horaDe(c.fin),
    direccion: c.direccion,
    notas: c.notas,
    idResponsable: c.idUsuario,
    responsable: `${c.usuario.nombre} ${c.usuario.apellido}`.trim(),
    cliente: cliente ? `${cliente.nombre} ${cliente.apellido}`.trim() : "Sin cliente",
    telefono: cliente?.telefono ?? null,
    idSolicitud: c.solicitud?.id ?? null,
    idPedido: c.pedido?.id ?? null,
    folioPedido: c.pedido ? folioDe(c.pedido.id) : null,
  };
}

function responderError(res: import("express").Response, error: unknown, mensaje: string) {
  if (error instanceof ErrorNegocio) {
    res.status(error.estado).json({ error: error.message });
    return;
  }
  console.error("Error en operación de escritorio");
  res.status(500).json({ error: mensaje });
}

// Revisa que el responsable esté libre en ese horario
async function revisarEmpalme(
  tx: Prisma.TransactionClient,
  idUsuario: string,
  inicio: Date,
  fin: Date,
  ignorarId?: string
): Promise<void> {
  const choque = await tx.cita.findFirst({
    where: {
      idUsuario,
      estado: CITA_ACTIVA,
      inicio: { lt: fin },
      fin: { gt: inicio },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { inicio: true, fin: true },
  });

  if (choque) {
    throw new ErrorNegocio(
      409,
      `El responsable ya tiene una cita de ${horaDe(choque.inicio)} a ${horaDe(choque.fin)} ese día.`
    );
  }
}

function validarHorario(fecha: string, horaInicio: string, horaFin: string): { inicio: Date; fin: Date } {
  const inicio = aFecha(fecha, horaInicio);
  const fin = aFecha(fecha, horaFin);

  if (fin <= inicio) throw new ErrorNegocio(400, "La hora de fin debe ser después de la hora de inicio.");
  if (inicio < inicioDeHoy()) throw new ErrorNegocio(400, "No se pueden agendar citas en días pasados.");

  return { inicio, fin };
}

// ---------------------------------------------------------------------
// GET /citas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD  ->  citas del rango (incluye canceladas)
// ---------------------------------------------------------------------

citasRouter.get("/", async (req, res) => {
  const desde = fechaTexto.safeParse(req.query.desde);
  const hasta = fechaTexto.safeParse(req.query.hasta);

  if (!desde.success || !hasta.success) {
    res.status(400).json({ error: "Indica el rango de fechas (desde y hasta)." });
    return;
  }

  try {
    const citas = await prisma.cita.findMany({
      where: {
        inicio: { gte: aFecha(desde.data, "00:00"), lt: new Date(aFecha(hasta.data, "00:00").getTime() + 86400000) },
      },
      orderBy: { inicio: "asc" },
      select: seleccionCita,
    });

    res.json({ items: citas.map(aRespuesta) });
  } catch (error) {
    responderError(res, error, "No se pudieron cargar las citas.");
  }
});

// ---------------------------------------------------------------------
// GET /citas/opciones  ->  responsables, solicitudes y pedidos para el formulario
// ---------------------------------------------------------------------

citasRouter.get("/opciones", async (_req, res) => {
  try {
    const [usuarios, solicitudes, pedidos] = await Promise.all([
      prisma.usuario.findMany({
        where: { activo: true },
        orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
        select: { id: true, nombre: true, apellido: true },
      }),
      prisma.solicitud.findMany({
        where: { estado: SOLICITUD_ABIERTA },
        orderBy: { creadoEn: "asc" },
        select: {
          id: true,
          estado: true,
          cliente: { select: { nombre: true, apellido: true, direccion: true } },
          detalles: { select: { producto: { select: { nombre: true } } } },
        },
      }),
      prisma.pedido.findMany({
        where: { estado: PEDIDO_ACTIVO },
        orderBy: { creadoEn: "asc" },
        select: {
          id: true,
          estado: true,
          cliente: { select: { nombre: true, apellido: true, direccion: true } },
        },
      }),
    ]);

    res.json({
      responsables: usuarios.map((u) => ({ id: u.id, nombre: `${u.nombre} ${u.apellido}`.trim() })),
      solicitudes: solicitudes.map((s) => ({
        id: s.id,
        estado: s.estado,
        cliente: `${s.cliente.nombre} ${s.cliente.apellido}`.trim(),
        direccion: s.cliente.direccion,
        productos: s.detalles.map((d) => d.producto.nombre).join(", "),
      })),
      pedidos: pedidos.map((p) => ({
        id: p.id,
        folio: folioDe(p.id),
        estado: p.estado,
        cliente: `${p.cliente.nombre} ${p.cliente.apellido}`.trim(),
        direccion: p.cliente.direccion,
      })),
    });
  } catch (error) {
    responderError(res, error, "No se pudieron cargar las opciones de la agenda.");
  }
});

// ---------------------------------------------------------------------
// POST /citas  ->  agendar una cita
// ---------------------------------------------------------------------

const nuevaSchema = z.object({
  tipo: z.enum(["MEDICION", "ENTREGA", "INSTALACION"], { error: "Selecciona el tipo de cita." }),
  idSolicitud: z.string().trim().min(1).nullable().optional(),
  idPedido: z.string().trim().min(1).nullable().optional(),
  idResponsable: z.string().trim().min(1, "Selecciona al responsable."),
  fecha: fechaTexto,
  horaInicio: horaTexto,
  horaFin: horaTexto,
  direccion: z.string().trim().max(250, "La dirección es demasiado larga.").nullable().optional(),
  notas: z.string().trim().max(500, "Las notas son demasiado largas.").nullable().optional(),
});

citasRouter.post("/", async (req, res) => {
  const resultado = nuevaSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const datos = resultado.data;

  try {
    const { inicio, fin } = validarHorario(datos.fecha, datos.horaInicio, datos.horaFin);

    const cita = await prisma.$transaction(async (tx) => {
      const responsable = await tx.usuario.findFirst({
        where: { id: datos.idResponsable, activo: true },
        select: { id: true },
      });
      if (!responsable) throw new ErrorNegocio(404, "El responsable no existe o está inactivo.");

      let idSolicitud: string | null = null;
      let idPedido: string | null = null;

      if (datos.tipo === "MEDICION") {
        if (!datos.idSolicitud) throw new ErrorNegocio(400, "Selecciona la solicitud que se va a medir.");
        const solicitud = await tx.solicitud.findFirst({
          where: { id: datos.idSolicitud, estado: SOLICITUD_ABIERTA },
          select: { id: true },
        });
        if (!solicitud) throw new ErrorNegocio(409, "La solicitud ya no está abierta.");
        idSolicitud = solicitud.id;
      } else {
        if (!datos.idPedido) throw new ErrorNegocio(400, "Selecciona el pedido.");
        const pedido = await tx.pedido.findFirst({
          where: { id: datos.idPedido, estado: PEDIDO_ACTIVO },
          select: { id: true },
        });
        if (!pedido) throw new ErrorNegocio(409, "El pedido no está activo.");
        idPedido = pedido.id;
      }

      await revisarEmpalme(tx, responsable.id, inicio, fin);

      const creada = await tx.cita.create({
        data: {
          tipo: datos.tipo,
          estado: "PROGRAMADA",
          idUsuario: responsable.id,
          idSolicitud,
          idPedido,
          inicio,
          fin,
          direccion: datos.direccion || null,
          notas: datos.notas || null,
        },
        select: seleccionCita,
      });

      // La solicitud queda marcada con su visita
      if (idSolicitud) {
        await tx.solicitud.updateMany({
          where: { id: idSolicitud, estado: { in: ["NUEVA", "EN_REVISION"] } },
          data: { estado: "VISITA_PROGRAMADA", idUsuarioAsignado: responsable.id },
        });
      }

      return creada;
    });

    res.status(201).json(aRespuesta(cita));
  } catch (error) {
    responderError(res, error, "No se pudo agendar la cita.");
  }
});

// ---------------------------------------------------------------------
// PATCH /citas/:id  ->  marcar realizada, cancelar o reprogramar
// ---------------------------------------------------------------------

const cambioSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("realizada") }),
  z.object({ accion: z.literal("cancelar") }),
  z.object({
    accion: z.literal("reprogramar"),
    fecha: fechaTexto,
    horaInicio: horaTexto,
    horaFin: horaTexto,
    idResponsable: z.string().trim().min(1).optional(),
  }),
]);

citasRouter.patch("/:id", async (req, res) => {
  const resultado = cambioSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: resultado.error.issues[0]?.message ?? "Datos inválidos." });
    return;
  }

  const datos = resultado.data;

  try {
    const cita = await prisma.$transaction(async (tx) => {
      const actual = await tx.cita.findUnique({
        where: { id: req.params.id },
        select: { id: true, estado: true, idUsuario: true, idSolicitud: true },
      });

      if (!actual) throw new ErrorNegocio(404, "La cita no existe.");
      if (actual.estado === "REALIZADA" || actual.estado === "CANCELADA") {
        throw new ErrorNegocio(
          409,
          `La cita ya está ${actual.estado === "REALIZADA" ? "realizada" : "cancelada"}.`
        );
      }

      let data: Prisma.CitaUpdateManyMutationInput & { idUsuario?: string };

      if (datos.accion === "realizada") {
        data = { estado: "REALIZADA" };
      } else if (datos.accion === "cancelar") {
        data = { estado: "CANCELADA" };
      } else {
        const { inicio, fin } = validarHorario(datos.fecha, datos.horaInicio, datos.horaFin);
        const idUsuario = datos.idResponsable ?? actual.idUsuario;

        if (idUsuario !== actual.idUsuario) {
          const responsable = await tx.usuario.findFirst({ where: { id: idUsuario, activo: true }, select: { id: true } });
          if (!responsable) throw new ErrorNegocio(404, "El responsable no existe o está inactivo.");
        }

        await revisarEmpalme(tx, idUsuario, inicio, fin, actual.id);
        data = { estado: "REPROGRAMADA", inicio, fin, idUsuario };
      }

      // Solo cambia si nadie la modificó mientras tanto
      const cambio = await tx.cita.updateMany({ where: { id: actual.id, estado: actual.estado }, data });
      if (cambio.count === 0) throw new ErrorNegocio(409, "Otra persona cambió la cita. Recarga la agenda.");

      // Si se cancela la única visita de una solicitud, la solicitud vuelve a "Nueva"
      if (datos.accion === "cancelar" && actual.idSolicitud) {
        const otras = await tx.cita.count({
          where: { idSolicitud: actual.idSolicitud, estado: CITA_ACTIVA },
        });
        if (otras === 0) {
          await tx.solicitud.updateMany({
            where: { id: actual.idSolicitud, estado: "VISITA_PROGRAMADA" },
            data: { estado: "NUEVA" },
          });
        }
      }

      return tx.cita.findUniqueOrThrow({ where: { id: actual.id }, select: seleccionCita });
    });

    res.json(aRespuesta(cita));
  } catch (error) {
    responderError(res, error, "No se pudo actualizar la cita.");
  }
});
