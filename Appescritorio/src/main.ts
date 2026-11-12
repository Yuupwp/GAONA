import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "url";
import path from "path";
// 1. Importa dotenv y el SDK oficial de Gemini
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Inicializa Gemini usando tu variable de entorno privada
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
        const esPdfCotizacion = /^http:\/\/localhost:3001\/cotizaciones\/[\w-]+\/pdf$/.test(url);

        if (url.startsWith("https://wa.me/") || esPdfCotizacion) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    mainWindow.loadFile(
        path.join(__dirname, "../src/renderer/index.html")
    );
    
    if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
}

    mainWindow.webContents.on("console-message", (_event, _level, message) => {
        console.log("CONSOLA DE GAONA:", message);
    });
}

app.whenReady().then(() => {
    createWindow();

    mainWindow.maximize();

    // 3. Canal seguro para que la IA responda a tus vistas del renderer
    ipcMain.handle("gemini:generar", async (_event, promptText: string) => {
        // Si un modelo falla, prueba el siguiente
        const modelos = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];
        let ultimoError = "";

        for (const model of modelos) {
            for (let intento = 0; intento < 2; intento++) {
                try {
                    const response = await ai.models.generateContent({
                        model,
                        contents: promptText,
                    });
                    return { success: true, text: response.text };
                } catch (error: any) {
                    ultimoError = error.message;
                    console.error(`Error con ${model}:`, error.message);
                    await new Promise((r) => setTimeout(r, 1500));
                }
            }
        }

        return { success: false, error: ultimoError };
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