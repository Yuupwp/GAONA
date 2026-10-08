import "dotenv/config";
import express from "express";
import cors from "cors";
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

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));