import { Router } from "express";
import { TipoProducto } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { z } from "zod";
import { error } from "node:console";
import { isNumberObject } from "node:util/types";

export const productosRouter = Router();
productosRouter.get("/", async (_req, res) => {
    try {
        const productos = await prisma.producto.findMany({
            select: {
                id: true,
                nombre: true,
                tipo: true,
                descripcion: true,
                precioDesde: true,
                imagenUrl: true,
                activo: true,
                categoria: {
                    select: {
                        id: true,
                        nombre: true,
                    },
                },
                inventario: {
                    select: {
                        existencia: true,
                        minimo: true,
                    },
                },
            }, orderBy: {
                creadoEn: "asc",
            },
        });
        res.json(productos);
    } catch (error) {
        console.error("Error en operación de escritorio");
        res.status(500).json({
            error: "No se pudieron obtener los productos",
        });
    }
});

productosRouter.post("/", async (req, res) => {
    const nuevoProductoschema = z.object({
        nombre: z.string().trim().min(1).max(100),
        tipo: z.enum(["PRODUCTO", "MATERIAL", "HERRAMIENTA"]),
        descripcion: z.string().trim().min(1).max(200),
        precioDesde: z.number().min(10),
        imagenUrl: z.string().trim().nullable().optional(),
        idcategoria: z.string().uuid(),
    });
    try {
        const resultado = nuevoProductoschema.safeParse(req.body);
        if (!resultado.success) {
            res.status(400).json({
                error: "Los datos del producto no son válidos.",
                detalles: resultado.error.issues,
            }); return;
        } const {
            nombre,
            tipo,
            descripcion,
            precioDesde,
            imagenUrl,
            idcategoria,
        } = resultado.data;

        const existence = await prisma.producto.findFirst({
            where: {
                OR: [
                    { nombre },
                    { descripcion },
                ],
            },
            select: {
                nombre: true,
                descripcion: true,
            },
        });
        if (existence) {
            res.status(409).json({
                error: "El producto ya ha sido registrado previamente."
            }); return;
        }

        const categoria = await prisma.categoria.findUnique({
            where: { id: idcategoria },
        });

        if (!categoria) {
            res.status(400).json({
                error: "La categoría seleccionada no existe",
            }); return;
        }

        const producto = await prisma.producto.create({
            data: {
                nombre,
                tipo,
                descripcion,
                precioDesde,
                imagenUrl: imagenUrl || null,
                categoria: {
                    connect: { id: categoria.id }
                },
                inventario: {
                    create: { existencia: 0, minimo: 1 }
                },
            },
            select: {
                id: true,
                nombre: true,
                descripcion: true,
                precioDesde: true,
                imagenUrl: true,
                activo: true,
                categoria: {
                    select: {
                        id: true,
                        nombre: true,
                    },
                },
                inventario: {
                    select: {
                        existencia: true,
                        minimo: true
                    }
                }
            },
        });
        res.status(201).json({
            mensaje: "Producto creado correctamente.",
            producto,
        });
    } catch (error) {
        console.error("Error en operación de escritorio");

        res.status(500).json({
            error: "No se pudo crear el producto."
        });
    }
});

productosRouter.patch("/:id/", async (req, res) => {
    try {
        const actualizarProductoSchema = z.object({
            nombre: z.string().trim().min(1).max(100).optional(),
            tipo: z.enum(["PRODUCTO", "MATERIAL", "HERRAMIENTA"]).optional(),
            descripcion: z.string().trim().max(500).optional(),
            precioDesde: z.number().min(10).optional(),
            imagenUrl: z.string().trim().nullable().optional(),
            idcategoria: z.string().uuid().optional(),
            activo: z.boolean().optional()
        });

        const { id } = req.params;

        const resultado = actualizarProductoSchema.safeParse(req.body);

        if (!resultado.success) {
            res.status(400).json({
                error: "Los datos del producto no son válidos.",
                detalles: resultado.error.issues
            });
            return;
        }

        if (Object.keys(resultado.data).length === 0) {
            res.status(400).json({
                error: "Debes proporcionar al menos un campo para actualizar."
            });
            return;
        }

        const productoExistente = await prisma.producto.findUnique({
            where: { id }
        });

        if (!productoExistente) {
            res.status(404).json({
                error: "El producto no existe."
            });
            return;
        }

        const { idcategoria } = resultado.data;

        if (idcategoria !== undefined) {
            const categoria = await prisma.categoria.findUnique({
                where: { id: idcategoria }
            });

            if (!categoria) {
                res.status(400).json({
                    error: "La categoría seleccionada no existe.",
                });
                return;
            }
        }

        const {
            nombre,
            tipo,
            descripcion,
            precioDesde,
            imagenUrl,
            activo
        } = resultado.data;

        const productoActualizado = await prisma.producto.update({
            where: { id },
            data: {
                ...(nombre !== undefined && { nombre }),
                ...(tipo !== undefined && { tipo }),
                ...(descripcion !== undefined && { descripcion }),
                ...(precioDesde !== undefined && { precioDesde }),
                ...(imagenUrl !== undefined && { imagenUrl }),
                ...(activo !== undefined && { activo }),

                ...(idcategoria !== undefined && {
                    categoria: {
                        connect: { id: idcategoria }
                    }
                })
            }
        });

        res.status(200).json({
            mensaje: "Producto actualizado correctamente.",
            producto: productoActualizado,
        });

    } catch (error) {
        console.error("Error en operación de escritorio");

        res.status(500).json({
            error: "No se pudo actualizar el producto."
        });
    }
});