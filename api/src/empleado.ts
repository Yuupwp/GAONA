import { Router } from "express";
import { prisma } from "./lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { autenticar, soloAdministrador } from "./middleware/autenticacion";
import { enviarCorreo } from "./correo";

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


empleadosRouter.post(
    "/:id/restablecer-contrasena",
    autenticar,
    soloAdministrador,
    async (req, res) => {
        try {
            const id = Array.isArray(req.params.id)
                ? req.params.id[0]
                : req.params.id;

            // Buscar al empleado
            const empleado = await prisma.usuario.findUnique({
                where: { id },
                select: {
                    id: true,
                    nombre: true,
                    apellido: true,
                    correo: true,
                    activo: true,
                },
            });

            if (!empleado) {
                res.status(404).json({
                    error: "No se encontró el empleado.",
                });
                return;
            }

            if (!empleado.correo) {
                res.status(400).json({
                    error: "El empleado no tiene un correo registrado.",
                });
                return;
            }

            if (!empleado.activo) {
                res.status(400).json({
                    error: "No se puede restablecer la contraseña de una cuenta desactivada.",
                });
                return;
            }

            // Generar un token aleatorio y su hash
            const token = randomBytes(32).toString("hex");

            const tokenHash = createHash("sha256")
                .update(token)
                .digest("hex");

            const expiraEn = new Date(Date.now() + 30 * 60 * 1000);

            // Invalidar solicitudes anteriores y crear una nueva
            await prisma.$transaction([
                prisma.tokenRestablecimiento.updateMany({
                    where: {
                        idUsuario: empleado.id,
                        utilizadoEn: null,
                    },
                    data: {
                        utilizadoEn: new Date(),
                    },
                }),

                prisma.tokenRestablecimiento.create({
                    data: {
                        idUsuario: empleado.id,
                        tokenHash,
                        expiraEn,
                    },
                }),
            ]);

            // Construir el enlace
            const urlBase = process.env.RESET_PASSWORD_URL;

            if (!urlBase) {
                throw new Error("Falta configurar RESET_PASSWORD_URL.");
            }

            const enlace = `${urlBase}?token=${encodeURIComponent(token)}`;

            const nombre = `${empleado.nombre} ${empleado.apellido}`;

            // Escapar el nombre para evitar insertar HTML no confiable
            const nombreSeguro = nombre.replace(
                /[&<>"']/g,
                (caracter) => ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[caracter]!
            );

            try {
                await enviarCorreo(
                    empleado.correo,
                    "Restablecimiento de contraseña - GAONA",
                    `
                    <h2>Restablecimiento de contraseña</h2>
                    <p>Hola, ${nombreSeguro}.</p>
                    <p>Se ha solicitado restablecer la contraseña de tu cuenta de GAONA.</p>
                    <p>Para establecer una nueva contraseña, utiliza el siguiente enlace:</p>
                    <p><a href="${enlace}">Restablecer mi contraseña</a></p>
                    <p>Este enlace tiene una vigencia de 30 minutos y solo puede utilizarse una vez.</p>
                    <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
                    `
                );
            } catch (error) {
                // Invalidar el token si no se pudo enviar el correo
                await prisma.tokenRestablecimiento.updateMany({
                    where: { tokenHash },
                    data: { utilizadoEn: new Date() },
                });

                throw error;
            }

            res.json({
                mensaje: "Se envió el correo de restablecimiento correctamente.",
            });

        } catch (error) {
            console.error("Error al solicitar restablecimiento:", error);

            res.status(500).json({
                error: "No se pudo enviar el correo de restablecimiento.",
            });
        }
    }
);
