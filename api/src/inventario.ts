import { Router } from "express";
import { TipoProducto } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { z } from "zod";
import { error } from "node:console";
import { isNumberObject } from "node:util/types";

export const inventarioRouter = Router();

inventarioRouter.patch("/:id/", async (req, res) => {
    try {
        const actualizarInventarioschema = z.object({
            existencia: z.number().int().min(0).optional(),
            minimo: z.number().int().min(0).optional(),
            idUsuario: z.string().uuid(),
            motivo: z.string().trim().max(250).optional()
        }).refine(
            (data) => Object.keys(data).length > 0,
            { message: "Debes proporcionar al menos un campo para actualizar." }
        );

        const { id } = req.params;
        const resultado = actualizarInventarioschema.safeParse(req.body);

        if (!resultado.success) {
            res.status(400).json({
                error: "Los datos del inventario no son válidos.",
                detalles: resultado.error.issues
            }); return;
        }

        if (Object.keys(resultado.data).length === 0) {
            res.status(400).json({
                error: "Debes proporcionar al menos un campo para actualizar.",
            }); return;
        }

        const inventarioExistente = await prisma.inventario.findUnique({
            where: { id }
        });

        if (!inventarioExistente) {
            res.status(404).json({
                error: "El inventario no existe."
            }); return;
        };

        const {
            existencia,
            minimo,
            idUsuario,
            motivo
        } = resultado.data

        const diferencia = existencia != undefined
            ? existencia - inventarioExistente.existencia
            : 0;

        const inventarioActualizado = await prisma.$transaction(async (tx) => {

            const invetario = await tx.inventario.update({
                where: { id },
                data: {
                    ...(existencia !== undefined && { existencia }),
                    ...(minimo != undefined && { minimo })
                }
            });
            if (diferencia !== 0) {
                await tx.movimientoInventario.create({
                    data: {
                        idInventario: invetario.id,
                        idUsuario,
                        tipo: diferencia > 0 ? "ENTRADA" : "SALIDA",
                        cantidad: Math.abs(diferencia),
                        motivo: motivo ?? "Ajuste de inventario"
                    },
                });
            } return invetario
        })
        res.status(200).json({
            mensaje: "Inventario actualizado con éxito",
            inventario: inventarioActualizado,
        });
    } catch (error) {
        console.error("Error al actualizar el inventario: ", error);

        res.status(500).json({
            error: "No se pudo actualizar el inventario."
        })
    }
})