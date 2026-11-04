
"use strict";

import { error } from "console";
const modalProducto = document.getElementById("modal-producto");
const modalProductoTitulo = document.getElementById("modal-producto-titulo");
const modalProductoDescripcion = document.getElementById("modal-producto-descripcion");
const productosMensaje = document.getElementById("productos-mensaje");
const productoError = document.getElementById("producto-error");
const formProducto = document.getElementById("form-producto") as HTMLFormElement | null;
let mensajeTemporizador: number | undefined;

const productoId = document.getElementById("producto-id") as HTMLInputElement | null;
const productoNombre = document.getElementById("producto-nombre") as HTMLInputElement | null;
const productoPrecio = document.getElementById("producto-precio") as HTMLInputElement | null;
const productoDescripcion = document.getElementById("producto-descripcion") as HTMLTextAreaElement | null;
const productoTipo = document.getElementById("producto-tipo") as HTMLSelectElement | null;
const productoCategoria = document.getElementById("producto-categoria") as HTMLSelectElement | null;
const productoUrl = document.getElementById("producto-imagen") as HTMLInputElement | null;
const productoActivo = document.getElementById("producto-activo") as HTMLSelectElement | null;
const btnCerrarModalProducto = document.getElementById("btn-cerrar-modal-producto");
const btnCancelarProducto = document.getElementById("btn-cancelar-producto");
const btnGuardarProducto = document.getElementById("btn-guardar-producto");

type TipoProducto = "PRODUCTO" | "MATERIAL" | "HERRAMIENTA";
const idsCategoria: Record<string, string> = {
    "05629c44-d415-40ad-a8d8-8d431e219c44": "Accesorios",
    "089df661-3cef-4edd-9301-6ecf1a86c2c7": "Chapas",
    "7415897b-d04a-49c8-8816-b0a1ffeb06f9": "Ventanas",
    "7d6bcc3b-e8b6-4b5e-9c43-57f1f2dcd620": "Canceles",
    "7fcd77ff-cd74-4271-ad99-d26da912a825": "Puertas",
    "e32352b2-98c4-4910-bf44-492f9833d2bc": "Marcos",
}

interface ProductoAPI {
    id: string;
    nombre: string;
    tipo: TipoProducto;
    descripcion: string;
    precioDesde: number;
    imagenUrl: string;
    activo: boolean;
    categoria: {
        id: string;
        nombre: string;
    }
}

interface Producto {
    id: string;
    nombre: string;
    tipo: TipoProducto;
    descripcion: string;
    precioDesde: number;
    imagenUrl: string;
    activo: boolean;
    categoria: string
}

// Elementos HTML
const productosGrid = document.getElementById("productos-grid");
const productosContador = document.getElementById("productos-contador");
const productosVacio = document.getElementById("productos-vacio");
const buscarProducto = document.getElementById("buscar-producto") as HTMLInputElement | null;
const btnAgregarProducto = document.getElementById("btn-agregar-producto");

let productos: Producto[] = []
//Cargar productos
async function cargarCatalogo(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3000/productos"
        );
        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP: ${respuesta.status}`
            );
        }

        const datos: ProductoAPI[] = await respuesta.json();
        productos = datos.map((producto) => ({
            id: producto.id,
            nombre: producto.nombre.trim(),
            tipo: producto.tipo,
            descripcion: producto.descripcion,
            precioDesde: producto.precioDesde,
            imagenUrl: producto.imagenUrl,
            activo: producto.activo,
            categoria: producto.categoria.nombre
        }));

        dibujarProductos();

        console.log(
            "Productos cargados desde la API: ",
            productos
        );
    } catch (error) {
        console.error(
            "Error al cargar los empleados: ",
            error
        );
    }
}


// Comprobar que los elementos HTML existen.
function validarElementosProductos(): boolean {
    if (
        !productosGrid ||
        !productosContador ||
        !productosVacio ||
        !btnAgregarProducto
    ) {
        console.error(
            "Productos: no se encontraron todos los elementos HTML.",
            {
                productosGrid,
                productosContador,
                productosVacio,
                btnAgregarProducto
            }
        );

        return false;
    }

    console.log("Productos: elementos HTML encontrados.");
    return true;
}

// Dibujar las tarjetas.
function dibujarProductos(): void {
    if (!validarElementosProductos()) {
        return;
    }

    if (!productosGrid || !productosContador || !productosVacio) {
        return;
    }

    const busqueda = buscarProducto?.value.trim().toLowerCase() || "";
    const filtrados = productos.filter((producto) =>
        producto.nombre.toLowerCase().includes(busqueda) ||
        producto.categoria.toLowerCase().includes(busqueda) ||
        producto.tipo.toLowerCase().includes(busqueda)
    );

    productosGrid.replaceChildren();
    productosContador.textContent =
        `${filtrados.length} producto${filtrados.length === 1 ? "" : "s"}`;

    productosVacio.hidden = filtrados.length > 0;
    filtrados.forEach((producto) => {

        const tarjeta = document.createElement("article");
        tarjeta.className = "producto-card";

        const contenido = document.createElement("div");
        contenido.className = "producto-card-contenido";

        // Nombre.
        const nombre = document.createElement("h3");
        nombre.className = "producto-nombre";
        nombre.textContent = producto.nombre;

        // Tipo.
        const tipo = document.createElement("span");
        tipo.className = "producto-tipo";
        tipo.textContent = producto.tipo;

        // Categoría.
        const categoria = document.createElement("span");
        categoria.className = "producto-categoria";
        categoria.textContent = producto.categoria;

        // Descripción.
        const descripcion = document.createElement("p");
        descripcion.className = "producto-descripcion";
        descripcion.textContent =
            producto.descripcion || "Sin descripción";

        // Precio.
        const precio = document.createElement("p");
        precio.className = "producto-precio";
        precio.textContent = producto.precioDesde.toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN"
        });

        // Estado.
        const estado = document.createElement("span");
        estado.className = producto.activo
            ? "producto-activo"
            : "producto-inactivo";

        estado.textContent = producto.activo ? "Activo" : "Inactivo";

        // Botón de edición.
        const btnEditar = document.createElement("button");
        btnEditar.type = "button";
        btnEditar.className = "btn-editar-producto";
        btnEditar.textContent = "Editar";

        btnEditar.addEventListener("click", () => {
            editarProducto(producto);
        });

        // Agregar elementos a la tarjeta.
        contenido.append(
            nombre,
            tipo,
            categoria,
            descripcion,
            precio,
            estado
        );

        tarjeta.append(contenido, btnEditar);

        productosGrid.append(tarjeta);
    });
}

async function crearProducto(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    limpiarErrorFormulario();

    if (
        !productoNombre ||
        !productoDescripcion ||
        !productoPrecio ||
        !productoCategoria ||
        !productoTipo ||
        !productoActivo
    ) {
        mostrarErrorFormulario("No se encontraron todos los campos del formulario.");
        return;
    }

    const nombre = productoNombre.value.trim();
    const descripcion = productoDescripcion.value.trim();
    const precioDesde = Number(productoPrecio.value);
    const idcategoria = productoCategoria.value;
    const tipo = productoTipo.value as TipoProducto;
    const imagenUrl = productoUrl?.value.trim() || "";
    const activo = productoActivo.value === "true";

    // Validar campos obligatorios.
    if (
        !nombre ||
        !idcategoria ||
        !tipo ||
        !productoPrecio.value ||
        !Number.isFinite(precioDesde) ||
        precioDesde < 0
    ) {
        mostrarErrorFormulario("Completa correctamente los campos obligatorios.");
        return;
    }

    // Validar descripción.
    if (descripcion.length > 500) {
        mostrarErrorFormulario("La descripción no puede superar los 500 caracteres.");
        return;
    }

    // Comprobar si ya existe el producto.
    const productoExistente = productos.some(
        (producto) =>
            producto.nombre.toLowerCase() === nombre.toLowerCase()
    );

    if (productoExistente) {
        mostrarErrorFormulario("Ya existe un producto con ese nombre.");
        productoNombre.focus();
        return;
    }

    try {
        const respuesta = await fetch("http://localhost:3000/productos", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nombre,
                tipo,
                descripcion,
                precioDesde,
                imagenUrl: imagenUrl || null,
                activo,
                idcategoria
            })
        });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.mensaje ||
                resultado.error ||
                "No se pudo crear el producto."
            );
        }

        await cargarCatalogo();
        cerrarModalProducto();

        formProducto?.reset();

        mostrarMensaje(`El producto ${nombre} se creó correctamente.`);

    } catch (error) {
        console.error("Error al crear el producto:", error);

        mostrarErrorFormulario(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al crear el producto."
        );
    }
}

function editarProducto(producto: Producto): void {
    abrirModalProducto();

    if (modalProductoTitulo) {
        modalProductoTitulo.textContent = "Editar producto";
    }

    if (modalProductoDescripcion) {
        modalProductoDescripcion.textContent =
            "Modifica la información del producto.";
    }

    if (btnGuardarProducto) {
        btnGuardarProducto.textContent = "Guardar cambios";
    }

    if (productoId) {
        productoId.value = producto.id;
    }

    if (productoNombre) {
        productoNombre.value = producto.nombre;
    }

    if (productoPrecio) {
        productoPrecio.value = String(producto.precioDesde);
    }

    if (productoTipo) {
        productoTipo.value = producto.tipo;
    }

    if (productoUrl) {
        productoUrl.value = producto.imagenUrl || "";
    }

    if (productoDescripcion) {
        productoDescripcion.value = producto.descripcion || "";
    }

    if (productoActivo) {
        productoActivo.value = String(producto.activo);
    }

    const categoriaId = Object.entries(idsCategoria)
        .find(([id, nombre]) => nombre === producto.categoria)?.[0];

    if (productoCategoria && categoriaId) {
        productoCategoria.value = categoriaId;
    }
}

async function ActualizarProducto(producto: Producto) {
    const nuevonombre = productoNombre?.value.trim();
    const nuevodescripcion = productoDescripcion?.value.trim();
    const nuevoprecioDesde = Number(productoPrecio?.value);
    const nuevoidcategoria = productoCategoria?.value;
    const nuevotipo = productoTipo?.value as TipoProducto;
    const nuevoimagenUrl = productoUrl?.value.trim() || "";
    const nuevoactivo = productoActivo?.value === "true";
    const categoriaOriginal = Object.entries(idsCategoria)
        .find(([id, nombre]) => nombre === producto.categoria)?.[0];

    if (
        nuevonombre === producto.nombre &&
        nuevodescripcion === producto.descripcion &&
        nuevoprecioDesde === producto.precioDesde &&
        nuevoidcategoria === categoriaOriginal &&
        nuevotipo === producto.tipo &&
        nuevoimagenUrl === (producto.imagenUrl || "") &&
        nuevoactivo === producto.activo
    ) {
        mostrarErrorFormulario("No has modificado ningún dato del producto.");
        return;
    }

    if (
        !nuevonombre ||
        !nuevoidcategoria ||
        !nuevotipo ||
        !Number.isFinite(nuevoprecioDesde) ||
        nuevoprecioDesde < 0
    ) {
        mostrarErrorFormulario("Completa correctamente los campos obligatorios.");
        return;
    }

    try {
        const respuesta = await fetch(`http://localhost:3000/productos/${producto.id}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    nombre: nuevonombre,
                    tipo: nuevotipo,
                    descripcion: nuevodescripcion,
                    precioDesde: nuevoprecioDesde,
                    imagenUrl: nuevoimagenUrl || null,
                    activo: nuevoactivo,
                    idcategoria: nuevoidcategoria

                })
            });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.mensaje ||
                resultado.error ||
                "No se pudo editar el producto."
            );
        }

        await cargarCatalogo();
        cerrarModalProducto();

        formProducto?.reset();
        mostrarMensaje(`El producto ${nuevonombre} se edito correctamente.`)
    } catch (error) {
        console.error("Error al editar el producto:", error);

        mostrarErrorFormulario(
            error instanceof Error
                ? error.message
                : "Ocurrió un error al editar el producto."
        );
    }
}

function abrirModalProducto(): void {
    if (!modalProducto || !formProducto) return;

    formProducto.reset();

    if (productoId) {
        productoId.value = "";
    }

    if (modalProductoTitulo) {
        modalProductoTitulo.textContent = "Agregar producto";
    }

    if (modalProductoDescripcion) {
        modalProductoDescripcion.textContent =
            "Completa la información del producto.";
    }

    if (btnGuardarProducto) {
        btnGuardarProducto.textContent = "Guardar producto";
    }

    modalProducto.hidden = false;
}

function cerrarModalProducto(): void {
    if (!modalProducto) return;

    modalProducto.hidden = true;
}

function cargarCategorias(): void {
    if (!productoCategoria) return;

    productoCategoria.replaceChildren();

    const opcionInicial = document.createElement("option");
    opcionInicial.value = "";
    opcionInicial.textContent = "Selecciona una categoría";

    productoCategoria.append(opcionInicial);

    Object.entries(idsCategoria).forEach(([id, nombre]) => {
        const opcion = document.createElement("option");

        opcion.value = id;
        opcion.textContent = nombre;

        productoCategoria.append(opcion);
    });
}

function mostrarMensaje(texto: string): void {
    if (!productosMensaje) return;

    productosMensaje.textContent = texto;
    productosMensaje.hidden = false;

    if (mensajeTemporizador !== undefined) {
        window.clearTimeout(mensajeTemporizador);
    }

    mensajeTemporizador = window.setTimeout(() => {
        if (productosMensaje) {
            productosMensaje.hidden = true;
        }
    }, 3500);
}

function mostrarErrorFormulario(texto: string): void {
    if (!productoError) return;

    productoError.textContent = texto;
    productoError.hidden = false;
}

function limpiarErrorFormulario(): void {
    if (!productoError) return;

    productoError.textContent = "";
    productoError.hidden = true;
}

// Eventos
buscarProducto?.addEventListener("input", dibujarProductos);
btnAgregarProducto?.addEventListener("click", abrirModalProducto);
btnCerrarModalProducto?.addEventListener("click", cerrarModalProducto);
btnCancelarProducto?.addEventListener("click", cerrarModalProducto);
modalProducto?.addEventListener("click", (event) => {
    if (event.target === modalProducto) {
        cerrarModalProducto();
    }
});

formProducto?.addEventListener("submit", (event) => {

    event.preventDefault();

    if (productoId?.value) {
        const productoSeleccionado = productos.find(
            (producto) => producto.id === productoId.value
        );

        if (productoSeleccionado) {
            ActualizarProducto(productoSeleccionado);
        } else {
            mostrarErrorFormulario("No se encontró el producto seleccionado.");
        }

    } else {
        crearProducto(event);
    }

});

document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && modalProducto && !modalProducto.hidden) {
        cerrarModalProducto();
    }
});

// Inicialización
if (validarElementosProductos()) {
    cargarCategorias();
    cargarCatalogo();
}
