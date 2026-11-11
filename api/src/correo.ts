
import { Resend } from "resend";

export async function enviarCorreo(
    destinatario: string,
    asunto: string,
    contenido: string
) {
    const apiKey = process.env.RESEND_API_KEY;
    const remitente = process.env.EMAIL_FROM;

    if (!apiKey || !remitente) {
        throw new Error("Falta configurar Resend en el archivo .env");
    }

    const resend = new Resend(apiKey);

    const { data, error } = await resend.emails.send({
        from: remitente,
        to: destinatario,
        subject: asunto,
        html: contenido
    });

    if (error) {
        throw new Error(`Error al enviar correo: ${error.message}`);
    }

    return data;
}
