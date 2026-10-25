import express from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import cors from "cors";
import { z } from "zod";
import { type ComprobanteSolicitud } from "./solicitud-estimado";
import { emitirAcceso, leerAcceso } from "./solicitud-acceso";
import { generarSolicitudPdf } from "./solicitud-pdf";
import { crearDocumentos } from "./solicitud-documento";
import { crearServicioCorreo, type ResultadoCorreo } from "./solicitud-correo";
import { crearControlSolicitudes, crearLimiteFrecuencia } from "./solicitud-controles";
import { crearServicioWhatsapp, normalizarTelefonoWhatsapp } from "./solicitud-whatsapp";
import { crearAlmacenWhatsapp } from "./solicitud-whatsapp-almacen";
import { crearWebhookWhatsapp } from "./solicitud-whatsapp-webhook";
import { crearPersistenciaSolicitudes } from "./solicitud-persistencia";
import { registrarSolicitud, ErrorSolicitud } from "./solicitud-registro";
import { correoSolicitud } from "./solicitud-correo-validacion";

type ResultadoCorreoPublico = { estado: ResultadoCorreo["estado"] | "simulado"; modo: "simulado" | "smtp" | "desconocido" };
export type EnsayoCorreo = {
  permitir(correo?: string): boolean;
  registrar(datos: ComprobanteSolicitud, nuevo: boolean): Promise<boolean>;
  presentar(datos: ComprobanteSolicitud, resultado: ResultadoCorreo): Promise<ResultadoCorreoPublico>;
};

export function crearApiWeb(prisma: PrismaClient | undefined, env: NodeJS.ProcessEnv, incluirWhatsapp = false,
  fabricaCorreo?: Parameters<typeof crearServicioCorreo>[1], ensayoCorreo?: EnsayoCorreo,
  servicios?: { catalogo: () => Promise<unknown[]>; persistencia: ReturnType<typeof crearPersistenciaSolicitudes> }) {
  if (!prisma && !servicios) throw new Error("Se requiere un almacenamiento web configurado");
  const obtenerDocumento = crearDocumentos(generarSolicitudPdf);
  const persistencia = servicios?.persistencia ?? crearPersistenciaSolicitudes(prisma!, env, generarSolicitudPdf);
  const enviarCorreo = crearServicioCorreo(env, fabricaCorreo, undefined, undefined, persistencia.activa ? persistencia.correo : undefined);
  const controlarSolicitud = crearControlSolicitudes(undefined, persistencia.activa);
  const whatsapp = incluirWhatsapp ? crearServicioWhatsapp(env, crearAlmacenWhatsapp(prisma!)) : null;
  const limitarEstadoWhatsapp = crearLimiteFrecuencia();
  const limitarEstadoCorreo = crearLimiteFrecuencia();
  const obtenerDocumentoSolicitud = async (datos: ComprobanteSolicitud, retener = false) => {
    if (persistencia.activa) {
      const pdf = await persistencia.documento(datos);
      if (pdf) return pdf;
    }
    return await whatsapp?.pdf(datos.id) ?? obtenerDocumento(datos, retener);
  };

  const app = express();
  if (env.WEB_CORREO_MODO === "smtp") app.use(require("./correo-ensayo-local").guardiaOrigenEnsayo(true));
  app.use(cors({ preflightContinue: !incluirWhatsapp }));
  if (whatsapp) app.use("/webhooks/whatsapp", crearWebhookWhatsapp(whatsapp));
  app.use(express.json());

  app.get("/salud", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/productos", async (_req, res) => {
    try {
      const productos = servicios ? await servicios.catalogo() : await prisma!.producto.findMany({
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
      console.error(incluirWhatsapp ? error : "No se pudieron obtener los productos");
      res.status(500).json({ error: "No se pudieron obtener los productos" });
    }
  });

  const solicitudSchema = z.object({
    sitioWeb: z.string().max(0).optional(),
    cliente: z.object({
      nombre: z.string().trim().min(1).max(100),
      apellido: z.string().trim().min(1).max(100),
      telefono: z.string().trim().min(7).max(20)
        .refine(valor => /^\+?[\d ().-]+$/.test(valor) && valor.replace(/\D/g, "").length >= 7),
      correo: correoSolicitud.optional(),
      direccion: z.string().trim().max(250).optional(),
    }),
    whatsappConsentimiento: z.boolean().default(false),
    descripcion: z.string().trim().max(1000).optional(),
    productos: z
      .array(
        z.object({
          idProducto: z.string().min(1),
          cantidad: z.number().int().min(1).max(999),
          medidasAprox: z.string().trim().max(100).optional(),
          notas: z.string().trim().max(500).optional(),
        })
      )
      .min(1)
      .max(30),
  }).superRefine((datos, ctx) => {
    if (datos.whatsappConsentimiento && !normalizarTelefonoWhatsapp(datos.cliente.telefono)) {
      ctx.addIssue({ code: "custom", path: ["cliente", "telefono"], message: "Usa un número internacional válido para WhatsApp" });
    }
  });

  app.post("/solicitudes", async (req, res) => {
    const resultado = solicitudSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({
        codigo: "DATOS_INVALIDOS",
        error: "Datos incompletos o inválidos",
        campos: [...new Set(resultado.error.issues.map(issue => issue.path.join(".")))].slice(0, 50),
      });
      return;
    }

    if (ensayoCorreo && !ensayoCorreo.permitir(resultado.data.cliente.correo)) {
      res.status(403).json({ codigo: "CORREO_NO_AUTORIZADO", error: "El correo no está autorizado para este ensayo local.", campos: ["cliente.correo"] });
      return;
    }

    const ip = req.ip ?? "desconocida";
    const clave = typeof req.get === "function" ? req.get("Idempotency-Key") : undefined;
    const control = controlarSolicitud(clave, resultado.data, ip);
    res.setHeader("Cache-Control", "no-store");
    if (control.tipo === "repetido") {
      const anterior = await control.pendiente;
      res.status(anterior.codigo).json(anterior.cuerpo);
      return;
    }
    if (control.tipo !== "nuevo") {
      const codigo = control.tipo === "conflicto" ? 409 : control.tipo === "limitado" ? 429 : 400;
      if (codigo === 429) res.setHeader("Retry-After", "900");
      res.status(codigo).json({ codigo: codigo === 400 ? "CLAVE_INVALIDA" : undefined, error: codigo === 429 ? "Demasiadas solicitudes. Intenta más tarde." : "Identificador de envío inválido o ya utilizado con otros datos." });
      return;
    }
    const responder = (codigo: number, cuerpo: unknown) => {
      control.completar({ codigo, cuerpo });
      res.status(codigo).json(cuerpo);
    };
    const { cliente } = resultado.data;

    try {
      const crearRegistro = (db: Pick<Prisma.TransactionClient, "producto" | "solicitud">) => registrarSolicitud(db, resultado.data);
      const persistido = persistencia.activa ? await persistencia.registrar(clave, resultado.data, crearRegistro, ip) :
        await whatsapp?.registrar(clave, resultado.data, resultado.data.whatsappConsentimiento, cliente.telefono, crearRegistro);
      const comprobante = persistido?.comprobante ?? await crearRegistro(prisma!);
      const solicitud = { id: comprobante.id, creadoEn: comprobante.fecha };
      const obtenerPdf = () => obtenerDocumentoSolicitud(comprobante, true);
      let pdf = null;
      try {
        pdf = emitirAcceso(comprobante);
      } catch {
        console.error("No se pudo preparar el acceso al PDF de la solicitud");
      }
      let envioWhatsapp;
      try {
        envioWhatsapp = persistido?.repetido && whatsapp ? { estado: await whatsapp.estado(comprobante.id, comprobante.cliente.telefono) } :
          persistido && whatsapp ? await whatsapp.enviar(comprobante, resultado.data.whatsappConsentimiento, obtenerPdf) :
            { estado: resultado.data.whatsappConsentimiento ? "no_disponible" : "sin_consentimiento" };
      } catch { envioWhatsapp = { estado: "no_confirmado" }; }
      let correo: ResultadoCorreo | ResultadoCorreoPublico;
      try {
        const permitido = ensayoCorreo ? await ensayoCorreo.registrar(comprobante, !persistido?.repetido) : true;
        correo = !permitido || (persistido?.repetido && !persistencia.activa) ? await enviarCorreo.estado(comprobante) :
          pdf && req.get?.("Prefer") === "respond-async" ? await enviarCorreo.iniciar(comprobante, ip, obtenerPdf) :
            await enviarCorreo(comprobante, ip, obtenerPdf);
        if (ensayoCorreo) correo = await ensayoCorreo.presentar(comprobante, correo);
      } catch {
        correo = { estado: "no_confirmado" };
      }
      responder(201, { ...solicitud, estimado: comprobante.estimado, pdf, correo, whatsapp: envioWhatsapp });
    } catch (error) {
      if (error instanceof ErrorSolicitud) {
        responder(error.codigo, { codigo: error.tipo, error: error.message, id: error.solicitudId });
        return;
      }
      console.error("No se pudo registrar la solicitud");
      responder(500, { error: "No se pudo confirmar el registro de la solicitud. Reintenta sin modificar los datos." });
    }
  });

  app.post("/solicitudes/correo/estado", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const comprobante = leerAcceso(req.body?.token);
    if (!comprobante) { res.status(403).json({ error: "El acceso al estado no es válido o ha caducado" }); return; }
    if (!limitarEstadoCorreo([
      { clave: `estado:${req.ip}`, maximo: 30, periodo: 60000 },
      { clave: "estado:global", maximo: 300, periodo: 60000 },
    ])) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Consulta el estado más tarde" }); return; }
    try {
      const resultado = await enviarCorreo.estado(comprobante);
      res.json(ensayoCorreo ? await ensayoCorreo.presentar(comprobante, resultado) : resultado);
    }
    catch { res.status(503).json({ error: "No se pudo consultar el estado del correo. Tu solicitud sigue registrada." }); }
  });

  if (whatsapp) app.post("/solicitudes/whatsapp/estado", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const comprobante = leerAcceso(req.body?.token);
    if (!comprobante) { res.status(403).json({ error: "El acceso al estado no es válido o ha caducado" }); return; }
    if (!limitarEstadoWhatsapp([
      { clave: `estado:${req.ip}`, maximo: 30, periodo: 60000 },
      { clave: "estado:global", maximo: 300, periodo: 60000 },
    ])) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Consulta el estado más tarde" }); return; }
    try { res.json({ estado: await whatsapp.estado(comprobante.id, comprobante.cliente.telefono) }); }
    catch { res.status(503).json({ error: "No se pudo consultar el estado de WhatsApp. Tu solicitud sigue registrada." }); }
  });

  app.post("/solicitudes/pdf", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const comprobante = leerAcceso(req.body?.token);
    if (!comprobante) {
      res.status(403).json({ error: "El acceso al PDF no es válido o ha caducado. Tu solicitud sigue registrada." });
      return;
    }
    try {
      const pdf = await obtenerDocumentoSolicitud(comprobante);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="GAONA-solicitud-${comprobante.id.replace(/[^a-zA-Z0-9-]/g, "")}.pdf"`);
      res.send(pdf);
    } catch (error) {
      if (error instanceof ErrorSolicitud && error.codigo === 410) { res.status(410).json({ error: error.message }); return; }
      res.status(503).json({ error: "No se pudo generar el PDF. Tu solicitud sigue registrada; puedes reintentar la descarga." });
    }
  });

  if (!incluirWhatsapp) {
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const estado = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
      const codigo = estado === 400 || estado === 413 ? estado : 500;
      res.status(codigo).json({ error: codigo === 413 ? "Solicitud demasiado grande" : codigo === 400 ? "Datos incompletos o inválidos" : "No se pudo completar la operación" });
    });
  }
  return app;
}
