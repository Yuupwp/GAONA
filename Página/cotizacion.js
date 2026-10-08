// =========================================
// COTIZACIÓN GAONA
// - Pide los productos a la API (GET /productos) para llenar las listas.
// - Calcula un total estimado con el precio "desde" de cada producto.
// - Envía la solicitud a la API (POST /solicitudes).
// Requiere config.js cargado antes (define API_URL).
// =========================================

const IVA = 0.16;
const MAX_ITEMS = 30;

const quoteForm = document.getElementById("quoteForm");
const quoteItems = document.getElementById("quoteItems");
const addItemButton = document.getElementById("addItem");
const itemCount = document.getElementById("itemCount");
const summaryList = document.getElementById("summaryList");
const summarySubtotal = document.getElementById("summarySubtotal");
const summaryIva = document.getElementById("summaryIva");
const summaryTotal = document.getElementById("summaryTotal");
const quoteError = document.getElementById("quoteError");
const submitButton = document.getElementById("submitQuote");
const quoteSuccess = document.getElementById("quoteSuccess");
const quoteFolio = document.getElementById("quoteFolio");

// Aquí se guardan los productos que llegan de la API
let products = [];


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

// Crea un campo con etiqueta, igual que los de "Tus datos"
function createField(labelText, control, full) {
    const label = createElement("label", full ? "quote-field quote-field-full" : "quote-field");
    label.append(createElement("span", "", labelText), control);
    return label;
}

function findProduct(id) {
    return products.find(product => product.id === id);
}

// Texto vacío -> undefined, para no mandar campos vacíos a la API
function optional(value) {
    const text = value.trim();
    return text === "" ? undefined : text;
}

function showError(text) {
    quoteError.textContent = text;
    quoteError.hidden = false;
}


// -----------------------------------------
// FILA DE PRODUCTO
// -----------------------------------------

function createProductSelect(selectedId) {

    const select = document.createElement("select");
    select.name = "producto";
    select.required = true;

    const placeholder = createElement("option", "", "Selecciona un producto");
    placeholder.value = "";
    select.appendChild(placeholder);

    // Agrupa las opciones por categoría
    const groups = new Map();

    products.forEach(product => {
        const name = product.category || "Otros";

        if (!groups.has(name)) {
            const group = document.createElement("optgroup");
            group.label = name;
            groups.set(name, group);
        }

        const option = createElement("option", "", product.name);
        option.value = product.id;
        groups.get(name).appendChild(option);
    });

    select.append(...groups.values());
    select.value = findProduct(selectedId) ? selectedId : "";

    return select;
}

function createItem(selectedId) {

    const item = createElement("div", "quote-item");

    const select = createProductSelect(selectedId);

    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.name = "cantidad";
    quantity.min = "1";
    quantity.max = "999";
    quantity.step = "1";
    quantity.value = "1";

    const measures = document.createElement("input");
    measures.type = "text";
    measures.name = "medidas";
    measures.maxLength = 100;
    measures.placeholder = "Ancho x alto (cm)";

    const remove = createElement("button", "quote-remove", "×");
    remove.type = "button";
    remove.title = "Quitar producto";
    remove.setAttribute("aria-label", "Quitar producto");
    remove.addEventListener("click", () => {
        item.remove();
        updateSummary();
    });

    const notes = document.createElement("input");
    notes.type = "text";
    notes.name = "notas";
    notes.maxLength = 500;
    notes.placeholder = "Color, acabado, lado de apertura... (opcional)";

    const price = createElement("p", "quote-item-price");

    item.append(
        createField("Producto", select),
        createField("Cantidad", quantity),
        createField("Medidas aprox.", measures),
        remove,
        createField("Notas", notes, true),
        price
    );

    return item;
}

function addItem(selectedId) {
    quoteItems.appendChild(createItem(selectedId));
    updateSummary();
}

// Lee cada fila del formulario
function readItems() {
    return [...quoteItems.querySelectorAll(".quote-item")].map(item => ({
        element: item,
        product: findProduct(item.querySelector('[name="producto"]').value),
        quantity: Number(item.querySelector('[name="cantidad"]').value),
        measures: item.querySelector('[name="medidas"]').value,
        notes: item.querySelector('[name="notas"]').value
    }));
}

function isValidQuantity(quantity) {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 999;
}


// -----------------------------------------
// CÁLCULO Y RESUMEN
// -----------------------------------------

function updateSummary() {

    const items = readItems();
    let subtotal = 0;
    const lines = [];

    items.forEach(({ element, product, quantity }) => {

        const priceText = element.querySelector(".quote-item-price");

        if (!product) {
            priceText.textContent = "";
            return;
        }

        priceText.replaceChildren(
            "Precio desde ",
            createElement("strong", "", formatPrice(product.price)),
            " c/u"
        );

        if (!isValidQuantity(quantity)) return;

        const lineTotal = product.price * quantity;
        subtotal += lineTotal;

        const line = document.createElement("li");
        line.append(
            createElement("span", "", `${quantity} × ${product.name}`),
            createElement("span", "", formatPrice(lineTotal))
        );
        lines.push(line);
    });

    if (lines.length === 0) {
        summaryList.replaceChildren(createElement("li", "summary-empty", "Aún no eliges productos."));
    } else {
        summaryList.replaceChildren(...lines);
    }

    // Se redondea a centavos para evitar decimales raros
    const iva = Math.round(subtotal * IVA * 100) / 100;

    summarySubtotal.textContent = formatPrice(subtotal);
    summaryIva.textContent = formatPrice(iva);
    summaryTotal.textContent = formatPrice(subtotal + iva);

    // Contador y botones
    itemCount.textContent = `${items.length} producto${items.length !== 1 ? "s" : ""}`;
    addItemButton.disabled = items.length >= MAX_ITEMS;

    quoteItems.querySelectorAll(".quote-remove").forEach(button => {
        button.disabled = items.length === 1;
    });
}


// -----------------------------------------
// VALIDAR Y ENVIAR
// -----------------------------------------

// Marca en rojo el campo si no es válido y regresa si lo es
function check(control, valid) {
    control.classList.toggle("invalid", !valid);
    return valid;
}

function validate(items) {

    let valid = true;

    items.forEach(({ element, product, quantity }) => {
        valid = check(element.querySelector('[name="producto"]'), Boolean(product)) && valid;
        valid = check(element.querySelector('[name="cantidad"]'), isValidQuantity(quantity)) && valid;
    });

    const form = quoteForm.elements;

    valid = check(form.nombre, form.nombre.value.trim() !== "") && valid;
    valid = check(form.apellido, form.apellido.value.trim() !== "") && valid;
    valid = check(form.telefono, form.telefono.value.replace(/\D/g, "").length >= 7) && valid;
    valid = check(form.correo, form.correo.value.trim() === "" || form.correo.checkValidity()) && valid;

    return valid;
}

async function sendQuote(event) {

    event.preventDefault();

    quoteError.hidden = true;

    const items = readItems();

    if (!validate(items)) {
        showError("Revisa los campos marcados en rojo: elige cada producto, su cantidad, y escribe tu nombre, apellido y teléfono.");
        quoteForm.querySelector(".invalid")?.focus();
        return;
    }

    const form = quoteForm.elements;

    const data = {
        cliente: {
            nombre: form.nombre.value.trim(),
            apellido: form.apellido.value.trim(),
            telefono: form.telefono.value.trim(),
            correo: optional(form.correo.value),
            direccion: optional(form.direccion.value)
        },
        descripcion: optional(form.descripcion.value),
        productos: items.map(item => ({
            idProducto: item.product.id,
            cantidad: item.quantity,
            medidasAprox: optional(item.measures),
            notas: optional(item.notes)
        }))
    };

    submitButton.disabled = true;
    submitButton.textContent = "Enviando...";

    try {

        const response = await fetch(`${API_URL}/solicitudes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.error ?? `La API respondió con el código ${response.status}`);
        }

        // Muestra el mensaje de éxito en lugar del formulario
        quoteFolio.textContent = `Folio: ${result.id.slice(0, 8).toUpperCase()}`;
        quoteForm.hidden = true;
        quoteSuccess.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });

    } catch (error) {

        console.error("Error al enviar la cotización:", error);

        showError("No pudimos enviar tu solicitud. Revisa tu conexión e intenta de nuevo en unos minutos.");

        submitButton.disabled = false;
        submitButton.textContent = "Enviar solicitud";
    }
}


// -----------------------------------------
// CARGAR PRODUCTOS DESDE LA API
// -----------------------------------------

async function loadProducts() {

    try {

        const response = await fetch(`${API_URL}/productos`);

        if (!response.ok) {
            throw new Error(`La API respondió con el código ${response.status}`);
        }

        const data = await response.json();

        // precioDesde llega como texto, por eso se convierte con Number()
        products = data.map(item => ({
            id: item.id,
            name: item.nombre,
            price: Number(item.precioDesde),
            category: item.categoria?.nombre ?? ""
        }));

        quoteItems.replaceChildren();

        // Si viene del catálogo (cotizacion.html?producto=ID), se preselecciona
        const selectedId = new URLSearchParams(window.location.search).get("producto");
        addItem(selectedId);

    } catch (error) {

        console.error("Error al cargar los productos:", error);

        quoteItems.replaceChildren(
            createElement("p", "products-message", "No pudimos cargar los productos. Revisa tu conexión e intenta de nuevo en unos minutos.")
        );

        submitButton.disabled = true;
    }
}


// -----------------------------------------
// EVENTOS
// -----------------------------------------

// Cualquier cambio en las filas recalcula el resumen
quoteItems.addEventListener("input", updateSummary);
quoteItems.addEventListener("change", updateSummary);

// Al corregir un campo se quita el borde rojo
function clearInvalid(event) {
    event.target.classList.remove("invalid");
}

quoteForm.addEventListener("input", clearInvalid);
quoteForm.addEventListener("change", clearInvalid);

addItemButton.addEventListener("click", () => addItem());

quoteForm.addEventListener("submit", sendQuote);

loadProducts();
