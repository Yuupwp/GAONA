
"use strict";

import { electron } from "process";

interface EmpleadoAPI {
    id: string;
    nombre: string;
    apellido: string;
    usuario: string;
    correo: string;
    activo: boolean;
    rol: {
        id: string;
        nombre: string;
    };
}

interface Empleado {
    id: string;
    nombre: string;
    correo: string;
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

const rolesEmpleados = [
    "Administrador",
    "Empleado",
];

const idsRoles: Record<string, string> = {
    "ADMINISTRADOR": "185a8458-6011-4d5a-816b-d3368d92121c",
    "EMPLEADO": "60d79c65-a6b1-459f-9d51-ad8fe161eeaf"
}

let empleados: Empleado[] = [];

async function cargarEmpleados(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3000/empleados"
        );
        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP: ${respuesta.status}`
            );
        }

        const datos: EmpleadoAPI[] = await respuesta.json();

        empleados = datos.map((empleado) => ({
            id: empleado.id,
            nombre: `${empleado.nombre} ${empleado.apellido}`.trim(),
            correo: empleado.correo,
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
                    `http://localhost:3000/empleados/${encodeURIComponent(empleado.id)}/rol`,
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
        const celdaAcciones = document.createElement("td");
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
    if (!empModal || !empForm || !empError) return;

    empForm.reset();
    empError.hidden = true;
    empError.textContent = "";
    empModal.hidden = false;
    empNombre?.focus();
}

function cerrarModalEmpleado(): void {
    if (!empModal || !empForm || !empError) return;

    empModal.hidden = true;
    empForm.reset();
    empError.hidden = true;
    empError.textContent = "";
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
        const respuesta = await fetch("http://localhost:3000/empleados", {
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
            `http://localhost:3000/empleados/${encodeURIComponent(empleado.id)}/estado`,
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

// Eventos de la interfaz
btnNuevoEmpleado?.addEventListener("click", abrirModalEmpleado);
btnCerrarEmp?.addEventListener("click", cerrarModalEmpleado);
btnCancelarEmp?.addEventListener("click", cerrarModalEmpleado);

empBuscar?.addEventListener("input", dibujarEmpleados);
empForm?.addEventListener("submit", crearEmpleado);

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
