import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";

let mainWindow: BrowserWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,

        webPreferences: {
        preload: path.join(__dirname, "preload.js")
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://wa.me/")) {
        shell.openExternal(url);
    }
    return { action: "deny" };
});
    mainWindow.loadFile(
        path.join(__dirname, "../src/renderer/index.html")
    )
}

app.whenReady().then(() => {
    createWindow();

    ipcMain.on("maximize-window", () => {
        mainWindow.maximize();
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});