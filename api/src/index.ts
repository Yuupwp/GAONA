import "dotenv/config";
import { app } from "./escritorio";

const PORT = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT inválido");
const HOST = process.env.DESKTOP_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => console.log(`API de escritorio en http://${HOST}:${PORT}`));
