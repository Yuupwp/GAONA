import { Router } from "express";
import { TipoProducto } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { z } from "zod";
import { error } from "node:console";
import { isNumberObject } from "node:util/types";

export const movimientosInRouter = Router();
movimientosInRouter.get("/", async (_req, res) => {
    try {
        const movimientosIn = await prisma.movimientoInventario.findMany({
            select: {
                id: true,
                inventario: {
                    select: {
                        producto: {
                            select: {
                                nombre: true,
                            }
                        }
                    }
                },
                usuario: {
                    select: {
                        usuario: true
                    }
                },
                idPedido: true,
                tipo: true,
                cantidad: true,
                motivo: true,
                fecha: true
            }, orderBy: {
                fecha: "asc",
            },
        });
        res.json(movimientosIn);
    } catch (error) {
        console.error("Error al consultar los movimientos del inventario: ", error);
        res.status(500).json({
            error: "No se pudieron obtener los movimientos"
        })
    }
})