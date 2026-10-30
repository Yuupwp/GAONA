// ========================================
// Sesión de la app de escritorio
// Guarda quién inició sesión, ajusta el menú según su rol
// y actualiza la cabecera. Los demás módulos la usan con
// window.gaonaSesion (por ejemplo, para saber el id del usuario).
//
// Este archivo no tiene import/export a propósito: así los tipos
// de abajo quedan disponibles para los demás archivos.
// ========================================

interface GaonaUsuario {
    id: string;
    nombre: string;
    apellido: string;
    usuario: string;
    correo: string;
    telefono: string | null;
    activo: boolean;
    creadoEn: string;
    rol: { nombre: string };
    permisos: string[];
}

interface GaonaSesion {
    iniciar: (usuario: string, contrasena: string) => Promise<GaonaUsuario>;
    actual: () => GaonaUsuario | null;
    inicioDeSesion: () => Date | null;
    actualizar: (usuario: GaonaUsuario) => void;
    cerrar: () => void;
    puede: (seccion: string) => boolean;
}

interface Window {
    gaonaSesion: GaonaSesion;
}

(() => {
    const API_URL = "http://localhost:3000";

    let usuarioActual: GaonaUsuario | null = null;
    let horaDeInicio: Date | null = null;

    const NOMBRES_ROL: Record<string, string> = {
        ADMINISTRADOR: "Administrador",
        EMPLEADO: "Empleado",
    };

    // Elementos que se actualizan
    const avatar = document.getElementById("user-avatar");
    const nombreCabecera = document.getElementById("user-nombre");
    const rolCabecera = document.getElementById("user-rol");
    const pantallaLogin = document.getElementById("login-screen");
    const pantallaPrincipal = document.getElementById("main-screen");
    const formularioLogin = document.getElementById("login-form") as HTMLFormElement | null;

    function iniciales(usuario: GaonaUsuario): string {
        return (
            usuario.nombre.trim().charAt(0) + usuario.apellido.trim().charAt(0)
        ).toUpperCase();
    }

    function avisarCambio(): void {
        document.dispatchEvent(new CustomEvent("gaona:sesion"));
    }

    // Cabecera: iniciales, nombre y rol de quien inició sesión
    function pintarCabecera(): void {
        if (!usuarioActual) return;

        if (avatar) avatar.textContent = iniciales(usuarioActual);

        if (nombreCabecera) {
            nombreCabecera.textContent = `${usuarioActual.nombre} ${usuarioActual.apellido}`;
        }

        if (rolCabecera) {
            rolCabecera.textContent =
                NOMBRES_ROL[usuarioActual.rol.nombre] ?? usuarioActual.rol.nombre;
        }
    }

    // Menú: solo se ven las secciones que el rol puede usar
    function pintarMenu(): void {
        document
            .querySelectorAll<HTMLButtonElement>(".menu-item[data-section]")
            .forEach((item) => {
                const seccion = item.dataset.section ?? "";
                item.classList.toggle("hidden", !puede(seccion));
            });
    }

    // Abre la primera sección que el usuario puede ver
    function irAPrimeraSeccion(): void {
        const primero = Array.from(
            document.querySelectorAll<HTMLButtonElement>(".menu-item[data-section]")
        ).find(
            (item) =>
                !item.classList.contains("hidden") &&
                item.dataset.section !== "cuenta"
        );

        (primero ?? document.querySelector<HTMLButtonElement>(".menu-item"))?.click();
    }

    function puede(seccion: string): boolean {
        return usuarioActual?.permisos.includes(seccion) ?? false;
    }

    async function iniciar(
        usuario: string,
        contrasena: string
    ): Promise<GaonaUsuario> {
        let respuesta: Response;

        try {
            respuesta = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usuario, contrasena }),
            });
        } catch {
            throw new Error(
                "No se pudo conectar con la API. Revisa que esté encendida (npm run dev dentro de la carpeta api)."
            );
        }

        const datos = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new Error(datos?.error ?? "No se pudo iniciar sesión.");
        }

        usuarioActual = datos as GaonaUsuario;
        horaDeInicio = new Date();

        pintarCabecera();
        pintarMenu();
        irAPrimeraSeccion();
        avisarCambio();

        return usuarioActual;
    }

    // Se usa cuando la persona edita sus datos en "Mi cuenta"
    function actualizar(usuario: GaonaUsuario): void {
        usuarioActual = usuario;
        pintarCabecera();
        avisarCambio();
    }

    function cerrar(): void {
        usuarioActual = null;
        horaDeInicio = null;

        // Se vuelve a mostrar todo el menú; se ajusta de nuevo al iniciar sesión
        document
            .querySelectorAll<HTMLButtonElement>(".menu-item")
            .forEach((item) => item.classList.remove("hidden"));

        // Se limpia el formulario de inicio de sesión
        formularioLogin?.reset();
        document
            .querySelectorAll<HTMLElement>("#login-form .input-error")
            .forEach((e) => (e.textContent = ""));
        document
            .querySelectorAll<HTMLElement>("#login-form .has-error")
            .forEach((e) => e.classList.remove("has-error"));

        pantallaPrincipal?.classList.add("hidden");
        pantallaLogin?.classList.remove("hidden");

        avisarCambio();
    }

    window.gaonaSesion = {
        iniciar,
        actual: () => usuarioActual,
        inicioDeSesion: () => horaDeInicio,
        actualizar,
        cerrar,
        puede,
    };
})();