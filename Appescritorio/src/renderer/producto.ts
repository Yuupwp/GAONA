
"use strict";

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
type TipoMovimiento = "ENTRADA" | "SALIDA" | "AJUSTE";
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
    precioDesde: number | string;
    imagenUrl: string;
    activo: boolean;
    categoria: {
        id: string;
        nombre: string;
    }
}

interface InventarioAPI {
    id: string;
    producto: {
        id: string;
        nombre: string;
        categoria: {
            nombre: string;
        };
    };
    existencia: number;
    minimo: number;
}

interface MovimientoAPI {
    id: string;
    tipo: TipoMovimiento;
    cantidad: number;
    motivo: string | null;
    fecha: string;
    inventario: {
        producto: {
            nombre: string;
        };
    };
    usuario: {
        usuario: string;
    };
}

interface Inventario {
    id: string;
    producto: string;
    categoria: string;
    existencia: number;
    minimo: number;
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

interface Movimiento {
    id: string;
    producto: string;
    tipo: TipoMovimiento;
    cantidad: number;
    motivo: string;
    fecha: string;
    responsable: string;
}

// Elementos HTML
const productosGrid = document.getElementById("productos-grid");
const productosContador = document.getElementById("productos-contador");
const productosVacio = document.getElementById("productos-vacio");
const buscarProducto = document.getElementById("buscar-producto") as HTMLInputElement | null;
const btnAgregarProducto = document.getElementById("btn-agregar-producto");

const existenciasTabla = document.getElementById("existencias-tabla");
const existenciasVacio = document.getElementById("existencias-vacio");

const totalProductos = document.getElementById("existencias-total-productos");
const totalUnidades = document.getElementById("existencias-total-unidades");
const totalBajas = document.getElementById("existencias-bajas");

const buscarExistencia = document.getElementById("buscar-existencia") as HTMLInputElement | null;


const movimientosTabla = document.getElementById("movimientos-tabla");
const movimientosVacio = document.getElementById("movimientos-vacio");

const buscarMovimiento = document.getElementById("buscar-movimiento") as HTMLInputElement | null;
const filtroTipoMovimiento = document.getElementById("filtro-tipo-movimiento") as HTMLSelectElement | null;
const filtroFechaMovimiento = document.getElementById("filtro-fecha-movimiento") as HTMLInputElement | null;


const modalExistencia = document.getElementById("modal-existencia");
const nombreExistencia = document.getElementById("existencia-producto-nombre");
const categoriaExistencia = document.getElementById("existencia-producto-categoria");

const existenciaActual = document.getElementById("existencia-actual") as HTMLInputElement | null;
const existenciaNueva = document.getElementById("existencia-nueva") as HTMLInputElement | null;
const existenciaMinima = document.getElementById("existencia-minima") as HTMLInputElement | null;
const motivoExistencia = document.getElementById("existencia-motivo") as HTMLTextAreaElement | null;

const existenciaError = document.getElementById("existencia-error");

const btnCerrarExistencia = document.getElementById("btn-cerrar-existencia");
const btnCancelarExistencia = document.getElementById("btn-cancelar-existencia");
const btnGuardarExistencia = document.getElementById("btn-guardar-existencia") as HTMLButtonElement | null;
let productos: Producto[] = []
//Cargar productos
async function cargarCatalogo(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3001/productos"
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
            precioDesde: Number(producto.precioDesde), imagenUrl: producto.imagenUrl,
            activo: producto.activo,
            categoria: producto.categoria.nombre
        }));

        dibujarProductos();

        //console.log("Productos cargados desde la API: ",productos);
    } catch (error) {
        console.error(
            "Error al cargar los productos: ",
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

        if (!producto.activo) {
            tarjeta.classList.add("producto-card-inactivo");
        }

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
        const respuesta = await fetch("http://localhost:3001/productos", {
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
        productoUrl.value = producto.imagenUrl ?? "";
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

async function ActualizarProducto(producto: Producto): Promise<void> {

    if (!productoNombre || !productoPrecio || !productoCategoria ||
        !productoTipo || !productoActivo) {
        mostrarErrorFormulario("No se encontraron todos los campos del formulario.");
        return;
    }

    const nuevonombre = productoNombre.value.trim();
    const nuevodescripcion = productoDescripcion?.value.trim() ?? "";
    const nuevoprecioDesde = Number(productoPrecio.value);
    const nuevoidcategoria = productoCategoria.value;
    const nuevotipo = productoTipo.value as TipoProducto;

    // La URL es opcional: si está vacía, se enviará null.
    const nuevoimagenUrl = productoUrl?.value.trim() || null;

    // Convertir explícitamente el estado a booleano.
    const nuevoactivo = productoActivo.value === "true";

    const categoriaOriginal = Object.entries(idsCategoria)
        .find(([id, nombre]) => nombre === producto.categoria)?.[0];

    // Comprobar si existen modificaciones.
    if (
        nuevonombre === producto.nombre &&
        nuevodescripcion === producto.descripcion &&
        nuevoprecioDesde === producto.precioDesde &&
        nuevoidcategoria === categoriaOriginal &&
        nuevotipo === producto.tipo &&
        nuevoimagenUrl === (producto.imagenUrl || null) &&
        nuevoactivo === producto.activo
    ) {
        mostrarErrorFormulario("No has modificado ningún dato del producto.");
        return;
    }

    // Validar campos obligatorios.
    if (
        !nuevonombre ||
        !nuevoidcategoria ||
        !nuevotipo ||
        productoPrecio.value.trim() === "" ||
        !Number.isFinite(nuevoprecioDesde) ||
        nuevoprecioDesde < 0
    ) {
        mostrarErrorFormulario("Completa correctamente los campos obligatorios.");
        return;
    }

    if (nuevodescripcion.length > 500) {
        mostrarErrorFormulario("La descripción no puede superar los 500 caracteres.");
        return;
    }

    try {
        const respuesta = await fetch(
            `http://localhost:3001/productos/${producto.id}`,
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
                    imagenUrl: nuevoimagenUrl,
                    activo: nuevoactivo,
                    idcategoria: nuevoidcategoria
                })
            }
        );

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

        mostrarMensaje(`El producto ${nuevonombre} se editó correctamente.`);

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

let inventarios: Inventario[] = []
async function cargarInventario(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3001/inventario"
        );
        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP: ${respuesta.status}`
            );
        }
        const datos: InventarioAPI[] = await respuesta.json();
        inventarios = datos.map((inventario) => ({
            id: inventario.id,
            producto: inventario.producto.nombre,
            categoria: inventario.producto.categoria.nombre,
            existencia: inventario.existencia,
            minimo: inventario.minimo
        }));

        dibujarInventario();

        console.log(
            "Inventarios cargados desde la API: ",
            inventarios
        );
    } catch (error) {
        console.error("Error al cargar el inventario: ", error);
    }
}

function dibujarInventario(): void {

    if (!existenciasTabla || !existenciasVacio) {
        console.error("No se encontraron los elementos HTML del inventario.");
        return;
    }

    // Obtener búsqueda.
    const busqueda = buscarExistencia?.value.trim().toLowerCase() || "";

    // Filtrar registros.
    const filtrados = inventarios.filter((item) =>
        item.producto.toLowerCase().includes(busqueda) ||
        item.categoria.toLowerCase().includes(busqueda)
    );

    // Limpiar tabla.
    existenciasTabla.replaceChildren();

    // Actualizar resumen general.
    if (totalProductos) {
        totalProductos.textContent = String(inventarios.length);
    }

    if (totalUnidades) {
        const unidades = inventarios.reduce(
            (total, item) => total + item.existencia, 0
        );

        totalUnidades.textContent = String(unidades);
    }

    if (totalBajas) {
        const bajas = inventarios.filter(
            (item) => item.existencia <= item.minimo
        ).length;

        totalBajas.textContent = String(bajas);
    }

    // Mostrar mensaje si no hay resultados.
    existenciasVacio.hidden = filtrados.length > 0;

    // Dibujar filas.
    filtrados.forEach((item) => {

        const fila = document.createElement("tr");

        // Producto.
        const nombre = document.createElement("td");
        nombre.textContent = item.producto;

        // Categoría.
        const categoria = document.createElement("td");
        categoria.textContent = item.categoria;

        // Existencias.
        const existencia = document.createElement("td");
        existencia.textContent = String(item.existencia);

        // Estado.
        const estado = document.createElement("td");
        const estadoEtiqueta = document.createElement("span");

        const existenciaBaja = item.existencia <= item.minimo;

        estadoEtiqueta.className = existenciaBaja
            ? "inventario-estado bajo"
            : "inventario-estado disponible";

        estadoEtiqueta.textContent = existenciaBaja
            ? "Existencias bajas"
            : "Disponible";

        estado.append(estadoEtiqueta);

        // Acciones.
        const acciones = document.createElement("td");
        const btnAjustar = document.createElement("button");

        btnAjustar.type = "button";
        btnAjustar.className = "btn-ajustar-existencia";
        btnAjustar.textContent = "Ajustar";
        btnAjustar.dataset.inventarioId = item.id;

        acciones.append(btnAjustar);
        btnAjustar.addEventListener("click", () => {
            abrirModalExistencia(item);
        });

        // Agregar celdas.
        fila.append(
            nombre,
            categoria,
            existencia,
            estado,
            acciones
        );

        existenciasTabla.append(fila);
    });
}

let inventarioSeleccionado: Inventario | null = null;
function abrirModalExistencia(inventario: Inventario): void {
    if (!modalExistencia) return;
    inventarioSeleccionado = inventario;

    if (nombreExistencia) {
        nombreExistencia.textContent = inventario.producto;
    }
    if (categoriaExistencia) {
        categoriaExistencia.textContent = inventario.categoria;
    }
    if (existenciaActual) {
        existenciaActual.value = String(inventario.existencia)
    }
    if (existenciaNueva) {
        existenciaNueva.value = String(inventario.existencia)
    }
    if (existenciaMinima) {
        existenciaMinima.value = String(inventario.minimo)
    }
    if (motivoExistencia) {
        motivoExistencia.value = "";
    }
    if (existenciaError) {
        existenciaError.textContent = "";
        existenciaError.hidden = true;
    }

    modalExistencia.hidden = false
}

function cerrarModalExistencia(): void {
    if (!modalExistencia) return;

    modalExistencia.hidden = true;
    inventarioSeleccionado = null;
}

async function ajustarExistencias(): Promise<void> {

    if (
        !inventarioSeleccionado ||
        !existenciaNueva ||
        !existenciaMinima
    ) {
        return;
    }

    // Obtener el token de la sesión actual.
    const token = window.gaonaSesion.token();

    if (!token) {
        if (existenciaError) {
            existenciaError.textContent = "Tu sesión ha expirado. Inicia sesión nuevamente.";
            existenciaError.hidden = false;
        }
        return;
    }

    // Obtener los valores del formulario.
    const valorExistencia = existenciaNueva.value.trim();
    const valorMinimo = existenciaMinima.value.trim();

    const nuevaExistencia = Number(valorExistencia);
    const nuevoMinimo = Number(valorMinimo);

    // Validar cantidades.
    if (
        valorExistencia === "" ||
        valorMinimo === "" ||
        !Number.isInteger(nuevaExistencia) ||
        !Number.isInteger(nuevoMinimo) ||
        nuevaExistencia < 0 ||
        nuevoMinimo < 0
    ) {
        if (existenciaError) {
            existenciaError.textContent = "Ingresa cantidades enteras mayores o iguales a cero.";
            existenciaError.hidden = false;
        }
        return;
    }

    // Comprobar que haya cambios.
    if (
        nuevaExistencia === inventarioSeleccionado.existencia &&
        nuevoMinimo === inventarioSeleccionado.minimo
    ) {
        if (existenciaError) {
            existenciaError.textContent = "No has modificado ningún dato del inventario.";
            existenciaError.hidden = false;
        }
        return;
    }

    const motivo = motivoExistencia?.value.trim() || "Ajuste de inventario";

    try {
        if (btnGuardarExistencia) {
            btnGuardarExistencia.disabled = true;
            btnGuardarExistencia.textContent = "Guardando...";
        }

        const respuesta = await fetch(
            `http://localhost:3001/inventario/${inventarioSeleccionado.id}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    existencia: nuevaExistencia,
                    minimo: nuevoMinimo,
                    motivo
                })
            }
        );

        const resultado = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new Error(
                resultado?.error ||
                resultado?.mensaje ||
                "No se pudieron actualizar las existencias."
            );
        }

        // Actualizar las tablas con los datos de la API.
        await cargarInventario();
        await cargarMovimientos();

        cerrarModalExistencia();

        mostrarMensaje(
            resultado?.mensaje || "Las existencias se actualizaron correctamente."
        );

    } catch (error) {
        console.error("Error al ajustar las existencias:", error);

        if (existenciaError) {
            existenciaError.textContent =
                error instanceof Error
                    ? error.message
                    : "Ocurrió un error al actualizar las existencias.";

            existenciaError.hidden = false;
        }

    } finally {
        if (btnGuardarExistencia) {
            btnGuardarExistencia.disabled = false;
            btnGuardarExistencia.textContent = "Guardar cambios";
        }
    }
}

let movimientos: Movimiento[] = []
async function cargarMovimientos(): Promise<void> {
    try {
        const respuesta = await fetch(
            "http://localhost:3001/movimientos_inventario"
        );
        if (!respuesta.ok) {
            throw new Error(
                `Error HTTP: ${respuesta.status}`
            );
        }
        const datos: MovimientoAPI[] = await respuesta.json();
        movimientos = datos.map((movimiento) => ({
            id: movimiento.id,
            producto: movimiento.inventario.producto.nombre,
            tipo: movimiento.tipo,
            cantidad: movimiento.cantidad,
            motivo: movimiento.motivo || "Sin observaciones",
            fecha: movimiento.fecha,
            responsable: movimiento.usuario.usuario
        }));

        dibujarMovimientos();

        console.log(
            "Movimientos cargados desde la API: ",
            movimientos
        );
    } catch (error) {
        console.error("Error al cargar los movimientos: ", error)
    }
}


function dibujarMovimientos(): void {

    if (!movimientosTabla || !movimientosVacio) {
        console.error("No se encontraron los elementos HTML de movimientos.");
        return;
    }

    // Obtener los valores de los filtros.
    const busqueda = buscarMovimiento?.value.trim().toLowerCase() || "";
    const tipoSeleccionado = filtroTipoMovimiento?.value || "";
    const fechaSeleccionada = filtroFechaMovimiento?.value || "";

    // Filtrar movimientos.
    const filtrados = movimientos.filter((movimiento) => {

        const coincideBusqueda =
            movimiento.producto.toLowerCase().includes(busqueda);

        const coincideTipo =
            !tipoSeleccionado || movimiento.tipo === tipoSeleccionado;

        // Convertir la fecha del movimiento al formato YYYY-MM-DD.
        const fecha = new Date(movimiento.fecha);
        const fechaLocal = [
            fecha.getFullYear(),
            String(fecha.getMonth() + 1).padStart(2, "0"),
            String(fecha.getDate()).padStart(2, "0")
        ].join("-");

        const coincideFecha =
            !fechaSeleccionada || fechaLocal === fechaSeleccionada;

        return coincideBusqueda && coincideTipo && coincideFecha;
    });

    // Limpiar la tabla.
    movimientosTabla.replaceChildren();

    // Mostrar mensaje si no hay resultados.
    movimientosVacio.hidden = filtrados.length > 0;

    // Dibujar cada movimiento.
    filtrados.forEach((movimiento) => {

        const fila = document.createElement("tr");

        // Fecha.
        const fecha = document.createElement("td");
        fecha.textContent = new Date(movimiento.fecha).toLocaleString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        // Producto.
        const producto = document.createElement("td");
        producto.textContent = movimiento.producto;

        // Tipo de movimiento.
        const tipo = document.createElement("td");
        const tipoEtiqueta = document.createElement("span");

        tipoEtiqueta.className = `movimiento-tipo ${movimiento.tipo.toLowerCase()}`;

        const nombresTipo: Record<TipoMovimiento, string> = {
            ENTRADA: "Entrada",
            SALIDA: "Salida",
            AJUSTE: "Ajuste"
        };

        tipoEtiqueta.textContent = nombresTipo[movimiento.tipo];
        tipo.append(tipoEtiqueta);

        // Cantidad.
        const cantidad = document.createElement("td");

        if (movimiento.tipo === "ENTRADA") {
            cantidad.textContent = `+${movimiento.cantidad}`;
        } else if (movimiento.tipo === "SALIDA") {
            cantidad.textContent = `-${movimiento.cantidad}`;
        } else {
            cantidad.textContent = String(movimiento.cantidad);
        }

        // Responsable.
        const responsable = document.createElement("td");
        responsable.textContent = movimiento.responsable;

        // Observaciones.
        const observaciones = document.createElement("td");
        observaciones.textContent = movimiento.motivo;

        // Agregar celdas.
        fila.append(
            fecha,
            producto,
            tipo,
            cantidad,
            responsable,
            observaciones
        );

        movimientosTabla.append(fila);
    });
}


// =====================================
// NAVEGACIÓN DE INVENTARIO
// =====================================

const inventarioTabs = document.querySelectorAll<HTMLButtonElement>(
    ".inventario-tab"
);

const inventarioPanels = document.querySelectorAll<HTMLElement>(
    ".inventario-panel"
);

inventarioTabs.forEach(tab => {

    tab.addEventListener("click", () => {

        const destino = tab.dataset.tab;

        // Desactivar pestañas
        inventarioTabs.forEach(t => t.classList.remove("activa"));

        // Ocultar paneles
        inventarioPanels.forEach(panel => {
            panel.classList.remove("activa");
        });

        // Activar pestaña seleccionada
        tab.classList.add("activa");

        // Mostrar panel correspondiente
        const panelDestino = document.getElementById(
            `inventario-${destino}`
        );

        panelDestino?.classList.add("activa");

    });

});


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

buscarExistencia?.addEventListener("input", dibujarInventario);

buscarMovimiento?.addEventListener("input", dibujarMovimientos);

filtroTipoMovimiento?.addEventListener("change", dibujarMovimientos);

filtroFechaMovimiento?.addEventListener("change", dibujarMovimientos);

// Eventos del modal de existencias.
btnGuardarExistencia?.addEventListener("click", () => {
    ajustarExistencias();
});

btnCerrarExistencia?.addEventListener("click", cerrarModalExistencia);

btnCancelarExistencia?.addEventListener("click", cerrarModalExistencia);

modalExistencia?.addEventListener("click", (event) => {
    if (event.target === modalExistencia) {
        cerrarModalExistencia();
    }
});

// Inicialización
if (validarElementosProductos()) {
    cargarCategorias();
    cargarCatalogo();
    cargarInventario();
    cargarMovimientos();
}


