import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma";

// /auth/login  -> inicio de sesión
// /cuenta/:id  -> datos personales y contraseña del usuario que inició sesión
export const authRouter = Router();
export const cuentaRouter = Router();

// ---------------------------------------------------------------------
// Permisos por rol: secciones del menú que puede ver cada rol
// ---------------------------------------------------------------------

const PERMISOS: Record<string, string[]> = {
  ADMINISTRADOR: [
    "inicio",
    "clientes",
    "cotizaciones",
    "finanzas",
    "pedidos",
    "agenda",
    "inventario",
    "empleados",
    "cuenta",
  ],
  EMPLEADO: ["cotizaciones", "agenda", "cuenta"],
};

function permisosDe(rol: string): string[] {
  return PERMISOS[rol] ?? ["cuenta"];
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Hash de una contraseña inexistente: se compara aunque el usuario no exista,
// para que la respuesta tarde lo mismo y no se pueda adivinar quién existe.
const HASH_FALSO =
  "$2b$12$2BF4YfU1J5X8zZaUBvlPre4n8smeHXzpfSEFI4B8DKXvTLudG218m";

const COSTO_HASH = 12; // el mismo que usa el módulo de Empleados

const PERFIL = {
  id: true,
  nombre: true,
  apellido: true,
  usuario: true,
  correo: true,
  telefono: true,
  activo: true,
  creadoEn: true,
  rol: { select: { nombre: true } },
} as const;

function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Los datos no son válidos.";
}

// ---------------------------------------------------------------------
// Límite de intentos fallidos (en memoria): 5 fallos -> 5 minutos de espera
// ---------------------------------------------------------------------

const MAX_INTENTOS = 5;
const ESPERA_MS = 5 * 60 * 1000;
const intentos = new Map<string, { fallos: number; hasta: number }>();

function segundosDeEspera(clave: string): number {
  const registro = intentos.get(clave);

  if (!registro || registro.hasta <= Date.now()) return 0;

  return Math.ceil((registro.hasta - Date.now()) / 1000);
}

function registrarFallo(clave: string): void {
  const registro = intentos.get(clave);
  const fallos = (registro && registro.hasta > Date.now() ? 0 : registro?.fallos ?? 0) + 1;

  intentos.set(clave, {
    fallos,
    hasta: fallos >= MAX_INTENTOS ? Date.now() + ESPERA_MS : 0,
  });
}

function limpiarFallos(clave: string): void {
  intentos.delete(clave);
}

function mensajeDeEspera(segundos: number): string {
  const minutos = Math.ceil(segundos / 60);

  return `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`;
}

// ---------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------

const loginSchema = z.object({
  usuario: z.string().trim().min(1, "El usuario es obligatorio.").max(150),
  contrasena: z.string().min(1, "La contraseña es obligatoria.").max(200),
});

authRouter.post("/login", async (req, res) => {
  const resultado = loginSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: primerError(resultado.error) });
    return;
  }

  const { usuario, contrasena } = resultado.data;
  const clave = `login:${usuario.toLowerCase()}`;

  const espera = segundosDeEspera(clave);

  if (espera > 0) {
    res.status(429).json({ error: mensajeDeEspera(espera) });
    return;
  }

  try {
    // Se puede entrar con el usuario o con el correo
    const encontrado = await prisma.usuario.findFirst({
      where: {
        OR: [
          { usuario: { equals: usuario, mode: "insensitive" } },
          { correo: { equals: usuario, mode: "insensitive" } },
        ],
      },
      select: { ...PERFIL, passwordHash: true },
    });

    const coincide = await bcrypt.compare(
      contrasena,
      encontrado?.passwordHash ?? HASH_FALSO
    );

    if (!encontrado || !coincide) {
      registrarFallo(clave);
      res.status(401).json({ error: "Usuario o contraseña incorrectos." });
      return;
    }

    if (!encontrado.activo) {
      res.status(403).json({
        error: "Tu cuenta está desactivada. Contacta a un administrador.",
      });
      return;
    }

    limpiarFallos(clave);

    const { passwordHash: _omitido, ...perfil } = encontrado;

    res.json({ ...perfil, permisos: permisosDe(perfil.rol.nombre) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo iniciar sesión." });
  }
});

// ---------------------------------------------------------------------
// GET /cuenta/:id  ->  datos de la cuenta
// ---------------------------------------------------------------------

cuentaRouter.get("/:id", async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: PERFIL,
    });

    if (!usuario) {
      res.status(404).json({ error: "La cuenta no existe." });
      return;
    }

    if (!usuario.activo) {
      res.status(403).json({ error: "Tu cuenta está desactivada." });
      return;
    }

    res.json({ ...usuario, permisos: permisosDe(usuario.rol.nombre) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar tu cuenta." });
  }
});

// ---------------------------------------------------------------------
// PATCH /cuenta/:id  ->  actualizar datos personales
// (el rol NO se puede cambiar aquí: eso lo hace un administrador en Empleados)
// ---------------------------------------------------------------------

const perfilSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio.").max(100, "El nombre es demasiado largo."),
  apellido: z.string().trim().min(1, "El apellido es obligatorio.").max(100, "El apellido es demasiado largo."),
  usuario: z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres.").max(80, "El usuario es demasiado largo."),
  correo: z.string().trim().min(1, "El correo es obligatorio.").email("El correo no es válido.").max(150, "El correo es demasiado largo."),
  telefono: z
    .string()
    .trim()
    .optional()
    .transform((valor) => (valor ?? "").replace(/\D/g, ""))
    .refine((valor) => valor === "" || valor.length === 10, {
      message: "El teléfono debe tener 10 dígitos.",
    }),
});

cuentaRouter.patch("/:id", async (req, res) => {
  const resultado = perfilSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: primerError(resultado.error) });
    return;
  }

  const datos = resultado.data;

  try {
    const actual = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: { id: true, activo: true },
    });

    if (!actual) {
      res.status(404).json({ error: "La cuenta no existe." });
      return;
    }

    if (!actual.activo) {
      res.status(403).json({ error: "Tu cuenta está desactivada." });
      return;
    }

    const repetido = await prisma.usuario.findFirst({
      where: {
        id: { not: actual.id },
        OR: [
          { usuario: { equals: datos.usuario, mode: "insensitive" } },
          { correo: { equals: datos.correo, mode: "insensitive" } },
        ],
      },
      select: { usuario: true, correo: true },
    });

    if (repetido) {
      const mismoUsuario =
        repetido.usuario.toLowerCase() === datos.usuario.toLowerCase();

      res.status(409).json({
        error: mismoUsuario
          ? "Ese nombre de usuario ya está en uso."
          : "Ese correo ya está registrado en otra cuenta.",
      });
      return;
    }

    const usuario = await prisma.usuario.update({
      where: { id: actual.id },
      data: {
        nombre: datos.nombre,
        apellido: datos.apellido,
        usuario: datos.usuario,
        correo: datos.correo,
        telefono: datos.telefono === "" ? null : datos.telefono,
      },
      select: PERFIL,
    });

    res.json({ ...usuario, permisos: permisosDe(usuario.rol.nombre) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron guardar los cambios." });
  }
});

// ---------------------------------------------------------------------
// PATCH /cuenta/:id/contrasena  ->  cambiar la contraseña
// ---------------------------------------------------------------------

const contrasenaSchema = z
  .object({
    actual: z.string().min(1, "Escribe tu contraseña actual.").max(200),
    nueva: z
      .string()
      .min(8, "La nueva contraseña debe tener al menos 8 caracteres.")
      .max(72, "La nueva contraseña no puede pasar de 72 caracteres."),
    confirmar: z.string(),
  })
  .refine((datos) => datos.nueva === datos.confirmar, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmar"],
  })
  .refine((datos) => datos.nueva !== datos.actual, {
    message: "La nueva contraseña debe ser distinta a la actual.",
    path: ["nueva"],
  });

cuentaRouter.patch("/:id/contrasena", async (req, res) => {
  const resultado = contrasenaSchema.safeParse(req.body);

  if (!resultado.success) {
    res.status(400).json({ error: primerError(resultado.error) });
    return;
  }

  const { actual, nueva } = resultado.data;
  const clave = `contrasena:${req.params.id}`;

  const espera = segundosDeEspera(clave);

  if (espera > 0) {
    res.status(429).json({ error: mensajeDeEspera(espera) });
    return;
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: { id: true, activo: true, passwordHash: true },
    });

    if (!usuario) {
      res.status(404).json({ error: "La cuenta no existe." });
      return;
    }

    if (!usuario.activo) {
      res.status(403).json({ error: "Tu cuenta está desactivada." });
      return;
    }

    const coincide = await bcrypt.compare(actual, usuario.passwordHash);

    if (!coincide) {
      registrarFallo(clave);
      res.status(401).json({ error: "La contraseña actual es incorrecta." });
      return;
    }

    limpiarFallos(clave);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await bcrypt.hash(nueva, COSTO_HASH) },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cambiar la contraseña." });
  }
});