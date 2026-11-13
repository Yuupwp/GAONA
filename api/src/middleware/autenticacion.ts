
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

if (!JWT_SECRET) {
    throw new Error("Falta configurar JWT_SECRET en el archivo .env");
}

interface DatosToken {
    id: string;
}

declare global {
    namespace Express {
        interface Request {
            usuario?: {
                id: string;
                rol: string;
            };
        }
    }
}

export async function autenticar(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const autorizacion = req.headers.authorization;

        if (!autorizacion?.startsWith("Bearer ")) {
            res.status(401).json({ codigo: "SESION_INVALIDA", error: "No has iniciado sesión." });
            return;
        }

        const token = autorizacion.split(" ")[1];

        const verificado = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });

        if (
            typeof verificado === "string" ||
            typeof verificado.id !== "string"
        ) {
            res.status(401).json({ codigo: "SESION_INVALIDA", error: "Token inválido." });
            return;
        }

        const datos: DatosToken = {
            id: verificado.id
        };

        const usuario = await prisma.usuario.findUnique({
            where: { id: datos.id },
            select: {
                id: true,
                activo: true,
                rol: {
                    select: { nombre: true }
                }
            }
        });

        if (!usuario || !usuario.activo) {
            res.status(401).json({ codigo: "SESION_INVALIDA", error: "Sesión inválida o cuenta desactivada." });
            return;
        }

        req.usuario = {
            id: usuario.id,
            rol: usuario.rol.nombre
        };

        next();

    } catch (error) {
        res.status(401).json({ codigo: "SESION_INVALIDA", error: "Token inválido o sesión expirada." });
    }
}

export function soloAdministrador(
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (req.usuario?.rol !== "ADMINISTRADOR") {
        res.status(403).json({ error: "No tienes permisos para realizar esta acción." });
        return;
    }

    next();
}

// Lista explícita para EMPLEADO; rutas nuevas quedan reservadas al administrador.
export function autorizarEscritorio(req: Request, res: Response, next: NextFunction) {
    if (!req.usuario) { res.status(401).json({ codigo: "SESION_INVALIDA", error: "No has iniciado sesión." }); return; }
    if (req.usuario.rol === "ADMINISTRADOR") { next(); return; }
    const ruta = req.path.toLowerCase().replace(/\/$/, "");
    const lectura = req.method === "GET" || req.method === "HEAD";
    const permitida =
        (ruta === "/productos" && lectura) ||
        (/^\/cuenta\/[^/]+(?:\/contrasena)?$/.test(ruta) && ["GET", "HEAD", "PATCH"].includes(req.method)) ||
        (/^\/citas(?:\/[^/]+)?$/.test(ruta) && ["GET", "HEAD", "POST", "PATCH"].includes(req.method)) ||
        ((ruta === "/cotizaciones" || /^\/cotizaciones\/opciones$/.test(ruta) ||
          /^\/cotizaciones\/[^/]+\/(estado|pdf|enviar)$/.test(ruta)) && ["GET", "HEAD", "POST", "PATCH"].includes(req.method));
    if (req.usuario.rol !== "EMPLEADO" || !permitida) {
        res.status(403).json({ error: "No tienes permisos para realizar esta acción." }); return;
    }
    next();
}
