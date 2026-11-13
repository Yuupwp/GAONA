import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "url";
import path from "path";
<<<<<<< HEAD
import fs from "fs";
// 1. Importa dotenv y el SDK oficial de Gemini
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
=======
import { crearVisorPdf } from "./visor-pdf.js";

const visorPdf = crearVisorPdf(url => shell.openPath(url));
>>>>>>> origin/main

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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

<<<<<<< HEAD
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const esPdfCotizacion = /^http:\/\/localhost:3001\/cotizaciones\/[\w-]+\/pdf$/.test(url);

    if (url.startsWith("https://wa.me/") || esPdfCotizacion) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.loadFile(path.join(__dirname, "../src/renderer/index.html"));



  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    console.log("CONSOLA DE GAONA:", message);
  });
=======
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://wa.me/")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });
    mainWindow.loadFile(
        path.join(__dirname, "../src/renderer/index.html")
    );
>>>>>>> origin/main
}

app.whenReady().then(() => {
  createWindow();

<<<<<<< HEAD
  mainWindow.maximize();
=======
    ipcMain.handle("abrir-pdf", async (event, datos: unknown) => {
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
            throw new Error("Origen no permitido");
        }
        await visorPdf.abrir(datos);
    });

    ipcMain.on("maximize-window", () => {
        mainWindow.maximize();
    });
>>>>>>> origin/main

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

  // 4. Lectura de archivos del proyecto para la IA (solo lectura, con restricciones)
  // Si main.ts está en una subcarpeta (por ejemplo src/), RAIZ sube un nivel.
  // Si main.ts está en la raíz del proyecto, usa path.resolve(__dirname) en su lugar.
  const RAIZ = path.resolve(__dirname, "..");
  const EXTENSIONES_PERMITIDAS = [".html", ".css", ".js"];

  ipcMain.handle("leer-archivo", async (_event, rutaRelativa: string) => {
    const ruta = path.resolve(RAIZ, rutaRelativa);

    if (!ruta.startsWith(RAIZ + path.sep)) {
      throw new Error("Ruta fuera del proyecto");
    }
    if (path.basename(ruta).startsWith(".env")) {
      throw new Error("Archivo protegido");
    }
    if (!EXTENSIONES_PERMITIDAS.includes(path.extname(ruta))) {
      throw new Error("Tipo de archivo no permitido");
    }
    return fs.promises.readFile(ruta, "utf8");
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
<<<<<<< HEAD
  if (process.platform !== "darwin") {
    app.quit();
  }
});
=======
    if (process.platform !== "darwin") {
        app.quit();
    }
});
app.on("will-quit", () => visorPdf.limpiar());
>>>>>>> origin/main
