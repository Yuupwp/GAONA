// ========================================
// Módulo "Mi cuenta" (app de escritorio)
// Datos personales, cambio de contraseña
// y cierre de sesión de quien inició sesión
// ========================================
(() => {
    const API_URL = "http://localhost:3000";

    class ApiError extends Error {
        status: number;

        constructor(status: number, mensaje: string) {
            super(mensaje);
            this.status = status;
        }
    }

    const NOMBRES_ROL: Record<string, string> = {
        ADMINISTRADOR: "Administrador",
        EMPLEADO: "Empleado",
    };

    // Elementos de la pantalla
    function el<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    const tarjeta = {
        avatar: el<HTMLElement>("cu-avatar"),
        nombre: el<HTMLElement>("cu-nombre-completo"),
        rol: el<HTMLElement>("cu-badge-rol"),
        usuario: el<HTMLElement>("cu-d-usuario"),
        correo: el<HTMLElement>("cu-d-correo"),
        telefono: el<HTMLElement>("cu-d-telefono"),
        miembro: el<HTMLElement>("cu-d-miembro"),
        sesion: el<HTMLElement>("cu-d-sesion"),
    };

    const form = el<HTMLFormElement>("cu-form");
    const campos = {
        nombre: el<HTMLInputElement>("cu-f-nombre"),
        apellido: el<HTMLInputElement>("cu-f-apellido"),
        usuario: el<HTMLInputElement>("cu-f-usuario"),
        telefono: el<HTMLInputElement>("cu-f-telefono"),
        correo: el<HTMLInputElement>("cu-f-correo"),
        rol: el<HTMLInputElement>("cu-f-rol"),
    };
    const errores = {
        nombre: el<HTMLSpanElement>("cu-e-nombre"),
        apellido: el<HTMLSpanElement>("cu-e-apellido"),
        usuario: el<HTMLSpanElement>("cu-e-usuario"),
        telefono: el<HTMLSpanElement>("cu-e-telefono"),
        correo: el<HTMLSpanElement>("cu-e-correo"),
    };
    const formError = el<HTMLDivElement>("cu-form-error");
    const btnDescartar = el<HTMLButtonElement>("cu-descartar");
    const btnGuardar = el<HTMLButtonElement>("cu-guardar");

    const passForm = el<HTMLFormElement>("cu-pass-form");
    const pass = {
        actual: el<HTMLInputElement>("cu-p-actual"),
        nueva: el<HTMLInputElement>("cu-p-nueva"),
        confirmar: el<HTMLInputElement>("cu-p-confirmar"),
    };
    const passErrores = {
        actual: el<HTMLSpanElement>("cu-pe-actual"),
        nueva: el<HTMLSpanElement>("cu-pe-nueva"),
        confirmar: el<HTMLSpanElement>("cu-pe-confirmar"),
    };
    const passError = el<HTMLDivElement>("cu-pass-error");
    const btnPass = el<HTMLButtonElement>("cu-pass-guardar");
    const requisitos = {
        largo: el<HTMLElement>("cu-req-largo"),
        coinciden: el<HTMLElement>("cu-req-coinciden"),
        distinta: el<HTMLElement>("cu-req-distinta"),
    };

    const passModal = el<HTMLDivElement>("cu-pass-modal");
    const toast = el<HTMLDivElement>("cu-toast");

    // Estado
    let guardando = false;
    let guardandoPass = false;

    // Utilidades
    function soloDigitos(texto: string): string {
        return texto.replace(/\D/g, "");
    }

    function formatoTelefono(telefono: string | null): string {
        if (!telefono) return "—";

        const d = soloDigitos(telefono);

        return d.length === 10
            ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`
            : telefono;
    }

    function iniciales(nombre: string, apellido: string): string {
        return (nombre.trim().charAt(0) + apellido.trim().charAt(0)).toUpperCase();
    }

    function nombreDeRol(rol: string): string {
        return NOMBRES_ROL[rol] ?? rol;
    }

    let temporizadorAviso: number | undefined;

    function avisar(mensaje: string, esError = false): void {
        toast.textContent = mensaje;
        toast.classList.toggle("error", esError);
        toast.classList.remove("hidden");

        window.clearTimeout(temporizadorAviso);
        temporizadorAviso = window.setTimeout(() => {
            toast.classList.add("hidden");
        }, 4500);
    }

    async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
        let respuesta: Response;

        try {
            respuesta = await fetch(`${API_URL}${ruta}`, {
                ...opciones,
                headers: opciones.body
                    ? { "Content-Type": "application/json" }
                    : undefined,
            });
        } catch {
            throw new ApiError(
                0,
                "No se pudo conectar con la API. Revisa que esté encendida (npm run dev dentro de la carpeta api)."
            );
        }

        const datos = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new ApiError(
                respuesta.status,
                datos?.error ?? "Ocurrió un error inesperado."
            );
        }

        return datos as T;
    }

    function mensajeDe(error: unknown): string {
        return error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado.";
    }

    // Pintar la pantalla con los datos del usuario
    function pintarTarjeta(u: GaonaUsuario): void {
        tarjeta.avatar.textContent = iniciales(u.nombre, u.apellido);
        tarjeta.nombre.textContent = `${u.nombre} ${u.apellido}`;
        tarjeta.rol.textContent = nombreDeRol(u.rol.nombre);
        tarjeta.usuario.textContent = u.usuario;
        tarjeta.correo.textContent = u.correo;
        tarjeta.telefono.textContent = formatoTelefono(u.telefono);

        tarjeta.miembro.textContent = new Date(u.creadoEn).toLocaleDateString(
            "es-MX",
            { day: "numeric", month: "short", year: "numeric" }
        );

        // La base de datos no guarda el último acceso, así que se muestra
        // la hora en que se inició esta sesión.
        const inicio = window.gaonaSesion.inicioDeSesion();

        tarjeta.sesion.textContent = inicio
            ? `Hoy, ${inicio.toLocaleTimeString("es-MX", {
                  hour: "numeric",
                  minute: "2-digit",
              })}`
            : "—";
    }

    function pintarFormulario(u: GaonaUsuario): void {
        campos.nombre.value = u.nombre;
        campos.apellido.value = u.apellido;
        campos.usuario.value = u.usuario;
        campos.telefono.value = u.telefono ? formatoTelefono(u.telefono) : "";
        campos.correo.value = u.correo;
        campos.rol.value = nombreDeRol(u.rol.nombre);

        limpiarErrores();
        actualizarBotonesFormulario();
    }

    function pintarTodo(): void {
        const u = window.gaonaSesion.actual();

        if (!u) return;

        pintarTarjeta(u);
        pintarFormulario(u);
    }

    // Formulario de datos personales
    function limpiarErrores(): void {
        Object.values(errores).forEach((e) => {
            e.textContent = "";
            e.parentElement?.classList.remove("has-error");
        });

        formError.classList.add("hidden");
        formError.textContent = "";
    }

    function mostrarError(campo: keyof typeof errores, mensaje: string): void {
        errores[campo].textContent = mensaje;
        errores[campo].parentElement?.classList.add("has-error");
    }

    function valoresDelFormulario() {
        return {
            nombre: campos.nombre.value.trim(),
            apellido: campos.apellido.value.trim(),
            usuario: campos.usuario.value.trim(),
            correo: campos.correo.value.trim(),
            telefono: soloDigitos(campos.telefono.value),
        };
    }

    function hayCambios(): boolean {
        const u = window.gaonaSesion.actual();

        if (!u) return false;

        const v = valoresDelFormulario();

        return (
            v.nombre !== u.nombre ||
            v.apellido !== u.apellido ||
            v.usuario !== u.usuario ||
            v.correo !== u.correo ||
            v.telefono !== soloDigitos(u.telefono ?? "")
        );
    }

    function actualizarBotonesFormulario(): void {
        const cambios = hayCambios();

        btnDescartar.disabled = !cambios || guardando;
        btnGuardar.disabled = !cambios || guardando;
    }

    function validarFormulario(): boolean {
        limpiarErrores();

        const v = valoresDelFormulario();
        let ok = true;

        if (v.nombre === "") {
            mostrarError("nombre", "El nombre es obligatorio.");
            ok = false;
        }

        if (v.apellido === "") {
            mostrarError("apellido", "El apellido es obligatorio.");
            ok = false;
        }

        if (v.usuario.length < 3) {
            mostrarError("usuario", "El usuario debe tener al menos 3 caracteres.");
            ok = false;
        }

        if (v.correo === "") {
            mostrarError("correo", "El correo es obligatorio.");
            ok = false;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.correo)) {
            mostrarError("correo", "El correo no es válido.");
            ok = false;
        }

        if (v.telefono !== "" && v.telefono.length !== 10) {
            mostrarError("telefono", "El teléfono debe tener 10 dígitos.");
            ok = false;
        }

        return ok;
    }

    // Pone el mensaje de la API debajo del campo al que se refiere
    function mostrarErrorDeApi(mensaje: string): void {
        const texto = mensaje.toLowerCase();

        if (texto.includes("usuario")) mostrarError("usuario", mensaje);
        else if (texto.includes("correo")) mostrarError("correo", mensaje);
        else if (texto.includes("teléfono")) mostrarError("telefono", mensaje);
        else {
            formError.textContent = mensaje;
            formError.classList.remove("hidden");
        }
    }

    async function guardarPerfil(): Promise<void> {
        const sesion = window.gaonaSesion.actual();

        if (!sesion || guardando || !hayCambios()) return;
        if (!validarFormulario()) return;

        guardando = true;
        btnGuardar.disabled = true;
        btnDescartar.disabled = true;
        btnGuardar.textContent = "Guardando...";

        try {
            const actualizado = await api<GaonaUsuario>(
                `/cuenta/${encodeURIComponent(sesion.id)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify(valoresDelFormulario()),
                }
            );

            window.gaonaSesion.actualizar(actualizado);
            avisar("Tus datos se guardaron correctamente.");
        } catch (error) {
            mostrarErrorDeApi(mensajeDe(error));
        } finally {
            guardando = false;
            btnGuardar.textContent = "Guardar cambios";
            actualizarBotonesFormulario();
        }
    }

    // Contraseña
    function limpiarErroresPass(): void {
        Object.values(passErrores).forEach((e) => {
            e.textContent = "";
            e.parentElement?.classList.remove("has-error");
        });

        passError.classList.add("hidden");
        passError.textContent = "";
    }

    function marcar(requisito: HTMLElement, cumplido: boolean): void {
        requisito.classList.toggle("ok", cumplido);
    }

    function revisarRequisitos(): boolean {
        const largo = pass.nueva.value.length >= 8;
        const coinciden =
            pass.nueva.value !== "" && pass.nueva.value === pass.confirmar.value;
        const distinta =
            pass.nueva.value !== "" && pass.nueva.value !== pass.actual.value;

        marcar(requisitos.largo, largo);
        marcar(requisitos.coinciden, coinciden);
        marcar(requisitos.distinta, distinta);

        const completo = pass.actual.value !== "" && largo && coinciden && distinta;

        btnPass.disabled = !completo || guardandoPass;

        return completo;
    }

    function reiniciarPass(): void {
        passForm.reset();

        // Los campos vuelven a ocultar lo que se escribe
        Object.values(pass).forEach((campo) => (campo.type = "password"));
        passForm
            .querySelectorAll<HTMLButtonElement>(".cu-ver")
            .forEach((boton) => (boton.textContent = "Ver"));

        limpiarErroresPass();
        revisarRequisitos();
    }

    function abrirPass(): void {
        reiniciarPass();
        passModal.classList.remove("hidden");
        pass.actual.focus();
    }

    function cerrarPass(): void {
        if (guardandoPass) return;

        passModal.classList.add("hidden");
        reiniciarPass();
    }

    async function guardarContrasena(): Promise<void> {
        const sesion = window.gaonaSesion.actual();

        if (!sesion || guardandoPass || !revisarRequisitos()) return;

        limpiarErroresPass();

        guardandoPass = true;
        btnPass.disabled = true;
        btnPass.textContent = "Actualizando...";

        try {
            await api(`/cuenta/${encodeURIComponent(sesion.id)}/contrasena`, {
                method: "PATCH",
                body: JSON.stringify({
                    actual: pass.actual.value,
                    nueva: pass.nueva.value,
                    confirmar: pass.confirmar.value,
                }),
            });

            reiniciarPass();
            passModal.classList.add("hidden");
            avisar("Tu contraseña se actualizó correctamente.");
        } catch (error) {
            const mensaje = mensajeDe(error);

            if (error instanceof ApiError && error.status === 401) {
                passErrores.actual.textContent = mensaje;
                passErrores.actual.parentElement?.classList.add("has-error");
            } else {
                passError.textContent = mensaje;
                passError.classList.remove("hidden");
            }
        } finally {
            guardandoPass = false;
            btnPass.textContent = "Actualizar contraseña";
            revisarRequisitos();
        }
    }

    // Carga los datos más recientes desde la API al entrar a Mi cuenta
    async function cargarCuenta(): Promise<void> {
        const sesion = window.gaonaSesion.actual();

        if (!sesion) return;

        try {
            const datos = await api<GaonaUsuario>(
                `/cuenta/${encodeURIComponent(sesion.id)}`
            );

            // Al entrar a la sección se muestran los datos más recientes
            window.gaonaSesion.actualizar(datos);
        } catch (error) {
            if (
                error instanceof ApiError &&
                (error.status === 403 || error.status === 404)
            ) {
                window.gaonaSesion.cerrar();
                return;
            }

            avisar(mensajeDe(error), true);
        }
    }

    // Eventos
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="cuenta"]')
        ?.addEventListener("click", () => {
            pintarTodo();
            void cargarCuenta();
        });

    // La sesión cambió (inicio, edición de datos o cierre)
    document.addEventListener("gaona:sesion", () => {
        if (window.gaonaSesion.actual()) {
            pintarTodo();
        } else {
            reiniciarPass();
            passModal.classList.add("hidden");
            toast.classList.add("hidden");
        }
    });

    Object.values(campos).forEach((campo) => {
        campo.addEventListener("input", actualizarBotonesFormulario);
    });

    // El teléfono solo acepta números y espacios
    campos.telefono.addEventListener("input", () => {
        campos.telefono.value = campos.telefono.value.replace(/[^\d\s]/g, "");
    });

    form.addEventListener("submit", (evento) => {
        evento.preventDefault();
        void guardarPerfil();
    });

    btnDescartar.addEventListener("click", () => {
        const u = window.gaonaSesion.actual();

        if (u) pintarFormulario(u);
    });

    Object.values(pass).forEach((campo) => {
        campo.addEventListener("input", () => {
            limpiarErroresPass();
            revisarRequisitos();
        });
    });

    passForm
        .querySelectorAll<HTMLButtonElement>(".cu-ver")
        .forEach((boton) => {
            boton.addEventListener("click", () => {
                const campo = el<HTMLInputElement>(boton.dataset.objetivo ?? "");
                const visible = campo.type === "text";

                campo.type = visible ? "password" : "text";
                boton.textContent = visible ? "Ver" : "Ocultar";
            });
        });

    passForm.addEventListener("submit", (evento) => {
        evento.preventDefault();
        void guardarContrasena();
    });

    el("cu-abrir-pass").addEventListener("click", abrirPass);
    el("cu-pass-cerrar").addEventListener("click", cerrarPass);
    el("cu-pass-cancelar").addEventListener("click", cerrarPass);

    // Clic en el fondo oscuro cierra el cuadro
    passModal.addEventListener("click", (evento) => {
        if (evento.target === passModal) cerrarPass();
    });

    // Escape cierra el cuadro
    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape" && !passModal.classList.contains("hidden")) {
            cerrarPass();
        }
    });

    el("cu-cerrar-sesion").addEventListener("click", () => {
        window.gaonaSesion.cerrar();
    });

    revisarRequisitos();
})();