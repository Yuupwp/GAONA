
import "dotenv/config";
import { enviarCorreo } from "./correo";

async function probarEnvio() {
    try {
        const resultado = await enviarCorreo(
            "sanchez.saucedo.josepablo@gmail.com",
            "Prueba de correo - GAONA",
            `
                <h2>¡Hola!</h2>
                <p>Este es un correo de prueba enviado desde la API de GAONA.</p>
                <p>La integración con Resend está funcionando correctamente.</p>
            `
        );

        console.log("Correo enviado correctamente:", resultado);
    } catch (error) {
        console.error("No se pudo enviar el correo:", error);
    }
}

probarEnvio();
