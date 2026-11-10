import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,

        webPreferences: {
            preload: path.join(__dirname, "preload.cjs")
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // El PDF de una cotización se abre en el navegador (ahí se imprime o se guarda)
        const esPdfCotizacion = /^http:\/\/localhost:3001\/cotizaciones\/[\w-]+\/pdf$/.test(url);

        if (url.startsWith("https://wa.me/") || esPdfCotizacion) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });
    mainWindow.loadFile(
        path.join(__dirname, "../src/renderer/index.html")
    );
    mainWindow.webContents.openDevTools({ mode: "detach" });

    mainWindow.webContents.on("console-message", (_event, _level, message) => {
        console.log("CONSOLA DE GAONA:", message);
    });
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