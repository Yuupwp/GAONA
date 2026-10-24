import { createHmac, randomBytes } from "node:crypto";

export function crearLimiteFrecuencia(ahora = Date.now) {
  const sal = randomBytes(32);
  const contadores = new Map<string, { cantidad: number; vence: number }>();
  return (grupos: { clave: string; maximo: number; periodo: number }[]) => {
    const tiempo = ahora();
    for (const [clave, dato] of contadores) if (dato.vence <= tiempo) contadores.delete(clave);
    const claves = grupos.map(g => createHmac("sha256", sal).update(g.clave).digest("hex"));
    if (grupos.some((g, i) => (contadores.get(claves[i])?.cantidad ?? 0) >= g.maximo)) return false;
    if (contadores.size + claves.filter(c => !contadores.has(c)).length > 2000) return false;
    grupos.forEach((g, i) => {
      const dato = contadores.get(claves[i]) ?? { cantidad: 0, vence: tiempo + g.periodo };
      dato.cantidad++;
      contadores.set(claves[i], dato);
    });
    return true;
  };
}

type Resultado = { codigo: number; cuerpo: unknown };
type Entrada = { huella: string; vence: number; pendiente: Promise<Resultado>; completar: (valor: Resultado) => void };

export function crearControlSolicitudes(ahora = Date.now, reintentarErroresPersistentes = false) {
  const sal = randomBytes(32);
  const solicitudes = new Map<string, Entrada>();
  const permitir = crearLimiteFrecuencia(ahora);
  const hash = (valor: string) => createHmac("sha256", sal).update(valor).digest("hex");
  return (clave: unknown, datos: unknown, ip: string) => {
    const tiempo = ahora();
    for (const [id, entrada] of solicitudes) if (entrada.vence <= tiempo) solicitudes.delete(id);
    if (clave !== undefined && (typeof clave !== "string" || !/^[\w-]{16,80}$/.test(clave))) {
      return { tipo: "invalido" as const };
    }
    const huella = hash(JSON.stringify(datos));
    const id = hash(clave === undefined ? `datos:${ip}:${huella}` : `clave:${ip}:${clave}`);
    const existente = solicitudes.get(id);
    if (existente) {
      if (existente.huella !== huella) return { tipo: "conflicto" as const };
      return { tipo: "repetido" as const, pendiente: existente.pendiente };
    }
    if (solicitudes.size >= 1000 || !permitir([
      { clave: `ip:${ip}`, maximo: 10, periodo: 15 * 60 * 1000 },
      { clave: "global", maximo: 100, periodo: 15 * 60 * 1000 },
    ])) return { tipo: "limitado" as const };
    let completar!: (valor: Resultado) => void;
    const pendiente = new Promise<Resultado>(resolve => { completar = resolve; });
    const entrada = { huella, vence: Number.POSITIVE_INFINITY, pendiente, completar };
    solicitudes.set(id, entrada);
    return { tipo: "nuevo" as const, completar: (valor: Resultado) => {
      if (reintentarErroresPersistentes && valor.codigo >= 500) solicitudes.delete(id);
      entrada.vence = ahora() + 30 * 60 * 1000;
      entrada.completar(valor);
    } };
  };
}
