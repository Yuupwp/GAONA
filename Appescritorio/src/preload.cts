import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
<<<<<<< HEAD
  maximizeWindow: () => {
    ipcRenderer.send("maximize-window");
  },
  generarIA: (prompt: string) => ipcRenderer.invoke("gemini:generar", prompt),
  leerArchivo: (ruta: string) => ipcRenderer.invoke("leer-archivo", ruta),
=======
    abrirPdf: (datos: ArrayBuffer) => ipcRenderer.invoke("abrir-pdf", datos),
    maximizeWindow: () => {
        ipcRenderer.send("maximize-window");
    }
>>>>>>> origin/main
});