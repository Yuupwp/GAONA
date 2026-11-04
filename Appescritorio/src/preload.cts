import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
    maximizeWindow: () => {
        ipcRenderer.send("maximize-window");
    }
});