
document.addEventListener("DOMContentLoaded", () => {
    const formulario = document.getElementById("reset-form");
    const contrasena = document.getElementById("contrasena");
    const confirmarContrasena = document.getElementById("confirmarContrasena");
    const mensaje = document.getElementById("reset-mensaje");
    const boton = document.getElementById("btn-restablecer");

    // Recuperar el token enviado en el enlace del correo.
    const parametros = new URLSearchParams(window.location.search);
    const token = parametros.get("token");

    function mostrarMensaje(texto, tipo) {
        mensaje.textContent = texto;
        mensaje.className = `reset-mensaje ${tipo}`;
    }

    // Comprobar que el enlace tenga un token.
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        mostrarMensaje(
            "El enlace no es válido. Solicita un nuevo restablecimiento de contraseña.",
            "error"
        );

        formulario.querySelectorAll("input, button").forEach(elemento => {
            elemento.disabled = true;
        });

        return;
    }

    formulario.addEventListener("submit", async (evento) => {
        evento.preventDefault();

        const nuevaContrasena = contrasena.value;
        const confirmacion = confirmarContrasena.value;

        // Validaciones del formulario.
        if (nuevaContrasena.length < 8 || nuevaContrasena.length > 72) {
            mostrarMensaje(
                "La contraseña debe tener entre 8 y 72 caracteres.",
                "error"
            );
            return;
        }

        if (nuevaContrasena !== confirmacion) {
            mostrarMensaje(
                "Las contraseñas no coinciden.",
                "error"
            );
            return;
        }

        boton.disabled = true;
        boton.textContent = "Guardando...";
        mensaje.className = "reset-mensaje";

        try {
            const respuesta = await fetch(
                `${AUTH_API_URL}/auth/restablecer-contrasena`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        token: token,
                        contrasena: nuevaContrasena,
                        confirmarContrasena: confirmacion
                    })
                }
            );

            const datos = await respuesta.json().catch(() => null);

            if (!respuesta.ok) {
                throw new Error(
                    datos?.error || "No se pudo restablecer la contraseña."
                );
            }

            mostrarMensaje(
                datos?.mensaje || "Tu contraseña se actualizó correctamente.",
                "exito"
            );

            // Evitar que se vuelva a enviar el formulario.
            formulario.querySelectorAll("input").forEach(elemento => {
                elemento.disabled = true;
                elemento.value = "";
            });

            boton.textContent = "Contraseña actualizada";

        } catch (error) {
            mostrarMensaje(
                error.message || "Ocurrió un error al comunicarse con el servidor.",
                "error"
            );

            boton.disabled = false;
            boton.textContent = "Guardar nueva contraseña";
        }
    });
});
