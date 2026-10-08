// =========================================
// CATÁLOGO GAONA
// Los productos se piden a la API (GET /productos).
// Requiere config.js cargado antes (define API_URL).
// =========================================

const searchInput = document.getElementById("searchInput");
const categoryInputs = document.querySelectorAll('input[name="category"]');
const sortProducts = document.getElementById("sortProducts");
const productCount = document.getElementById("productCount");
const productsGrid = document.getElementById("productsGrid");

// Aquí se guardan los productos que llegan de la API
let products = [];


// -----------------------------------------
// UTILIDADES
// -----------------------------------------

// Quita acentos y mayúsculas para que "silicon" encuentre "Silicón"
function normalize(text) {
    return String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

// 4850 -> "$4,850 MXN"
function formatPrice(value) {
    return `$${value.toLocaleString("es-MX", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    })} MXN`;
}

// Crea un elemento con clase y texto (textContent evita inyectar HTML)
function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// Muestra un mensaje dentro de la cuadrícula
function showMessage(text) {
    productsGrid.replaceChildren(createElement("p", "products-message", text));
}


// -----------------------------------------
// TARJETA DE PRODUCTO
// (misma estructura y clases que tenía el HTML estático)
// -----------------------------------------

function createCard(product) {

    const card = createElement("article", "product-card");

    // Imagen
    const imageBox = createElement("div", "product-image");

    if (product.image) {
        const img = document.createElement("img");
        img.src = product.image;
        img.alt = product.name;

        // Si la imagen no existe, se queda el fondo gris
        img.addEventListener("error", () => img.remove());

        imageBox.appendChild(img);
    }

    // Información
    const info = createElement("div", "product-info");

    info.appendChild(createElement("span", "product-category", product.category));
    info.appendChild(createElement("h2", "", product.name));
    info.appendChild(createElement("p", "", product.description));

    const bottom = createElement("div", "product-bottom");
    const priceBox = document.createElement("div");

    priceBox.appendChild(createElement("span", "price-label", "Desde"));
    priceBox.appendChild(createElement("strong", "", formatPrice(product.price)));
    bottom.appendChild(priceBox);
    info.appendChild(bottom);

    // Botón: lleva a la pantalla de cotización con el producto elegido
    const quote = createElement("a", "quote-button", "Solicitar cotización");
    quote.href = `cotizacion.html?producto=${encodeURIComponent(product.id)}`;
    info.appendChild(quote);

    card.append(imageBox, info);
    return card;
}


// -----------------------------------------
// FILTRAR, ORDENAR Y MOSTRAR
// -----------------------------------------

function updateProducts() {

    const search = normalize(searchInput.value);

    const selectedCategory =
        document.querySelector('input[name="category"]:checked').value;

    let visibleProducts = products.filter(product => {

        const matchesSearch = normalize(product.name).includes(search);

        const matchesCategory =
            selectedCategory === "todos" ||
            product.categorySlug === selectedCategory;

        return matchesSearch && matchesCategory;
    });

    // Ordenar
    if (sortProducts.value === "low") {
        visibleProducts.sort((a, b) => a.price - b.price);
    }

    if (sortProducts.value === "high") {
        visibleProducts.sort((a, b) => b.price - a.price);
    }

    // Mostrar
    if (visibleProducts.length === 0) {
        showMessage("No encontramos productos con esos filtros. Prueba con otra búsqueda o categoría.");
    } else {
        productsGrid.replaceChildren(...visibleProducts.map(createCard));
    }

    // Contador
    productCount.textContent =
        `${visibleProducts.length} producto${visibleProducts.length !== 1 ? "s" : ""}`;
}


// -----------------------------------------
// CARGAR PRODUCTOS DESDE LA API
// -----------------------------------------

async function loadProducts() {

    showMessage("Cargando productos...");
    productCount.textContent = "";

    try {

        const response = await fetch(`${API_URL}/productos`);

        if (!response.ok) {
            throw new Error(`La API respondió con el código ${response.status}`);
        }

        const data = await response.json();

        // Se adapta cada producto de la API a lo que usa la página.
        // precioDesde llega como texto, por eso se convierte con Number().
        products = data.map(item => ({
            id: item.id,
            name: item.nombre,
            description: item.descripcion ?? "",
            price: Number(item.precioDesde),
            image: item.imagenUrl,
            category: item.categoria?.nombre ?? "",
            categorySlug: normalize(item.categoria?.nombre ?? "")
        }));

        updateProducts();

    } catch (error) {

        console.error("Error al cargar el catálogo:", error);

        showMessage("No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo en unos minutos.");
    }
}


// -----------------------------------------
// EVENTOS
// -----------------------------------------

searchInput.addEventListener("input", updateProducts);

categoryInputs.forEach(input => {
    input.addEventListener("change", updateProducts);
});

sortProducts.addEventListener("change", updateProducts);

loadProducts();