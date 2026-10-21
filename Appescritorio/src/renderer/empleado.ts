
"use strict";

interface Empleado {
    id: number;
    nombre: string;
    correo: string;
    rol: string;
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
const empCorreo = document.getElementById("emp-correo") as HTMLInputElement | null;
const empRol = document.getElementById("emp-rol") as HTMLSelectElement | null;
const empContrasena = document.getElementById("emp-contrasena") as HTMLInputElement | null;
const empConfirmarContrasena = document.getElementById("emp-confirmar-contrasena") as HTMLInputElement | null;
const empError = document.getElementById("emp-error");

const empConfirmarModal = document.getElementById("emp-confirmar-modal");
const empConfirmarTexto = document.getElementById("emp-confirmar-texto");
const empEliminarConfirmar = document.getElementById("emp-eliminar-confirmar");

const btnNuevoEmpleado = document.getElementById("btn-nuevo-empleado");
const btnCerrarEmp = document.getElementById("emp-cerrar");
const btnCancelarEmp = document.getElementById("emp-cancelar");
const btnCancelarEliminar = document.getElementById("emp-eliminar-cancelar");

const rolesEmpleados = [
    "Administrador",
    "Ventas",
    "Diseño",
    "Instalación"
];

// Datos de demostración. Posteriormente se cargarán desde la API.
let empleados: Empleado[] = [
    {
        id: 1,
        nombre: "María Fernanda López",
        correo: "maria@gaona.com",
        rol: "Administrador"
    },
    {
        id: 2,
        nombre: "Carlos Rodríguez",
        correo: "carlos@gaona.com",
        rol: "Ventas"
    },
    {
        id: 3,
        nombre: "Andrea Martínez",
        correo: "andrea@gaona.com",
        rol: "Diseño"
    },
    {
        id: 4,
        nombre: "Luis Hernández",
        correo: "luis@gaona.com",
        rol: "Instalación"
    }
];

let empleadoPendienteEliminar: number | null = null;
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

        identidad.append(avatar, nombre);
        celdaNombre.append(identidad);

        // Correo
        const celdaCorreo = document.createElement("td");
        celdaCorreo.className = "emp-correo-tabla";
        celdaCorreo.textContent = empleado.correo;

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

        selectorRol.addEventListener("change", () => {
            const nuevoRol = selectorRol.value;

            if (!rolesEmpleados.includes(nuevoRol)) return;

            empleado.rol = nuevoRol;
            actualizarResumen();
            mostrarMensaje(`Rol actualizado para ${empleado.nombre}.`);
        });

        celdaRol.append(selectorRol);

        // Acción para eliminar
        const celdaAcciones = document.createElement("td");
        const btnEliminar = document.createElement("button");
        btnEliminar.type = "button";
        btnEliminar.className = "emp-accion-eliminar";
        btnEliminar.textContent = "Eliminar";

        btnEliminar.addEventListener("click", () => {
            solicitarEliminar(empleado);
        });

        celdaAcciones.append(btnEliminar);
        fila.append(celdaNombre, celdaCorreo, celdaRol, celdaAcciones);
        empTabla.append(fila);
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

function crearEmpleado(event: SubmitEvent): void {
    event.preventDefault();

    if (
        !empNombre ||
        !empCorreo ||
        !empRol ||
        !empContrasena ||
        !empConfirmarContrasena
    ) {
        return;
    }

    const nombre = empNombre.value.trim();
    const correo = empCorreo.value.trim().toLowerCase();
    const rol = empRol.value;
    const contrasena = empContrasena.value;
    const confirmar = empConfirmarContrasena.value;

    if (!nombre || !correo || !rol || !contrasena || !confirmar) {
        mostrarErrorFormulario("Completa todos los campos obligatorios.");
        return;
    }

    if (!rolesEmpleados.includes(rol)) {
        mostrarErrorFormulario("Selecciona un rol válido.");
        return;
    }

    if (contrasena.length < 8) {
        mostrarErrorFormulario("La contraseña debe tener al menos 8 caracteres.");
        return;
    }

    if (contrasena !== confirmar) {
        mostrarErrorFormulario("Las contraseñas no coinciden.");
        empConfirmarContrasena.focus();
        return;
    }

    const correoExistente = empleados.some(
        (empleado) => empleado.correo.toLowerCase() === correo
    );

    if (correoExistente) {
        mostrarErrorFormulario("Ya existe un empleado con ese correo.");
        empCorreo.focus();
        return;
    }

    empleados.push({
        id: Date.now(),
        nombre,
        correo,
        rol
    });

    cerrarModalEmpleado();
    dibujarEmpleados();
    mostrarMensaje(`La cuenta de ${nombre} se agregó a la lista de demostración.`);
}

function solicitarEliminar(empleado: Empleado): void {
    if (!empConfirmarModal || !empConfirmarTexto) return;

    empleadoPendienteEliminar = empleado.id;
    empConfirmarTexto.textContent =
        `¿Deseas eliminar la cuenta de ${empleado.nombre} (${empleado.correo})?`;

    empConfirmarModal.hidden = false;
}

function cerrarConfirmacionEliminar(): void {
    if (!empConfirmarModal) return;

    empConfirmarModal.hidden = true;
    empleadoPendienteEliminar = null;
}

function eliminarEmpleadoConfirmado(): void {
    if (empleadoPendienteEliminar === null) return;

    const empleado = empleados.find(
        (elemento) => elemento.id === empleadoPendienteEliminar
    );

    empleados = empleados.filter(
        (elemento) => elemento.id !== empleadoPendienteEliminar
    );

    cerrarConfirmacionEliminar();
    dibujarEmpleados();

    if (empleado) {
        mostrarMensaje(`Se eliminó a ${empleado.nombre} de la lista de demostración.`);
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
    dibujarEmpleados();
    console.log("Empleados: interfaz inicializada correctamente.");
}
