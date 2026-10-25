import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { calcularEstimado, type ComprobanteSolicitud } from "./solicitud-estimado";
import { ErrorSolicitud, type DatosSolicitud } from "./solicitud-registro";
import { serializarSolicitud } from "./solicitud-persistencia";
import { generarSolicitudPdf } from "./solicitud-pdf";
import { LIMITE_PDF_BYTES } from "./solicitud-documento";
import type { AlmacenCorreo } from "./solicitud-correo-almacen";
import { crearEnsayoCorreoLocal } from "./correo-ensayo-local";
import type { EnsayoCorreo } from "./api-web";
import type { EstadoCorreo } from "./solicitud-correo";
import { correoValido } from "./solicitud-correo-validacion";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
type Producto = { id: string; nombre: string; descripcion: string | null; precioDesde: string; imagenUrl: string | null; categoria: { nombre: string } | null };
type Sesion = { access_token: string; refresh_token: string; expires_at: number };
export function crearClienteDataApi(env: NodeJS.ProcessEnv, opciones: { fetch?: typeof fetch; ahora?: () => number } = {}) {
  const origin: string = require("../scripts/config-data-api.cjs").validarDataApi(env);
  const pedir = opciones.fetch ?? fetch, ahora = opciones.ahora ?? Date.now;
  let session: Sesion | undefined, pending: Promise<Sesion> | undefined;
  const fail = () => new ErrorSolicitud(503, "DATA_API_NO_DISPONIBLE", "No se pudo confirmar la operación en la base compartida. Conserva los datos y el identificador de solicitud.");
  const auth = async (): Promise<Sesion> => {
    if (session && session.expires_at > ahora() / 1000 + 60) return session;
    if (pending) return pending;
    pending = (async () => {
      const refresh = session?.refresh_token;
      let response: Response;
      try {
        response = await pedir(`${origin}/auth/v1/token?grant_type=${refresh ? "refresh_token" : "password"}`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" },
          body: JSON.stringify(refresh ? { refresh_token: refresh } : { email: env.SUPABASE_AUTH_EMAIL, password: env.SUPABASE_AUTH_PASSWORD }),
        });
        if (!response.ok) { session = undefined; throw fail(); }
        const data = await response.json();
        const claims = JSON.parse(Buffer.from(String(data.access_token).split(".")[1], "base64url").toString());
        if (data.user?.id !== env.SUPABASE_AUTH_UID || claims.sub !== env.SUPABASE_AUTH_UID || claims.role !== "authenticated" ||
          claims.iss !== `${origin}/auth/v1` || !Number.isFinite(claims.exp) || claims.exp <= ahora() / 1000 + 60 || typeof data.refresh_token !== "string" || !data.refresh_token) throw fail();
        session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: claims.exp };
        return session;
      } catch { throw fail(); }
    })();
    try { return await pending; } finally { pending = undefined; }
  };
  const request = async (route: string, body?: unknown): Promise<any> => {
    const current = await auth();
    try {
      const response = await pedir(origin + route, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) { if (response.status === 401 && session) session.expires_at = 0; throw fail(); }
      return await response.json();
    } catch { throw fail(); }
  };
  return {
    async catalogo(): Promise<Producto[]> {
      const query = new URLSearchParams({ select: "id,nombre,descripcion,precioDesde,imagenUrl,categoria:categorias(nombre)", activo: "eq.true", tipo: "eq.PRODUCTO", order: "nombre.asc" });
      const rows = await request("/rest/v1/productos?" + query);
      if (!Array.isArray(rows) || rows.some(p => typeof p.id !== "string" || typeof p.nombre !== "string" || !new Prisma.Decimal(p.precioDesde).isFinite() || new Prisma.Decimal(p.precioDesde).isNegative())) throw fail();
      return rows.map(p => ({ ...p, precioDesde: new Prisma.Decimal(p.precioDesde).toFixed(2) }));
    },
    async operacion<T = any>(accion: string, args: object = {}): Promise<T> {
      const result = await request("/rest/v1/rpc/gaona_web_operacion", { p_accion: accion, p_args: args });
      if (result?.error) throw new ErrorSolicitud([400,409,410,429].includes(result.status) ? result.status : 503, result.error,
        result.status === 409 ? "El identificador ya corresponde a otros datos." : result.status === 410 ? "El documento ha caducado. La solicitud sigue registrada." : result.status === 429 ? "Demasiadas solicitudes. Conserva el identificador e intenta más tarde." : "Algún producto ya no está disponible.");
      return result;
    },
  };
}
export function crearPersistenciaDataApi(env: NodeJS.ProcessEnv, client = crearClienteDataApi(env), generar = generarSolicitudPdf) {
  const modo = env.WEB_CORREO_MODO ?? "simulado";
  if (!["simulado", "smtp"].includes(modo)) throw Error("Modo de correo no permitido");
  const hmac = (value: string) => createHmac("sha256", Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY!, "hex")).update(value).digest("hex");
  const correo: AlmacenCorreo = {
    estado: id => client.operacion<EstadoCorreo>("correo_estado", { id }),
    reclamar: id => client.operacion("correo_reclamar", { id, reserva: randomUUID(), correo_modo: modo }),
    iniciar: (job, hash) => client.operacion("correo_iniciar", { id: job.solicitud_id, reserva: job.reserva, sha: hash, correo_modo: modo }),
    async finalizar(job, result) { await client.operacion("correo_finalizar", { id: job.solicitud_id, reserva: job.reserva, ...result, correo_modo: modo }); },
  };
  return {
    activa: true, correo,
    async disponible() {
      try {
        const config = await client.operacion("verificar");
        return config?.version === 1 && config.seguridad === true && config.uid === env.SUPABASE_AUTH_UID && config.modo === "simulado" && (modo === "simulado" || config.correo_version === 2 && config.modos_correo?.includes("smtp")) &&
          config.idempotencia_huella === sha(Buffer.from(env.SOLICITUD_IDEMPOTENCY_KEY!, "hex")) && config.acceso_huella === sha(Buffer.from(env.SOLICITUD_PDF_KEY!, "hex"));
      } catch { return false; }
    },
    async registrar(clave: string | undefined, datos: DatosSolicitud, _crear: unknown, ip = "desconocida"): Promise<{ comprobante: ComprobanteSolicitud; repetido: boolean }> {
      if (typeof clave !== "string" || !/^[\w-]{16,80}$/.test(clave)) throw new ErrorSolicitud(400, "CLAVE_INVALIDA", "Se requiere un identificador válido para este intento");
      if (!await this.disponible()) throw new ErrorSolicitud(503, "PERSISTENCIA_NO_DISPONIBLE", "La persistencia compartida no está verificada; no se registró una solicitud nueva.");
      const key = { clave: hmac(`solicitud:${clave}`), huella: hmac(`contenido:${serializarSolicitud(datos)}`) };
      const anterior = await client.operacion("buscar", key); if (anterior) return anterior;
      const catalogo = await client.catalogo();
      if (datos.productos.some(p => !catalogo.some(c => c.id === p.idProducto))) throw new ErrorSolicitud(400, "PRODUCTO_NO_DISPONIBLE", "Algún producto ya no está disponible");
      const { direccion: _direccion, ...cliente } = datos.cliente;
      const comprobante: ComprobanteSolicitud = { id: randomUUID(), fecha: new Date().toISOString(), cliente, descripcion: datos.descripcion,
        estimado: calcularEstimado(datos.productos, catalogo.map(p => ({ ...p, precioDesde: new Prisma.Decimal(p.precioDesde) }))) };
      return client.operacion("registrar", { ...key, origen: hmac(`origen:${ip}`), datos, comprobante, correo_modo: modo });
    },
    async documento(datos: ComprobanteSolicitud): Promise<Buffer | null> {
      for (let intento = 0; intento < 200; intento++) {
        const row = await client.operacion("documento_leer", { id: datos.id }); if (!row) throw new Error("Documento persistente no disponible");
        if (row.estado === "disponible") {
          const pdf = Buffer.from(row.pdf, "base64"); if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0,5).toString() !== "%PDF-" || sha(pdf) !== row.sha) throw Error("Integridad PDF no verificable"); return pdf;
        }
        const reserva = randomUUID();
        if (await client.operacion("documento_reclamar", { id: datos.id, reserva })) {
          try {
            const pdf = await generar(row.comprobante);
            if (pdf.length > LIMITE_PDF_BYTES || pdf.subarray(0,5).toString() !== "%PDF-") throw Error();
            if (await client.operacion("documento_guardar", { id: datos.id, reserva, pdf: pdf.toString("base64"), sha: sha(pdf) })) return pdf;
          } catch { await client.operacion("documento_error", { id: datos.id, reserva }); throw Error("No se pudo preparar el PDF"); }
        } else if (row.estado === "error" && row.intentos >= 3) throw Error("Generación PDF agotada");
        await new Promise(resolve => setTimeout(resolve,50));
      }
      throw Error("PDF en preparación");
    },
  };
}

export function crearEnsayoDataApi(directorio: string, client: ReturnType<typeof crearClienteDataApi>,
  opciones: { modo?: "simulado" | "smtp"; destinatario?: string; fabrica?: Parameters<typeof import("./solicitud-correo").crearServicioCorreo>[1] } = {}) {
  const modo = opciones.modo ?? "simulado";
  if (modo === "smtp" && (!opciones.fabrica)) throw Error("SMTP requiere transporte activado explícitamente");
  const local = crearEnsayoCorreoLocal(directorio, "simulado");
  const politica: EnsayoCorreo = {
    permitir: correo => modo === "simulado" || correoValido.safeParse(correo).success && (!opciones.destinatario || correo === opciones.destinatario),
    async registrar(datos, nuevo) {
      if (!datos.cliente.correo) return true;
      const origin = await client.operacion("correo_origen", { id: datos.id });
      if (origin?.modo !== modo || origin.destinatario !== datos.cliente.correo) return false;
      if (modo === "smtp") return nuevo && (!opciones.destinatario || datos.cliente.correo === opciones.destinatario);
      return local.politica.registrar(datos, true);
    },
    async presentar(datos, resultado) {
      const origin = datos.cliente.correo ? await client.operacion("correo_origen", { id: datos.id }) : { modo };
      if (!["simulado", "smtp"].includes(origin?.modo) || datos.cliente.correo && origin.destinatario !== datos.cliente.correo) return { estado: "no_confirmado", modo: "desconocido" };
      return { estado: origin.modo === "simulado" && resultado.estado === "aceptado" ? "simulado" : resultado.estado, modo: origin.modo };
    },
  };
  return { politica, fabrica: modo === "smtp" ? opciones.fabrica! : local.fabrica };
}
