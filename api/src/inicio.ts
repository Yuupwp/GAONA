import { Router } from "express";
import { prisma } from "./lib/prisma";
import { folioDe, soloFecha } from "./cotizaciones";

export const inicioRouter = Router();

// Pedidos que todavía requieren atención del equipo
const PEDIDO_PENDIENTE = {
  in: ["EN_PROCESO" as const, "LISTO_PARA_INSTALAR" as const],
};

// Una cita "activa" es la que sigue ocupando la agenda
const CITA_ACTIVA = {
  in: ["PROGRAMADA" as const, "REPROGRAMADA" as const],
};

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function horaDe(valor: Date): string {
  return `${String(valor.getHours()).padStart(2, "0")}:${String(valor.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// GET /inicio/resumen  ->  todo lo que muestra la pantalla de Inicio
// ---------------------------------------------------------------------

inicioRouter.get("/resumen", async (_req, res) => {
  try {
    const ahora = new Date();
    const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const inicioDeManana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
    const inicioDeMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    // Semana de lunes a domingo que contiene a hoy
    const desdeLunes = (inicioDeHoy.getDay() + 6) % 7;
    const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - desdeLunes);
    const lunesSiguiente = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7);

    const [solicitudesNuevas, pedidosPendientes, pedidos, citas, cobradoMes] = await Promise.all([
      // Solicitudes que llegaron desde la página y nadie ha atendido
      prisma.solicitud.count({ where: { estado: "NUEVA", origen: "WEB" } }),

      prisma.pedido.count({ where: { estado: PEDIDO_PENDIENTE } }),

      // Los 5 pedidos pendientes más recientes
      prisma.pedido.findMany({
        where: { estado: PEDIDO_PENDIENTE },
        orderBy: { creadoEn: "desc" },
        take: 5,
        select: {
          id: true,
          estado: true,
          creadoEn: true,
          cliente: { select: { nombre: true, apellido: true } },
        },
      }),

      // Citas de la semana (medición, entrega e instalación); las de hoy salen de aquí
      prisma.cita.findMany({
        where: { estado: CITA_ACTIVA, inicio: { gte: lunes, lt: lunesSiguiente } },
        orderBy: { inicio: "asc" },
        select: {
          id: true,
          tipo: true,
          inicio: true,
          fin: true,
          direccion: true,
          usuario: { select: { nombre: true, apellido: true } },
          solicitud: { select: { cliente: { select: { nombre: true, apellido: true } } } },
          pedido: { select: { cliente: { select: { nombre: true, apellido: true } } } },
        },
      }),

      // Lo cobrado en el mes (mismo criterio que Finanzas: sin pedidos cancelados)
      prisma.pago.aggregate({
        _sum: { monto: true },
        where: {
          fecha: { gte: inicioDeMes },
          pedido: { estado: { not: "CANCELADO" } },
        },
      }),
    ]);

    const aCita = (c: (typeof citas)[number]) => {
      const cliente = c.solicitud?.cliente ?? c.pedido?.cliente ?? null;
      return {
        id: c.id,
        tipo: c.tipo,
        fecha: soloFecha(c.inicio),
        horaInicio: horaDe(c.inicio),
        horaFin: horaDe(c.fin),
        direccion: c.direccion,
        cliente: cliente ? `${cliente.nombre} ${cliente.apellido}`.trim() : "Sin cliente",
        responsable: `${c.usuario.nombre} ${c.usuario.apellido}`.trim(),
      };
    };
    const citasHoy = citas.filter((c) => c.inicio >= inicioDeHoy && c.inicio < inicioDeManana);

    res.json({
      solicitudesNuevas,
      pedidosPendientes,
      citasHoy: citasHoy.length,
      cobradoMes: redondear(Number(cobradoMes._sum.monto ?? 0)),
      pedidos: pedidos.map((p) => ({
        id: p.id,
        folio: folioDe(p.id),
        cliente: `${p.cliente.nombre} ${p.cliente.apellido}`.trim(),
        fecha: soloFecha(p.creadoEn),
        estado: p.estado,
      })),
      citas: citasHoy.map(aCita),
      semana: { desde: soloFecha(lunes), hasta: soloFecha(new Date(lunesSiguiente.getTime() - 86400000)) },
      citasSemana: citas.map(aCita),
    });
  } catch (error) {
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudo cargar el resumen de Inicio." });
  }
});