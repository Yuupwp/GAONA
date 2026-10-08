import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./lib/prisma";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/salud", (_req, res) => {
  res.json({ ok: true });
});

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
    console.error(error);
    res.status(500).json({ error: "No se pudieron obtener los productos" });
  }
});

// Solicitud de cotización enviada desde la página (cotizacion.html).
// Crea el cliente, la solicitud (origen WEB) y un detalle por producto.
// Los precios no se reciben: la cotización formal la arma un empleado.
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
      where: { id: { in: ids }, activo: true },
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
    console.error(error);
    res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));