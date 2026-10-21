
"use strict";

interface Producto {
    id: number;
    nombre: string;
    codigo: string;
    precio: number;
    stock: number;
    descripcion: string;
}

// Elementos HTML
const productosGrid = document.getElementById("productos-grid");
const productosContador = document.getElementById("productos-contador");
const productosVacio = document.getElementById("productos-vacio");
const productosMensaje = document.getElementById("productos-mensaje");
const buscarProducto = document.getElementById("buscar-producto") as HTMLInputElement | null;
const btnAgregarProducto = document.getElementById("btn-agregar-producto");

// Productos de prueba: después los conectamos con la base de datos.
let productos: Producto[] = [
    {
        id: 1,
        nombre: "Producto de ejemplo",
        codigo: "GAO-001",
        precio: 1500,
        stock: 10,
        descripcion: "Este es un producto de prueba."
    },
    {
        id: 2,
        nombre: "Material de ejemplo",
        codigo: "GAO-002",
        precio: 850,
        stock: 5,
        descripcion: "Segundo producto para comprobar las tarjetas."
    }
];

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
        producto.codigo.toLowerCase().includes(busqueda)
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

        const codigo = document.createElement("span");
        codigo.className = "producto-codigo";
        codigo.textContent = producto.codigo;

        const nombre = document.createElement("h3");
        nombre.className = "producto-nombre";
        nombre.textContent = producto.nombre;

        const descripcion = document.createElement("p");
        descripcion.className = "producto-descripcion";
        descripcion.textContent =
            producto.descripcion || "Sin descripción";

        const precio = document.createElement("p");
        precio.className = "producto-precio";
        precio.textContent = producto.precio.toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN"
        });

        const stock = document.createElement("p");
        stock.className = "producto-stock";
        stock.textContent = `Existencias: ${producto.stock}`;

        const btnEditar = document.createElement("button");
        btnEditar.type = "button";
        btnEditar.className = "btn-editar-producto";
        btnEditar.textContent = "Editar";

        btnEditar.addEventListener("click", () => {
            editarProducto(producto);
        });

        contenido.append(codigo, nombre, descripcion, precio, stock);
        tarjeta.append(contenido, btnEditar);
        productosGrid.append(tarjeta);
    });
}

// Agregar un producto de prueba.
function agregarProducto(): void {
    const nombre = prompt("Nombre del producto:");

    if (!nombre || !nombre.trim()) {
        return;
    }

    const codigo = prompt("Código del producto:");

    if (!codigo || !codigo.trim()) {
        return;
    }

    const precioTexto = prompt("Precio del producto:", "0");
    const precio = Number(precioTexto);

    if (precioTexto === null || !Number.isFinite(precio) || precio < 0) {
        alert("Ingresa un precio válido.");
        return;
    }

    const stockTexto = prompt("Cantidad en existencia:", "0");
    const stock = Number(stockTexto);

    if (
        stockTexto === null ||
        !Number.isInteger(stock) ||
        stock < 0
    ) {
        alert("Ingresa una cantidad válida.");
        return;
    }

    productos.push({
        id: Date.now(),
        nombre: nombre.trim(),
        codigo: codigo.trim(),
        precio,
        stock,
        descripcion: ""
    });

    dibujarProductos();
}

// Editar un producto de prueba.
function editarProducto(producto: Producto): void {
    const nombre = prompt("Nombre del producto:", producto.nombre);

    if (!nombre || !nombre.trim()) {
        return;
    }

    const precioTexto = prompt(
        "Precio del producto:",
        String(producto.precio)
    );

    if (precioTexto === null) {
        return;
    }

    const precio = Number(precioTexto);

    if (!Number.isFinite(precio) || precio < 0) {
        alert("Ingresa un precio válido.");
        return;
    }

    const stockTexto = prompt(
        "Cantidad en existencia:",
        String(producto.stock)
    );

    if (stockTexto === null) {
        return;
    }

    const stock = Number(stockTexto);

    if (!Number.isInteger(stock) || stock < 0) {
        alert("Ingresa una cantidad válida.");
        return;
    }

    producto.nombre = nombre.trim();
    producto.precio = precio;
    producto.stock = stock;

    dibujarProductos();
}

// Eventos
buscarProducto?.addEventListener("input", dibujarProductos);

btnAgregarProducto?.addEventListener("click", agregarProducto);

// Inicialización
if (validarElementosProductos()) {
    dibujarProductos();
}
