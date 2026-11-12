import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
    abrirPdf: (datos: ArrayBuffer) => ipcRenderer.invoke("abrir-pdf", datos),
    maximizeWindow: () => {
        ipcRenderer.send("maximize-window");
    }
});