import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import { crearVisorPdf } from "./visor-pdf.js";

const visorPdf = crearVisorPdf(url => shell.openPath(url));

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
        if (url.startsWith("https://wa.me/")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });
    mainWindow.loadFile(
        path.join(__dirname, "../src/renderer/index.html")
    );
}

app.whenReady().then(() => {
    createWindow();

    ipcMain.handle("abrir-pdf", async (event, datos: unknown) => {
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
            throw new Error("Origen no permitido");
        }
        await visorPdf.abrir(datos);
    });

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
app.on("will-quit", () => visorPdf.limpiar());
