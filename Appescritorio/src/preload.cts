import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  maximizeWindow: () => {
    ipcRenderer.send("maximize-window");
  },
  generarIA: (prompt: string) => ipcRenderer.invoke("gemini:generar", prompt),
  leerArchivo: (ruta: string) => ipcRenderer.invoke("leer-archivo", ruta),
});