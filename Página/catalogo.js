// =========================================
// CATÁLOGO GAONA
// Los productos se piden a la API (GET /productos).
// =========================================

const searchInput = document.getElementById("searchInput");
const categoryFilters = document.getElementById("categoryFilters");
const sortProducts = document.getElementById("sortProducts");
const productCount = document.getElementById("productCount");
const productsGrid = document.getElementById("productsGrid");

// Aquí se guardan los productos que llegan de la API
let products = [];
let state = "loading";
let loading = false;


// -----------------------------------------
// UTILIDADES
// -----------------------------------------

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
function showMessage(text, retry = false) {
    const message = createElement("div", "products-message");
    message.appendChild(createElement("p", "", text));
    if (retry) {
        const button = createElement("button", "btn btn-primary retry-button", "Reintentar");
        button.type = "button";
        button.addEventListener("click", loadProducts);
        message.appendChild(button);
    }
    productsGrid.replaceChildren(message);
}


// -----------------------------------------
// TARJETA DE PRODUCTO
// (misma estructura y clases que tenía el HTML estático)
// -----------------------------------------

function createCard(product) {

    const card = createElement("article", "product-card");

    // Imagen
    const imageBox = createElement("div", "product-image");

    imageBox.appendChild(createElement("span", "image-placeholder", "Imagen no disponible"));

    if (product.image) {
        const img = document.createElement("img");
        img.src = product.image;
        img.alt = product.name;
        img.loading = "lazy";

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

    if (state !== "ready") return;
    const selectedCategory = categoryFilters.querySelector('input:checked')?.value || "";
    const visibleProducts = CatalogProducts.filter(
        products, searchInput.value, selectedCategory, sortProducts.value
    );

    // Mostrar
    if (products.length === 0) {
        showMessage("Por el momento no hay productos disponibles.");
    } else if (visibleProducts.length === 0) {
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

function renderCategories() {
    const requested = new URLSearchParams(window.location.search).get("categoria");
    const selected = categoryFilters.querySelector('input:checked')?.value || requested || "";
    const categories = [...new Set(products.map(product => product.category))]
        .sort((a, b) => a.localeCompare(b, "es"));
    const labels = ["", ...categories].map(category => {
        const label = createElement("label", "category-option");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "category";
        input.value = category;
        input.checked = category === (categories.includes(selected) ? selected : "");
        label.append(input, category || "Todos los productos");
        return label;
    });
    categoryFilters.replaceChildren(...labels);
}

async function loadProducts() {
    if (loading) return;
    loading = true;
    state = "loading";
    productsGrid.setAttribute("aria-busy", "true");
    showMessage("Cargando productos...");
    productCount.textContent = "";
    try {
        products = await CatalogProducts.load();
        renderCategories();
        state = "ready";
        updateProducts();
    } catch {
        state = "error";
        showMessage("No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.", true);
    } finally {
        loading = false;
        productsGrid.setAttribute("aria-busy", "false");
    }
}

searchInput.addEventListener("input", updateProducts);
document.getElementById("searchButton").addEventListener("click", updateProducts);
categoryFilters.addEventListener("change", updateProducts);
sortProducts.addEventListener("change", updateProducts);
loadProducts();
