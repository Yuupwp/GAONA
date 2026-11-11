import { Router } from "express";
import { prisma } from "./lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { error } from "node:console";

export const empleadosRouter = Router();
empleadosRouter.get("/", async (_req, res) => {
    try {
        const empleados = await prisma.usuario.findMany({
            select: {
                id: true,
                nombre: true,
                apellido: true,
                usuario: true,
                correo: true,
                telefono: true,
                activo: true,
                rol: {
                    select: {
                        id: true,
                        nombre: true,
                    },
                },
            },
            orderBy: {
                nombre: "asc",
            },
        });
        res.json(empleados);
    } catch (error) {
        console.error("Error al consultar empleador: ", error);
        res.status(500).json({
            error: "No se pudieron obtener los empleados",
        });
    }
});

empleadosRouter.post("/", async (req, res) => {
    const nuevoEmpleadoSchema = z.object({
        nombre: z.string().trim().min(1).max(100),
        apellido: z.string().trim().min(1).max(100),
        usuario: z.string().trim().min(3).max(80),
        correo: z.string().trim().email().max(150),
        telefono: z.string().trim().max(20).optional(),
        idRol: z.string().uuid(),
        contrasena: z.string().min(8).max(72),
        confirmarcontrasena: z.string().min(8).max(72),
    }).refine(
        (datos) => datos.contrasena === datos.confirmarcontrasena,
        {
            message: "Las contraseñas no coinciden",
            path: ["confirmarcontrasena"]
        }
    );
    try {
        const resultado = nuevoEmpleadoSchema.safeParse(req.body);

        if (!resultado.success) {
            res.status(400).json({
                error: "Los datos del empleado no son válidos",
                detalles: resultado.error.issues,
            });
            return;
        }
        const {
            nombre,
            apellido,
            usuario,
            correo,
            telefono,
            idRol,
            contrasena,
        } = resultado.data;

        const existence = await prisma.usuario.findFirst({
            where: {
                OR: [
                    { correo },
                    { usuario },
                ],
            },
            select: {
                correo: true,
                usuario: true,
            },
        });

        if (existence) {
            res.status(409).json({
                error: "El correo o nombre de usuario ya están registrado"
            });
            return;
        }

        const rol = await prisma.rol.findUnique({
            where: { id: idRol },
        });

        if (!rol) {
            res.status(400).json({
                error: "El rol seleccionado no existe",
            });
            return;
        }

        const passwordHash = await bcrypt.hash(contrasena, 12);

        const empleado = await prisma.usuario.create({
            data: {
                nombre,
                apellido,
                usuario,
                correo,
                telefono: telefono || null,
                passwordHash,
                rol: {
                    connect: { id: rol.id },
                },
            },
            select: {
                id: true,
                nombre: true,
                apellido: true,
                usuario: true,
                correo: true,
                telefono: true,
                activo: true,
                rol: {
                    select: {
                        id: true,
                        nombre: true,
                    },
                },
            },
        });
        res.status(201).json({
            mensaje: "Empleado creado correctamente",
            empleado,
        });
    } catch (error) {
        console.error("Error al crear empleado: ", error);

        res.status(500).json({
            error: "No se pudo crear el empleado",
        });
    }
});


empleadosRouter.patch("/:id", async (req, res) => {
    try {
        const actualizarEmpleadosSchema = z.object({
            nombre: z.string().trim().min(1).max(100).optional(),
            apellido: z.string().trim().min(1).max(100).optional(),
            usuario: z.string().trim().min(3).max(80).optional(),
            correo: z.string().trim().email().max(150).optional(),
            telefono: z.string().trim().max(20).nullable().optional(),
            idRol: z.string().uuid().optional(),
        });

        const { id } = req.params;

        // Validar los datos recibidos
        const resultado = actualizarEmpleadosSchema.safeParse(req.body);

        if (!resultado.success) {
            return res.status(400).json({
                error: "Los datos del empleado no son válidos.",
                detalles: resultado.error.issues
            });
        }

        // Comprobar que se envíe al menos un campo
        if (Object.keys(resultado.data).length === 0) {
            return res.status(400).json({
                error: "Debes proporcionar al menos un campo para actualizar."
            });
        }

        // Buscar al empleado
        const empleadoExistente = await prisma.usuario.findUnique({
            where: { id }
        });

        if (!empleadoExistente) {
            return res.status(404).json({
                error: "El empleado no existe."
            });
        }

        // Comprobar que el usuario no esté ocupado por otra cuenta
        const { usuario, correo, idRol } = resultado.data;

        if (usuario !== undefined) {
            const usuarioExistente = await prisma.usuario.findFirst({
                where: {
                    usuario,
                    NOT: { id }
                }
            });

            if (usuarioExistente) {
                return res.status(409).json({
                    error: "El nombre de usuario ya está registrado."
                });
            }
        }

        // Comprobar que el correo no esté ocupado por otra cuenta
        if (correo !== undefined) {
            const correoExistente = await prisma.usuario.findFirst({
                where: {
                    correo,
                    NOT: { id }
                }
            });

            if (correoExistente) {
                return res.status(409).json({
                    error: "El correo ya está registrado."
                });
            }
        }

        // Validar que el rol exista
        if (idRol !== undefined) {
            const rolExistente = await prisma.rol.findUnique({
                where: { id: idRol }
            });

            if (!rolExistente) {
                return res.status(400).json({
                    error: "El rol seleccionado no existe."
                });
            }
        }

        // Actualizar empleado
        const empleadoActualizado = await prisma.usuario.update({
            where: { id },
            data: {
                ...(resultado.data.nombre !== undefined && {
                    nombre: resultado.data.nombre
                }),

                ...(resultado.data.apellido !== undefined && {
                    apellido: resultado.data.apellido
                }),

                ...(usuario !== undefined && { usuario }),

                ...(correo !== undefined && { correo }),

                ...(resultado.data.telefono !== undefined && {
                    telefono: resultado.data.telefono
                }),

                ...(idRol !== undefined && {
                    rol: {
                        connect: { id: idRol }
                    }
                })
            },
            include: {
                rol: true
            }
        });

        return res.status(200).json({
            mensaje: "Usuario actualizado correctamente.",
            usuario: empleadoActualizado
        });

    } catch (error) {
        console.error("Error al actualizar el usuario:", error);

        return res.status(500).json({
            error: "No se pudo actualizar el usuario."
        });
    }
});


empleadosRouter.patch("/:id/rol", async (req, res) => {
    try {
        const datos = z.object({
            rol: z.enum(["ADMINISTRADOR", "EMPLEADO"]),
        }).safeParse(req.body);

        if (!datos.success) {
            res.status(400).json({
                error: "El rol debe ser ADMINISTRADOR o EMPLEADO",
            });
            return;
        }

        const empleado = await prisma.usuario.findUnique({
            where: {
                id: req.params.id,
            },
        });

        if (!empleado) {
            res.status(404).json({
                error: "No se encontró el empleado",
            });
            return;
        }

        const rol = await prisma.rol.findUnique({
            where: {
                nombre: datos.data.rol
            },
        });

        if (!rol) {
            res.status(404).json({
                error: "No se encontró el rol seleccionado",
            });
            return;
        }
        const empleadoActualizado = await prisma.usuario.update({
            where: {
                id: empleado.id,
            },
            data: {
                rol: {
                    connect: {
                        id: rol.id,
                    },
                },
            },
            select: {
                id: true,
                nombre: true,
                apellido: true,
                correo: true,
                activo: true,
                rol: {
                    select: {
                        id: true,
                        nombre: true,
                    },
                },
            },
        });
    } catch (error) {
        console.error("Error al cambiar el rol: ", error);

        res.status(500).json({
            error: "No se pudo actualizar el rol",
        })
    }
})

empleadosRouter.patch("/:id/estado", async (req, res) => {
    try {
        const datos = z.object({
            activo: z.boolean(),
        }).safeParse(req.body);

        if (!datos.success) {
            res.status(400).json({
                error: "El campo activo debe ser True o False",
            }); return;
        }

        const empleado = await prisma.usuario.findUnique({
            where: {
                id: req.params.id,
            },
        });
        if (!empleado) {
            res.status(404).json({
                error: "No se encontró el empleado",
            });
            return;
        }

        const empleadoActualizado = await prisma.usuario.update({
            where: {
                id: empleado?.id,
            },
            data: {
                activo: datos.data.activo,
            },
            select: {
                id: true,
                nombre: true,
                apellido: true,
                correo: true,
                activo: true,
                rol: {
                    select: {
                        nombre: true,
                    },
                },
            },
        });
        res.json({
            mensaje: datos.data.activo
                ? "Cuenta activada correctamente"
                : "Cuenta desactivada correctamente",
            empleado: empleadoActualizado,
        });
    } catch (error) {
        console.error("Error al cambiar el estado: ", error),

            res.status(500).json({
                error: "No se pudo actualizar el estado de la cuenta",
            });
    }
});
