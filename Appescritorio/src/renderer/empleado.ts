"use strict";

import { electron } from "process";

interface EmpleadoAPI {
    id: string;
    nombre: string;
    apellido: string;
    usuario: string;
    correo: string;
    telefono: string | null;
    activo: boolean;
    rol: {
        id: string;
        nombre: string;
    };
}

interface Empleado {
    id: string;
    nombre: string;
    apellido: string;
    usuario: string;
    correo: string;
    telefono: string;
    rol: string;
    activo: boolean;
}

const empTabla = document.getElementById("emp-tabla-cuerpo");
const empBuscar = document.getElementById("emp-buscar") as HTMLInputElement | null;
const empVacio = document.getElementById("emp-vacio");
const empContador = document.getElementById("emp-contador");
const empTotal = document.getElementById("emp-total");
const empAdministradores = document.getElementById("emp-administradores");
const empOtros = document.getElementById("emp-otros");
const empMensaje = document.getElementById("emp-mensaje");

const empModal = document.getElementById("emp-modal");
const empForm = document.getElementById("emp-form") as HTMLFormElement | null;
const empNombre = document.getElementById("emp-nombre") as HTMLInputElement | null;
const empApellido = document.getElementById("emp-apellido") as HTMLInputElement | null;
const empUsuario = document.getElementById("emp-usuario") as HTMLInputElement | null;
const empTelefono = document.getElementById("emp-telefono") as HTMLInputElement | null;
const empCorreo = document.getElementById("emp-correo") as HTMLInputElement | null;
const empRol = document.getElementById("emp-rol") as HTMLSelectElement | null;
const empContrasena = document.getElementById("emp-contrasena") as HTMLInputElement | null;
const empConfirmarContrasena = document.getElementById("emp-confirmar-contrasena") as HTMLInputElement | null;
const empError = document.getElementById("emp-error");

const empConfirmarModal = document.getElementById("emp-confirmar-modal");
const empConfirmarTexto = document.getElementById("emp-confirmar-texto");
const empEliminarConfirmar = document.getElementById("emp-eliminar-confirmar");
const empEliminarConfirmarTexto = document.getElementById("emp-eliminar-confirmar");

const btnNuevoEmpleado = document.getElementById("btn-nuevo-empleado");
const btnCerrarEmp = document.getElementById("emp-cerrar");
const btnCancelarEmp = document.getElementById("emp-cancelar");
const btnCancelarEliminar = document.getElementById("emp-eliminar-cancelar");
const empConfirmarTitulo = document.getElementById("emp-confirmar-titulo");

const modalTitulo = document.getElementById("emp-modal-titulo");
const modalDescripcion = document.getElementById("emp-modal-descricpion");
const empCamposContrasena = document.getElementById("emp-campos-contrasena");
const btnRestablecerContrasena = document.getElementById("emp-restablecer-contrasena");
const btnGuardarEmpleado = document.getElementById("emp-guardar");

const rolesEmpleados = [
    "Administrador",
    "Empleado",
];

const idsRoles: Record<string, string> = {
    "ADMINISTRADOR": "185a8458-6011-4d5a-816b-d3368d92121c",
    "EMPLEADO": "60d79c65-a6b1-459f-9d51-ad8fe161eeaf"
}

let empleadoEnEdicionId: string | null = null;
let empleados: Empleado[] = [];

async function cargarEmpleados(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3001/empleados"
        );
        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP: ${respuesta.status}`
            );
        }

        const datos: EmpleadoAPI[] = await respuesta.json();


        empleados = datos.map((empleado) => ({
            id: empleado.id,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario,
            correo: empleado.correo,
            telefono: empleado.telefono || "",
            rol: empleado.rol.nombre === "ADMINISTRADOR"
                ? "Administrador"
                : "Empleado",
            activo: empleado.activo
        }));


        dibujarEmpleados();

        console.log(
            "Empleados cargados desde la API: ",
            empleados
        );
    } catch (error) {
        console.error(
            "Error al cargar los empleados: ",
            error
        );
        mostrarMensaje(
            "No se pudieron cargar los empleados. Verifica que la API esté funcionando."
        );
    }
}

let empleadoPendienteEliminar: string | null = null;
let mensajeTemporizador: number | undefined;

function validarEmpleados(): boolean {
    const elementos = [
        empTabla,
        empVacio,
        empContador,
        empTotal,
        empAdministradores,
        empOtros,
        btnNuevoEmpleado,
        empModal,
        empForm
    ];

    if (elementos.some((elemento) => !elemento)) {
        console.error(
            "Empleados: faltan elementos en el HTML. Revisa los identificadores de la sección."
        );
        return false;
    }

    return true;
}

function inicialesEmpleado(nombre: string): string {
    return nombre
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((parte) => parte.charAt(0))
        .join("")
        .toUpperCase();
}

function mostrarMensaje(texto: string): void {
    if (!empMensaje) return;

    empMensaje.textContent = texto;
    empMensaje.hidden = false;

    if (mensajeTemporizador !== undefined) {
        window.clearTimeout(mensajeTemporizador);
    }

    mensajeTemporizador = window.setTimeout(() => {
        if (empMensaje) empMensaje.hidden = true;
    }, 3500);
}

function actualizarResumen(): void {
    if (!empTotal || !empAdministradores || !empOtros) return;

    const administradores = empleados.filter(
        (empleado) => empleado.rol === "Administrador"
    ).length;

    empTotal.textContent = String(empleados.length);
    empAdministradores.textContent = String(administradores);
    empOtros.textContent = String(empleados.length - administradores);
}

function dibujarEmpleados(): void {
    if (!validarEmpleados() || !empTabla || !empVacio || !empContador) {
        return;
    }

    const busqueda = empBuscar?.value.trim().toLowerCase() || "";

    const filtrados = empleados.filter((empleado) =>
        empleado.nombre.toLowerCase().includes(busqueda) ||
        empleado.correo.toLowerCase().includes(busqueda)
    );

    empTabla.replaceChildren();

    filtrados.forEach((empleado) => {
        const fila = document.createElement("tr");

        if (!empleado.activo) {
            fila.classList.add("emp-desactivado");
        }

        // Nombre y avatar
        const celdaNombre = document.createElement("td");
        const identidad = document.createElement("div");
        identidad.className = "emp-identidad";

        const avatar = document.createElement("div");
        avatar.className = "emp-avatar";
        avatar.textContent = inicialesEmpleado(empleado.nombre);

        const nombre = document.createElement("span");
        nombre.className = "emp-nombre-tabla";
        nombre.textContent = empleado.nombre;

        if (!empleado.activo) {
            nombre.classList.add("emp-texto-desactivado");
        }

        identidad.append(avatar, nombre);
        celdaNombre.append(identidad);

        // Correo
        const celdaCorreo = document.createElement("td");
        celdaCorreo.className = "emp-correo-tabla";
        celdaCorreo.textContent = empleado.correo;

        if (!empleado.activo) {
            celdaCorreo.classList.add("emp-texto-desactivado");
        }

        // Selector de rol
        const celdaRol = document.createElement("td");
        const selectorRol = document.createElement("select");
        selectorRol.className = "emp-rol-select";
        selectorRol.setAttribute(
            "aria-label",
            `Cambiar rol de ${empleado.nombre}`
        );

        rolesEmpleados.forEach((rol) => {
            const opcion = document.createElement("option");
            opcion.value = rol;
            opcion.textContent = rol;
            opcion.selected = empleado.rol === rol;
            selectorRol.append(opcion);
        });



        selectorRol.addEventListener("change", async () => {
            const nuevoRol = selectorRol.value;
            const rolAnterior = empleado.rol;

            if (!rolesEmpleados.includes(nuevoRol)) {
                selectorRol.value = rolAnterior;
                return;
            }
            if (nuevoRol === rolAnterior) return;

            selectorRol.disabled = true;

            try {
                const respuesta = await fetch(
                    `http://localhost:3001/empleados/${encodeURIComponent(empleado.id)}/rol`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            rol: nuevoRol === "Administrador"
                                ? "ADMINISTRADOR"
                                : "EMPLEADO"
                        })
                    }
                );

                const resultado = await respuesta.json();

                if (!respuesta.ok) {
                    throw new Error(
                        resultado.error ||
                        resultado.mensaje ||
                        "No se pudo actualizar el rol."
                    );
                }

                empleado.rol = nuevoRol;

                actualizarResumen();

                mostrarMensaje(
                    `Rol de ${empleado.nombre} actualizado correctamente.`
                );
            } catch (error) {
                selectorRol.value = rolAnterior;

                console.error("Error al actualizar el rol: ", error);

                mostrarMensaje(
                    error instanceof Error
                        ? error.message
                        : "Ocurrió un error al actualizar el rol."
                );
            } finally {
                selectorRol.disabled = false;
            }
        });

        celdaRol.append(selectorRol);

        // Acción para eliminar

        // Acciones del empleado
        const celdaAcciones = document.createElement("td");

        // Botón editar
        const btnEditar = document.createElement("button");
        btnEditar.type = "button";
        btnEditar.className = "emp-accion-editar";
        btnEditar.textContent = "Editar";

        btnEditar.addEventListener("click", () => {
            abrirModalEdicion(empleado);
        });

        // Botón activar/desactivar
        const btnEstado = document.createElement("button");
        btnEstado.type = "button";
        btnEstado.className = empleado.activo
            ? "emp-accion-eliminar"
            : "emp-accion-activar";

        btnEstado.textContent = empleado.activo
            ? "Desactivar"
            : "Activar";

        btnEstado.addEventListener("click", () => {
            solicitarCambioEstado(empleado);
        });

        // Agregar ambos botones
        celdaAcciones.append(btnEditar, btnEstado);

        btnEstado.type = "button";
        btnEstado.className = empleado.activo
            ? "emp-accion-eliminar"
            : "emp-accion-activar";

        btnEstado.textContent = empleado.activo
            ? "Desactivar"
            : "Activar";

        btnEstado.addEventListener("click", () => {
            solicitarCambioEstado(empleado);
        });

        celdaAcciones.append(btnEstado);

        fila.append(celdaNombre, celdaCorreo, celdaRol, celdaAcciones);
        empTabla.append(fila);

        selectorRol.disabled = false;
    });

    empVacio.hidden = filtrados.length > 0;
    empContador.textContent =
        `Mostrando ${filtrados.length} de ${empleados.length} empleados`;

    actualizarResumen();
}

function abrirModalEmpleado(): void {
    empleadoEnEdicionId = null;
    if (!empModal || !empForm || !empError) return;

    empForm.reset();
    empError.hidden = true;
    empError.textContent = "";
    empModal.hidden = false;
    empNombre?.focus();

    if (modalTitulo) {
        modalTitulo.textContent = "Nuevo Empleado"
    }

    if (modalDescripcion) {
        modalDescripcion.textContent = "Completa los datos para registrar una cuenta."
    }

    if (empCamposContrasena) {
        empCamposContrasena.hidden = false;
    }

    if (btnRestablecerContrasena) {
        btnRestablecerContrasena.hidden = true;
    }

    if (btnGuardarEmpleado) {
        btnGuardarEmpleado.textContent = "Crear Cuenta"
    }

    if (empContrasena) {
        empContrasena.required = true;
    }

    if (empConfirmarContrasena) {
        empConfirmarContrasena.required = true;
    }
}

function cerrarModalEmpleado(): void {
    if (!empModal || !empForm || !empError) return;

    empModal.hidden = true;
    empForm.reset();
    empError.hidden = true;
    empError.textContent = "";

    empleadoEnEdicionId = null;
}

function mostrarErrorFormulario(texto: string): void {
    if (!empError) return;

    empError.textContent = texto;
    empError.hidden = false;
}

async function crearEmpleado(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (
        !empNombre ||
        !empApellido ||
        !empUsuario ||
        !empCorreo ||
        !empTelefono ||
        !empRol ||
        !empContrasena ||
        !empConfirmarContrasena
    ) {
        return;
    }

    const nombre = empNombre.value.trim();
    const apellido = empApellido.value.trim();
    const usuario = empUsuario.value.trim();
    const correo = empCorreo.value.trim().toLowerCase();
    const telefono = empTelefono.value.trim();
    const rol = empRol.value;
    const contrasena = empContrasena.value;
    const confirmarContrasena = empConfirmarContrasena.value;

    if (
        !nombre ||
        !apellido ||
        !usuario ||
        !correo ||
        !telefono ||
        !rol ||
        !contrasena ||
        !confirmarContrasena
    ) {
        mostrarErrorFormulario(
            "Completa todos los campo obligatorios."
        ); return;
    }
    if (!idsRoles[rol]) {
        mostrarErrorFormulario("Selecciona un rol válido.");
        return;
    }

    if (contrasena.length < 8) {
        mostrarErrorFormulario("La contraseña debe tener al menos 8 carácteres.");
        return;
    }

    if (contrasena !== confirmarContrasena) {
        mostrarErrorFormulario("Las contraseñas no coinciden.");
        empConfirmarContrasena.focus();
        return;
    }

    const correoExistente = empleados.some(
        (empleado) => empleado.correo.toLocaleLowerCase() === correo
    );

    if (correoExistente) {
        mostrarErrorFormulario("Ya existe un empleado con ese correo.");
        empCorreo.focus();
        return;
    }

    try {
        const respuesta = await fetch("http://localhost:3001/empleados", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nombre,
                apellido,
                usuario,
                correo,
                telefono: telefono || undefined,
                idRol: idsRoles[rol],
                contrasena,
                confirmarcontrasena: confirmarContrasena
            })
        });
        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.mensaje ||
                resultado.error ||
                "No se pudo crear la cuenta."
            );
        }

        await cargarEmpleados();
        console.log("Empleados después de recargar:", empleados);
        cerrarModalEmpleado();

        mostrarMensaje(
            `La cuenta de ${nombre} ${apellido} se creó correctamente.`
        );
    } catch (error) {
        console.error("Error al crear el empleado.")

        mostrarErrorFormulario(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al crear la cuenta."
        );
    }

}

function solicitarCambioEstado(empleado: Empleado): void {
    if (!empConfirmarModal || !empConfirmarTexto) return;

    empleadoPendienteEliminar = empleado.id;

    if (empleado.activo) {
        if (empConfirmarTitulo) {
            empConfirmarTitulo.textContent = "Desactivar cuenta";
        }
        empConfirmarTexto.textContent =
            `¿Estás seguro de que deseas desactivar la cuenta de ${empleado.nombre}?`;
    } else {
        if (empConfirmarTitulo) {
            empConfirmarTitulo.textContent = "Activar cuenta";
        } empConfirmarTexto.textContent =
            `¿Deseas activar la cuenta de ${empleado.nombre}? El usuario podrá volver a acceder al sistema cuando el inicio de sesión esté habilitado para su cuenta.`;
    }

    if (empEliminarConfirmar) {
        empEliminarConfirmar.textContent = empleado.activo
            ? "Sí, desactivar"
            : "Sí, activar";
    }

    empConfirmarModal.hidden = false;
}

function cerrarConfirmacionEliminar(): void {
    if (!empConfirmarModal) return;

    empConfirmarModal.hidden = true;
    empleadoPendienteEliminar = null;
}

async function eliminarEmpleadoConfirmado(): Promise<void> {
    if (empleadoPendienteEliminar === null) return;

    const empleado = empleados.find(
        (elemento) => elemento.id === empleadoPendienteEliminar
    );

    if (!empleado) {
        cerrarConfirmacionEliminar();
        return;
    }

    const nuevoEstado = !empleado.activo;

    try {
        const respuesta = await fetch(
            `http://localhost:3001/empleados/${encodeURIComponent(empleado.id)}/estado`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    activo: nuevoEstado
                })
            }
        );

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.error ||
                resultado.mensaje ||
                "No se pudo actualizar el estado de la cuenta."
            );
        }
        cerrarConfirmacionEliminar();

        await cargarEmpleados();

        mostrarMensaje(
            `La cuenta de ${empleado.nombre} se ${nuevoEstado ? "activó" : "desactivó"} correctamente.`,
        );
    } catch (error) {
        console.error("Error al cambiar el estado:", error);
        mostrarMensaje(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al cambiar el estado."
        );
    }
}

function abrirModalEdicion(empleado: Empleado): void {
    abrirModalEmpleado();

    empleadoEnEdicionId = empleado.id;

    if (modalTitulo) {
        modalTitulo.textContent = "Editar Empleado"
    }

    if (modalDescripcion) {
        modalDescripcion.textContent = "Modifica la información del Empleado."
    }

    if (btnGuardarEmpleado) {
        btnGuardarEmpleado.textContent = "Editar Cuenta"
    }

    if (empNombre) empNombre.value = empleado.nombre;
    if (empApellido) empApellido.value = empleado.apellido;
    if (empUsuario) empUsuario.value = empleado.usuario;
    if (empCorreo) empCorreo.value = empleado.correo;
    if (empTelefono) empTelefono.value = empleado.telefono;

    if (empRol) {
        empRol.value = empleado.rol === "Administrador"
            ? "ADMINISTRADOR"
            : "EMPLEADO";
    }

    if (empCamposContrasena) {
        empCamposContrasena.hidden = true;
    }

    if (btnRestablecerContrasena) {
        btnRestablecerContrasena.hidden = false;
    }

    if (empContrasena) {
        empContrasena.required = false;
    }

    if (empConfirmarContrasena) {
        empConfirmarContrasena.required = false;
    }
}

async function ActualizarEmpleado(empleado: Empleado) {
    const nuevonombre = empNombre?.value.trim();
    const nuevoapellido = empApellido?.value.trim();
    const nuevousuario = empUsuario?.value.trim();
    const nuevocorreo = empCorreo?.value.trim();
    const nuevotelefono = empTelefono?.value.trim();
    const nuevorol = empRol?.value;
    const idRol = nuevorol ? idsRoles[nuevorol] : undefined;
    const roloriginal = Object.entries(idsRoles).find(([id, nombre]) => nombre === empleado.rol)?.[0];

    if (
        nuevonombre === empleado.nombre &&
        nuevoapellido === empleado.apellido &&
        nuevousuario === empleado.usuario &&
        nuevocorreo === empleado.correo &&
        nuevotelefono === empleado.telefono &&
        nuevorol === (empleado.rol === "Administrador"
            ? "ADMINISTRADOR"
            : "EMPLEADO"
        )
    ) {
        mostrarErrorFormulario("No has modificado ningún dato del empleado.")
        return;
    }

    if (
        !nuevonombre ||
        !nuevoapellido ||
        !nuevousuario ||
        !nuevocorreo ||
        !nuevorol
    ) {
        mostrarErrorFormulario("Completa los campos obligatorios.")
        return;
    }
    try {
        const respuesta = await fetch(`http://localhost:3001/empleados/${empleado.id}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    nombre: nuevonombre,
                    apellido: nuevoapellido,
                    usuario: nuevousuario,
                    correo: nuevocorreo,
                    telefono: nuevotelefono || null,
                    idRol
                })
            });
        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.mensaje ||
                resultado.error ||
                "No se pudo editar el empleado."
            );
        }
        await cargarEmpleados();
        cerrarModalEmpleado();

        mostrarMensaje(`El empleado ${nuevonombre} se edito correctamente.`)
    } catch (error) {
        console.error("Error al editar el usuario: ", error);

        mostrarErrorFormulario(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al editar el empleado."
        );
    }

}


async function enviarRestablecimientoContrasena(): Promise<void> {
    if (!empleadoEnEdicionId || !btnRestablecerContrasena) {
        return;
    }

    const empleado = empleados.find(
        (elemento) => elemento.id === empleadoEnEdicionId
    );

    if (!empleado) {
        mostrarErrorFormulario("No se encontró el empleado seleccionado.");
        return;
    }

    if (!empleado.activo) {
        mostrarErrorFormulario(
            "No puedes restablecer la contraseña de una cuenta desactivada."
        );
        return;
    }

    if (!empleado.correo) {
        mostrarErrorFormulario(
            "El empleado no tiene un correo registrado."
        );
        return;
    }

    const token = window.gaonaSesion.token();

    if (!token) {
        mostrarErrorFormulario(
            "Tu sesión ha expirado. Inicia sesión nuevamente."
        );
        return;
    }

    const confirmar = window.confirm(
        `¿Deseas enviar un correo de restablecimiento a ${empleado.correo}?`
    );

    if (!confirmar) return;

    btnRestablecerContrasena.textContent = "Enviando correo...";

    try {
        const respuesta = await fetch(
            `http://localhost:3001/empleados/${encodeURIComponent(empleado.id)}/restablecer-contrasena`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const resultado = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new Error(
                resultado?.error ||
                resultado?.mensaje ||
                "No se pudo enviar el correo de restablecimiento."
            );
        }

        mostrarMensaje(
            `Se envió el correo de restablecimiento a ${empleado.correo}.`
        );

    } catch (error) {
        console.error("Error al enviar el restablecimiento:", error);

        mostrarErrorFormulario(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al enviar el correo."
        );

    } finally {
        btnRestablecerContrasena.textContent =
            "Enviar correo para restablecer contraseña";
    }
}


// Eventos de la interfaz
btnNuevoEmpleado?.addEventListener("click", abrirModalEmpleado);
btnCerrarEmp?.addEventListener("click", cerrarModalEmpleado);
btnCancelarEmp?.addEventListener("click", cerrarModalEmpleado);

empBuscar?.addEventListener("input", dibujarEmpleados);
empForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (empleadoEnEdicionId) {
        const empleado = empleados.find(
            (elemento) => elemento.id === empleadoEnEdicionId
        );

        if (!empleado) return;

        void ActualizarEmpleado(empleado);
    } else {
        void crearEmpleado(event);
    }
});

btnRestablecerContrasena?.addEventListener(
    "click",
    enviarRestablecimientoContrasena
);

btnCancelarEliminar?.addEventListener("click", cerrarConfirmacionEliminar);
empEliminarConfirmar?.addEventListener("click", eliminarEmpleadoConfirmado);

// Cerrar los modales al pulsar el fondo.
empModal?.addEventListener("click", (event) => {
    if (event.target === empModal) cerrarModalEmpleado();
});

empConfirmarModal?.addEventListener("click", (event) => {
    if (event.target === empConfirmarModal) cerrarConfirmacionEliminar();
});

// Inicialización
if (validarEmpleados()) {
    void cargarEmpleados();

    console.log("Empleados: interfaz inicializada correctamente.");
}