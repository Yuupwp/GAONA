import { Router } from "express";
import { prisma } from "./lib/prisma";
import bcrypt from "bcryptjs";

export const auntRouter = Router();
auntRouter.post("/login", async (_req, res) => {
    const { usuario, contrasena } = _req.body;

    const existance = await prisma.usuario.findFirst({
        where: {
            usuario
        },
        select: {
            usuario: true,
            passwordHash: true,
            activo: true
        }
    });

    if (!existance?.usuario) {
        res.status(409).json({
            error: "El usuario no existe."
        });
        return;
    };

    if (!existance.activo) {
        res.status(410).json({
            error: "El usuario se encuentra desactivado."
        }); return;
    }

    const contrasenaValida = await bcrypt.compare(
        contrasena,
        existance.passwordHash
    );


    if (!contrasenaValida) {
        res.status(401).json({
            mensaje: "Contraseña equivocada."
        })
    } else {
        res.status(200).json({
            mensaje: "Usuario autenticado."
        })
    }

})
