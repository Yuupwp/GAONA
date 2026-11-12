import { Router } from "express";
import { prisma } from "./lib/prisma";
import { z } from "zod";

export const inventarioRouter = Router();
inventarioRouter.get("/", async (_req, res) => {
    try {
        const inventarios = await prisma.inventario.findMany({
            select: {
                id: true,
                producto: {
                    select: {
                        id: true,
                        nombre: true,
                        categoria: {
                            select: {
                                nombre: true
                            }
                        }
                    },
                },
                existencia: true,
                minimo: true,
            },
            orderBy: {
                actualizadoEn: "asc",
            }
        });

        res.json(inventarios);

    } catch (error) {
        console.error("Error en operación de escritorio");

        res.status(500).json({
            error: "No se pudieron obtener los inventarios"
        });
    }
});

inventarioRouter.patch("/:id/", async (req, res) => {
    try {
        const actualizarInventarioSchema = z.object({
            existencia: z.number().int().min(0).optional(),
            minimo: z.number().int().min(0).optional(),
            motivo: z.string().trim().max(250).optional()
        }).refine(
            (data) => data.existencia !== undefined || data.minimo !== undefined,
            {
                message: "Debes proporcionar al menos un campo para actualizar."
            }
        );

        const { id } = req.params;
        const inventarioId = Array.isArray(id) ? id[0] : id;

        if (!inventarioId) {
            res.status(400).json({
                error: "Identificador de inventario inválido."
            });
            return;
        }

        const resultado = actualizarInventarioSchema.safeParse(req.body);

        if (!resultado.success) {
            res.status(400).json({
                error: "Los datos del inventario no son válidos.",
                detalles: resultado.error.issues
            });
            return;
        }

        const idUsuario = req.usuario?.id;

        if (!idUsuario) {
            res.status(401).json({
                error: "No se pudo identificar al usuario."
            });
            return;
        }

        const {
            existencia,
            minimo,
            motivo
        } = resultado.data;

        const inventarioExistente = await prisma.inventario.findUnique({
            where: { id: inventarioId }
        });

        if (!inventarioExistente) {
            res.status(404).json({
                error: "El inventario no existe."
            });
            return;
        }

        const diferencia = existencia !== undefined
            ? existencia - inventarioExistente.existencia
            : 0;

        const inventarioActualizado = await prisma.$transaction(async (tx) => {

            const inventario = await tx.inventario.update({
                where: { id: inventarioId },
                data: {
                    ...(existencia !== undefined && { existencia }),
                    ...(minimo !== undefined && { minimo })
                }
            });

            if (diferencia !== 0) {
                await tx.movimientoInventario.create({
                    data: {
                        idInventario: inventario.id,
                        idUsuario,
                        tipo: diferencia > 0 ? "ENTRADA" : "SALIDA",
                        cantidad: Math.abs(diferencia),
                        motivo: motivo ?? "Ajuste de inventario"
                    },
                });
            }

            return inventario;
        });

        res.status(200).json({
            mensaje: "Inventario actualizado con éxito",
            inventario: inventarioActualizado,
        });

    } catch (error) {
        console.error("Error en operación de escritorio");

        res.status(500).json({
            error: "No se pudo actualizar el inventario."
        });
    }
});