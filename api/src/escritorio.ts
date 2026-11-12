import express from "express";
import cors from "cors";
import { autenticar, autorizarEscritorio } from "./middleware/autenticacion";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { clientesRouter } from "./clientes";
import { empleadosRouter } from "./empleado";
import { productosRouter } from "./catalogo";
import { finanzasRouter } from "./finanzas";
import { authRouter, cuentaRouter } from "./cuenta";
import { cotizacionesRouter } from "./cotizaciones";
import { pedidosRouter } from "./pedidos";
import { citasRouter } from "./citas";
import { inicioRouter } from "./inicio";
import { inventarioRouter } from "./inventario";
import { movimientosInRouter } from "./movimientos-inventario";

export const app = express();
app.use(cors());
app.use(express.json());
// Solo estas rutas son públicas. El resto pasa siempre por JWT.
app.get("/salud", (_req, res) => { res.json({ ok: true }); });
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/auth\/(login|restablecer-contrasena)\/?$/i.test(req.path)) {
    next();
    return;
  }
  autenticar(req, res, next);
});
app.use("/auth", authRouter);
app.use(autorizarEscritorio);
app.use("/clientes", clientesRouter);
app.use("/finanzas", finanzasRouter);
app.use("/empleados", empleadosRouter);
app.use("/productos", productosRouter);
app.use("/cuenta", cuentaRouter);
app.use("/cotizaciones", cotizacionesRouter);
app.use("/pedidos", pedidosRouter);
app.use("/citas", citasRouter);
// Resumen financiero, existencias y movimientos requieren ADMINISTRADOR.
app.use("/inicio", inicioRouter);
app.use("/inventario", inventarioRouter);
app.use("/movimientos_inventario", movimientosInRouter);

app.get("/productos", async (_req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      where: { activo: true, tipo: "PRODUCTO" },
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        precioDesde: true,
        imagenUrl: true,
        categoria: { select: { nombre: true } },
      },
      orderBy: { nombre: "asc" },
    });
    res.json(productos);
  } catch (error) {
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudieron obtener los productos" });
  }
});

// Solicitud de cotización enviada desde la página (cotizacion.html).
// Crea el cliente, la solicitud (origen WEB) y un detalle por producto.
const solicitudSchema = z.object({
  cliente: z.object({
    nombre: z.string().trim().min(1).max(100),
    apellido: z.string().trim().min(1).max(100),
    telefono: z.string().trim().min(7).max(20),
    correo: z.email().max(150).optional(),
    direccion: z.string().trim().max(250).optional(),
  }),
  descripcion: z.string().trim().max(1000).optional(),
  productos: z
    .array(
      z.object({
        idProducto: z.string().min(1),
        cantidad: z.number().int().min(1).max(999),
        medidasAprox: z.string().trim().max(100).optional(),
        notas: z.string().trim().max(500).optional(),
      })
    )
    .min(1)
    .max(30),
});

app.post("/solicitudes", async (req, res) => {
  const resultado = solicitudSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: "Datos incompletos o inválidos" });
    return;
  }

  const { cliente, descripcion, productos } = resultado.data;

  try {
    // Solo se aceptan productos que existen y están activos
    const ids = [...new Set(productos.map((p) => p.idProducto))];
    const encontrados = await prisma.producto.count({
      where: { id: { in: ids }, activo: true, tipo: "PRODUCTO" },
    });

    if (encontrados !== ids.length) {
      res.status(400).json({ error: "Algún producto ya no está disponible" });
      return;
    }

    const solicitud = await prisma.solicitud.create({
      data: {
        origen: "WEB",
        descripcion,
        cliente: { create: cliente },
        detalles: { create: productos },
      },
      select: { id: true },
    });

    res.status(201).json(solicitud);
  } catch (error) {
    console.error("Error en operación de escritorio");
    res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});
