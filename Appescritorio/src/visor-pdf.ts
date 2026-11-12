import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Solo bytes PDF; el renderer no puede elegir rutas ni comandos para shell.
export function crearVisorPdf(abrirArchivo: (ruta: string) => Promise<string>) {
    const directorios = new Set<string>();
    return {
        async abrir(datos: unknown): Promise<void> {
            if (!(datos instanceof ArrayBuffer) || datos.byteLength > 20 * 1024 * 1024) {
                throw new Error("PDF inválido o demasiado grande.");
            }
            const pdf = Buffer.from(datos);
            if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF inválido.");
            const directorio = await mkdtemp(path.join(tmpdir(), "gaona-pdf-"));
            directorios.add(directorio);
            try {
                const archivo = path.join(directorio, "cotizacion.pdf");
                await writeFile(archivo, pdf, { mode: 0o600, flag: "wx" });
                if (await abrirArchivo(archivo)) throw new Error("No se pudo abrir el visor de PDF.");
            } catch {
                await rm(directorio, { recursive: true, force: true });
                directorios.delete(directorio);
                throw new Error("No se pudo abrir el PDF.");
            }
        },
        limpiar() {
            for (const directorio of directorios) rmSync(directorio, { recursive: true, force: true });
            directorios.clear();
        },
    };
}
