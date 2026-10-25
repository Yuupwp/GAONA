// =========================================
// COTIZACIÓN GAONA
// - Pide los productos a la API (GET /productos) para llenar las listas.
// - Calcula un total estimado con el precio "desde" de cada producto.
// - Envía la solicitud a la API (POST /solicitudes).
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
const downloadPdfButton = document.getElementById("downloadPdf");
const pdfStatus = document.getElementById("pdfStatus");
const mailStatus = document.getElementById("mailStatus");
const quoteSharing = document.getElementById("quoteSharing");
const sharePdfButton = document.getElementById("sharePdf");
const shareStatus = document.getElementById("shareStatus");
const whatsappFallback = document.getElementById("whatsappFallback");
const openWhatsappButton = document.getElementById("openWhatsapp");
let preparedPdf = null;
let preparingPdf = null;
let sharingPdf = false;
let pdfExpiryTimer = null;
let pdfAccessExpired = false;
let registrationAttempt = null;
let registeredQuote = null;
let sendingQuote = false;
let registrationExpired = false;
let confirmedEmail = null;
let pendingEmail = null;

let products = [];
let productsReady = false;
let loadingProducts = false;


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

function formatCents(value) {
    const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return `$${(value / 100n).toLocaleString("es-MX")}${fraction ? `.${fraction}` : ""} MXN`;
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
    quantity.required = true;

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
    let subtotalCents = 0n;
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

        const lineCents = BigInt(Math.round(product.price * 100)) * BigInt(quantity);
        subtotalCents += lineCents;

        const line = document.createElement("li");
        line.append(
            createElement("span", "", `${quantity} × ${product.name}`),
            createElement("span", "", formatCents(lineCents))
        );
        lines.push(line);
    });

    if (lines.length === 0) {
        summaryList.replaceChildren(createElement("li", "summary-empty", "Aún no eliges productos."));
    } else {
        summaryList.replaceChildren(...lines);
    }

    // Se redondea a centavos para evitar decimales raros
    const ivaCents = (subtotalCents * BigInt(Math.round(IVA * 100)) + 50n) / 100n;

    summarySubtotal.textContent = formatCents(subtotalCents);
    summaryIva.textContent = formatCents(ivaCents);
    summaryTotal.textContent = formatCents(subtotalCents + ivaCents);

    // Contador y botones
    itemCount.textContent = `${items.length} producto${items.length !== 1 ? "s" : ""}`;
    addItemButton.disabled = !productsReady || items.length >= MAX_ITEMS;

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
    control.setAttribute("aria-invalid", String(!valid));
    const descriptions = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    if (valid) descriptions.delete("quoteError");
    else descriptions.add("quoteError");
    if (descriptions.size) control.setAttribute("aria-describedby", [...descriptions].join(" "));
    else control.removeAttribute("aria-describedby");
    return valid;
}

function suggestedEmailDomain(correo) {
    return correo.split("@")[1]?.toLowerCase() === "protonmai.com" ? "protonmail.com" : null;
}

function updateEmailHint() {
    const correo = quoteForm.elements.correo.value.trim();
    const suggestion = suggestedEmailDomain(correo);
    if (correo !== confirmedEmail) confirmedEmail = null;
    if (correo !== pendingEmail) {
        pendingEmail = null;
        document.getElementById("emailReview").hidden = true;
    }
    document.getElementById("correoHint").textContent = suggestion
        ? `¿Quisiste escribir ${suggestion}? Revisa la dirección completa. No la cambiaremos automáticamente.`
        : correo ? `Dirección indicada para el PDF: ${correo}. Comprueba que esté bien escrita.`
            : "Revisa tu dirección: el PDF se preparará para el correo que escribas.";
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
    const phone = form.telefono.value.trim();
    valid = check(form.telefono, phone.length <= 20 && /^\+?[\d ().-]+$/.test(phone) && phone.replace(/\D/g, "").length >= 7) && valid;
    const correo = form.correo.value.trim();
    form.correo.value = correo;
    const correoValido = correo === "" || (correo.length <= 150 && !/[\x00-\x20\x7f-\x9f]/.test(correo) && /^[^@]+@[^@]+\.[^@.]+$/.test(correo) && form.correo.checkValidity());
    valid = check(form.correo, correoValido) && valid;
    updateEmailHint();

    return valid;
}

async function sendQuote(event) {

    event.preventDefault();
    if (sendingQuote || registeredQuote || registrationExpired) return;

    quoteError.hidden = true;

    const items = readItems();
    if (!productsReady || items.length === 0) {
        showError("Espera a que haya productos disponibles para cotizar.");
        return;
    }

    if (!validate(items)) {
        showError(quoteForm.elements.correo.classList.contains("invalid")
            ? "Revisa correo electrónico: usa una dirección completa válida, por ejemplo nombre@ejemplo.com, sin espacios internos ni varios destinatarios. Revisa también los demás campos marcados en rojo."
            : "Revisa los campos marcados en rojo: elige cada producto y su cantidad, escribe tu nombre, apellido y teléfono.");
        quoteForm.querySelector(".invalid")?.focus();
        return;
    }

    const form = quoteForm.elements;

    const data = {
        ...(form.sitioWeb?.value ? { sitioWeb: form.sitioWeb.value } : {}),
        cliente: {
            nombre: form.nombre.value.trim(),
            apellido: form.apellido.value.trim(),
            telefono: form.telefono.value.trim(),
            correo: optional(form.correo.value),
            direccion: optional(form.direccion.value)
        },
        whatsappConsentimiento: false,
        descripcion: optional(form.descripcion.value),
        productos: items.map(item => ({
            idProducto: item.product.id,
            cantidad: item.quantity,
            medidasAprox: optional(item.measures),
            notas: optional(item.notes)
        }))
    };

    const correo = form.correo.value.trim();
    const suggestion = suggestedEmailDomain(correo);
    if (suggestion && confirmedEmail !== correo) {
        pendingEmail = correo;
        document.getElementById("emailReviewMessage").textContent = `Escribiste ${correo}. ¿Quisiste utilizar ${suggestion}? Corrige la dirección o confirma que deseas usar exactamente la que escribiste.`;
        document.getElementById("emailReview").hidden = false;
        document.getElementById("correctEmail").focus();
        return;
    }

    const serializedData = JSON.stringify(data);
    if (!registrationAttempt || registrationAttempt.data !== serializedData) {
        registrationAttempt = { key: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""), data: serializedData };
    }
    sendingQuote = true;
    submitButton.disabled = true;
    submitButton.textContent = "Enviando...";
    document.getElementById("quoteProgress").textContent = "Estamos registrando tu solicitud. Espera en esta página; no necesitas volver a pulsar el botón.";
    quoteForm.setAttribute("aria-busy", "true");
    let requestTimeout;

    try {

        try {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializedData));
            const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
            const previous = JSON.parse(sessionStorage.getItem("gaona-solicitud-intento-v1") || "null");
            if (previous?.fingerprint === fingerprint && /^[\w-]{16,80}$/.test(previous.key)) registrationAttempt.key = previous.key;
            sessionStorage.setItem("gaona-solicitud-intento-v1", JSON.stringify({ key: registrationAttempt.key, fingerprint }));
        } catch {}
        const controller = new AbortController();
        requestTimeout = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(`${API_URL}/solicitudes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": registrationAttempt.key, Prefer: "respond-async" },
            body: serializedData,
            signal: controller.signal
        });

        const result = await response.json().catch(() => ({}));

        if (response.status === 403 && result.codigo === "CORREO_NO_AUTORIZADO") {
            check(form.correo, false);
            showError("Este correo no está autorizado para el ensayo SMTP local. La solicitud no se registró. Usa una dirección autorizada o el modo de simulación.");
            submitButton.disabled = false;
            submitButton.textContent = "Enviar solicitud";
            return;
        }

        if (response.status === 400) {
            const legacyCodes = {
                "Datos incompletos o inválidos": "DATOS_INVALIDOS",
                "Algún producto ya no está disponible": "PRODUCTO_NO_DISPONIBLE",
                "Identificador de envío inválido o ya utilizado con otros datos.": "CLAVE_INVALIDA"
            };
            const code = result.codigo || legacyCodes[result.error];
            if (code === "DATOS_INVALIDOS") {
                const fields = {
                    "cliente.nombre": [form.nombre, "nombre"],
                    "cliente.apellido": [form.apellido, "apellido"],
                    "cliente.telefono": [form.telefono, "teléfono"],
                    "cliente.correo": [form.correo, "correo electrónico (incluye un dominio completo, por ejemplo ejemplo.com)"],
                    "cliente.direccion": [form.direccion, "dirección"],
                    descripcion: [form.descripcion, "comentarios"]
                };
                const labels = [];
                for (const path of Array.isArray(result.campos) ? result.campos : []) {
                    if (Object.hasOwn(fields, path)) {
                        check(fields[path][0], false);
                        labels.push(fields[path][1]);
                    } else if (typeof path === "string" && /^(productos)(\.|$)/.test(path)) {
                        labels.push("productos, cantidades, medidas y notas");
                    }
                }
                showError(`Revisa ${[...new Set(labels)].join(", ") || "los datos del formulario"}. El envío fue rechazado antes de intentar registrarlo.`);
                quoteForm.querySelector(".invalid")?.focus();
            } else if (code === "PRODUCTO_NO_DISPONIBLE") {
                showError("Algún producto seleccionado ya no está disponible. Este envío fue rechazado antes de intentar registrarlo. Revisa tu selección en el catálogo vigente.");
            } else if (code === "CLAVE_INVALIDA") {
                showError("El identificador de este intento no es válido. Este envío fue rechazado antes de intentar registrarlo. Conserva esta página y consulta con GAONA antes de iniciar otro intento.");
            } else {
                showError("El servidor rechazó el envío y no pudimos confirmar si la solicitud quedó registrada. Conserva esta página y consulta con GAONA antes de reenviar o actualizarla.");
            }
            submitButton.disabled = false;
            submitButton.textContent = "Enviar solicitud";
            return;
        }
        if (response.status === 410) {
            registrationExpired = true;
            const folio = typeof result.id === "string" ? ` Folio: ${result.id}.` : "";
            if (typeof result.id === "string") {
                try { sessionStorage.setItem("gaona-solicitud-confirmada-v1", JSON.stringify({ id: result.id })); } catch {}
            }
            showError(`Tu solicitud sigue registrada.${folio} Su comprobante ya no está disponible; no vuelvas a enviarla. Consulta con GAONA y conserva tu folio.`);
            submitButton.disabled = true;
            submitButton.textContent = "Solicitud ya registrada";
            return;
        }
        if (response.status === 429 || response.status === 409) {
            showError(response.status === 429 ? "Alcanzaste el límite temporal de solicitudes. Intenta más tarde." : "No se pudo confirmar este intento con los datos actuales. No vuelvas a registrar una solicitud ya confirmada.");
            submitButton.disabled = false;
            submitButton.textContent = "Enviar solicitud";
            return;
        }
        if (!response.ok || typeof result.id !== "string" || !result.id) {
            throw new Error("Respuesta de solicitud inválida");
        }

        registeredQuote = result;
        try { sessionStorage.setItem("gaona-solicitud-confirmada-v1", JSON.stringify({ id: result.id })); } catch {}
        document.getElementById("quoteRecipient").textContent = data.cliente.correo ? `Correo indicado: ${data.cliente.correo}` : "";
        document.getElementById("quoteRecipient").hidden = !data.cliente.correo;
        document.getElementById("previousQuote").hidden = true;
        showMailStatus(result.correo?.estado);
        if (result.pdf?.token) {
            downloadPdfButton.hidden = false;
            initializeSharing();
            pdfStatus.textContent = "PDF listo para descargar.";
            document.getElementById("pdfAvailability").hidden = false;
        } else {
            pdfStatus.textContent = "El PDF no está disponible. Conserva tu folio; no vuelvas a enviar la solicitud.";
        }

        // Muestra el mensaje de éxito en lugar del formulario
        quoteFolio.textContent = `Folio: ${result.id}`;
        quoteForm.hidden = true;
        quoteSuccess.hidden = false;
        document.getElementById("quoteSuccessTitle").focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
        if (result.correo?.estado === "pendiente") void followMailStatus();

    } catch (error) {

        console.error("COTIZACION_SIN_CONFIRMACION: no se recibió una confirmación válida.");

        showError("No pudimos confirmar si la solicitud quedó registrada. No se reenviará automáticamente. Conserva esta página; si reintentas con los mismos datos usaremos el mismo identificador para evitar duplicados.");

        submitButton.disabled = false;
        submitButton.textContent = "Enviar solicitud";
    } finally {
        clearTimeout(requestTimeout);
        sendingQuote = false;
        quoteForm.setAttribute("aria-busy", "false");
        document.getElementById("quoteProgress").textContent = "";
    }
}

function showMailStatus(estado, modo = registeredQuote?.correo?.modo) {
    const mailMessages = {
        simulado: "Simulación local completada: correo y PDF preparados. No se envió ningún mensaje externo.",
        pendiente: "El correo con tu PDF está en proceso. No vuelvas a enviar la solicitud.",
        aceptado: "El servicio de correo aceptó el mensaje con tu PDF. La entrega final todavía no está confirmada.",
        sin_correo: "No proporcionaste correo electrónico.",
        no_disponible: "El envío por correo no está disponible.",
        limitado: "El correo no se envió por el límite temporal de envíos.",
        error_pdf: "No pudimos generar el adjunto del correo; puedes reintentar la descarga del PDF.",
        error: "No pudimos enviar el correo.",
        no_confirmado: "No pudimos confirmar el envío del correo. No se reenviará automáticamente."
    };
    mailStatus.textContent = mailMessages[estado] || "No hay confirmación de envío por correo. No se reenviará automáticamente.";
    if (modo === "simulado" && estado !== "simulado") {
        mailStatus.textContent = "Modo de simulación local: no se enviará ningún mensaje externo. " + mailStatus.textContent;
    }
    if (modo === "smtp" && ["aceptado", "error", "no_confirmado"].includes(estado)) {
        mailStatus.textContent = "Modo SMTP real de ensayo. " + mailStatus.textContent;
    }
}

async function followMailStatus() {
    for (let intento = 0; intento < 20; intento++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (!registeredQuote?.pdf?.token || Date.now() >= Date.parse(registeredQuote.pdf.expiraEn)) break;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(`${API_URL}/solicitudes/correo/estado`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: registeredQuote.pdf.token }),
                signal: controller.signal, cache: "no-store"
            });
            if (!response.ok) break;
            const result = await response.json();
            showMailStatus(result.estado, result.modo);
            if (result.estado !== "pendiente") return;
        } catch {
            break;
        } finally {
            clearTimeout(timeout);
        }
    }
    showMailStatus("no_confirmado");
}


function expirePdfAccess() {
    document.getElementById("pdfAvailability").hidden = true;
    pdfAccessExpired = true;
    preparedPdf = null;
    downloadPdfButton.hidden = true;
    sharePdfButton.hidden = true;
    whatsappFallback.hidden = true;
    if (pdfExpiryTimer) clearTimeout(pdfExpiryTimer);
    pdfStatus.textContent = "El acceso al PDF ha caducado o ya no está disponible. Tu solicitud sigue registrada; conserva tu folio. No vuelvas a enviarla.";
    shareStatus.textContent = "El acceso para preparar o compartir el PDF ya no está disponible. Si ya lo descargaste, puedes adjuntar tu copia manualmente.";
}

function validPdfAccess() {
    const expires = Date.parse(registeredQuote?.pdf?.expiraEn);
    if (pdfAccessExpired || !registeredQuote?.pdf?.token || !Number.isFinite(expires) || Date.now() >= expires) {
        expirePdfAccess();
        return false;
    }
    return true;
}

function nativeFileSharing() {
    return window.isSecureContext && typeof navigator.share === "function" && typeof navigator.canShare === "function";
}

function canSharePdf(file) {
    try {
        return nativeFileSharing() && navigator.canShare({ files: [file] });
    } catch {
        return false;
    }
}

function manualSharing(message, hideNative = false) {
    whatsappFallback.hidden = false;
    sharePdfButton.hidden = hideNative;
    shareStatus.textContent = message;
}

function initializeSharing() {
    document.getElementById("manualSharingOptions").hidden = false;
    quoteSharing.hidden = false;
    if (!validPdfAccess()) return;
    if (nativeFileSharing()) {
        shareStatus.textContent = "Prepara el PDF y pulsa de nuevo para abrir el selector de aplicaciones. Elige WhatsApp si está disponible; tú eliges el destinatario.";
    } else {
        manualSharing("Este navegador no permite compartir archivos directamente. Descarga el PDF y adjúntalo manualmente en WhatsApp.", true);
    }
    pdfExpiryTimer = setTimeout(expirePdfAccess, Math.min(Date.parse(registeredQuote.pdf.expiraEn) - Date.now(), 30 * 60 * 1000));
}

async function getPdfFile() {
    if (!validPdfAccess()) throw new Error("Acceso caducado");
    if (preparedPdf) return preparedPdf;
    if (preparingPdf) return preparingPdf;
    preparingPdf = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`${API_URL}/solicitudes/pdf`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: registeredQuote.pdf.token }),
                signal: controller.signal,
                cache: "no-store"
            });
            if (response.status === 403 || response.status === 410) {
                expirePdfAccess();
                throw new Error("Acceso caducado");
            }
            if (!response.ok || !response.headers.get("Content-Type")?.includes("application/pdf")) throw new Error("PDF no disponible");
            const blob = await response.blob();
            if (blob.size > 2 * 1024 * 1024 || (await blob.slice(0, 5).text()) !== "%PDF-") throw new Error("PDF inválido");
            if (!validPdfAccess()) throw new Error("Acceso caducado");
            preparedPdf = new File([blob], `GAONA-Solicitud-${registeredQuote.id.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`, { type: "application/pdf" });
            return preparedPdf;
        } finally {
            clearTimeout(timeout);
        }
    })();
    try {
        return await preparingPdf;
    } finally {
        preparingPdf = null;
    }
}

async function downloadPdf() {
    if (!registeredQuote?.pdf?.token || downloadPdfButton.disabled || !validPdfAccess()) return;
    downloadPdfButton.disabled = true;
    pdfStatus.textContent = "Generando PDF...";
    try {
        const file = await getPdfFile();
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        pdfStatus.textContent = "PDF descargado. Los importes son estimados y están sujetos a confirmación por GAONA.";
    } catch {
        if (!downloadPdfButton.hidden) pdfStatus.textContent = "Tu solicitud sigue registrada, pero no pudimos descargar el PDF. Reintenta con este botón; no es necesario reenviar la solicitud.";
    } finally {
        downloadPdfButton.disabled = false;
    }
}

async function sharePdf() {
    if (sharingPdf || sharePdfButton.disabled || !validPdfAccess()) return;
    if (!nativeFileSharing()) {
        manualSharing("Este navegador no permite compartir archivos directamente. Descarga el PDF y adjúntalo manualmente en WhatsApp.", true);
        return;
    }
    if (!preparedPdf) {
        sharePdfButton.disabled = true;
        shareStatus.textContent = "Preparando PDF para compartir...";
        try {
            const file = await getPdfFile();
            if (!canSharePdf(file)) {
                manualSharing("Este dispositivo no permite compartir este PDF directamente. Descárgalo y adjúntalo manualmente en WhatsApp.", true);
                return;
            }
            sharePdfButton.textContent = "Compartir PDF ahora";
            shareStatus.textContent = "PDF listo. Pulsa Compartir PDF ahora y elige WhatsApp si aparece en el selector. El documento no se ha enviado.";
        } catch {
            if (!sharePdfButton.hidden) shareStatus.textContent = "No pudimos preparar el PDF. Tu solicitud sigue registrada. Reintenta con este botón o descarga el archivo; no vuelvas a enviar la solicitud.";
        } finally {
            sharePdfButton.disabled = false;
        }
        return;
    }
    sharingPdf = true;
    sharePdfButton.disabled = true;
    try {
        if (!canSharePdf(preparedPdf)) {
            manualSharing("Este dispositivo no permite compartir este PDF directamente. Descárgalo y adjúntalo manualmente en WhatsApp.", true);
            return;
        }
        await navigator.share({
            files: [preparedPdf],
            title: "GAONA | Solicitud de cotización",
            text: `GAONA | Solicitud de cotización. Folio: ${registeredQuote.id}. Comparto el PDF con el resumen y los importes estimados.`
        });
        shareStatus.textContent = "Se abrió la interfaz de compartir. La entrega del documento por WhatsApp no está confirmada.";
    } catch (error) {
        if (error?.name === "AbortError") {
            whatsappFallback.hidden = false;
            shareStatus.textContent = "Se canceló la acción de compartir. Tu solicitud sigue registrada; puedes intentarlo de nuevo.";
        } else {
            manualSharing("El navegador no permitió compartir el PDF. Puedes descargarlo y adjuntarlo manualmente en WhatsApp.");
        }
    } finally {
        sharingPdf = false;
        sharePdfButton.disabled = false;
    }
}

function openWhatsapp() {
    if (!registeredQuote || !validPdfAccess()) return;
    const message = `GAONA | Solicitud de cotización. Folio: ${registeredQuote.id}. Compartiré el PDF con el resumen y los importes estimados.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    shareStatus.textContent = "Se solicitó abrir WhatsApp con el mensaje preparado. Elige la conversación y adjunta el PDF descargado manualmente. No se ha confirmado ningún envío.";
}

downloadPdfButton.addEventListener("click", downloadPdf);
sharePdfButton.addEventListener("click", sharePdf);
openWhatsappButton.addEventListener("click", openWhatsapp);


// -----------------------------------------
// CARGAR PRODUCTOS DESDE LA API
// -----------------------------------------

async function loadProducts() {
    if (loadingProducts) return;
    loadingProducts = true;
    productsReady = false;
    submitButton.disabled = true;
    addItemButton.disabled = true;
    quoteError.hidden = true;
    quoteItems.replaceChildren(createElement("p", "products-message", "Cargando productos..."));
    try {
        products = await CatalogProducts.load();
        quoteItems.replaceChildren();
        if (products.length === 0) {
            quoteItems.appendChild(createElement("p", "products-message", "Por el momento no hay productos disponibles para cotizar."));
            return;
        }
        productsReady = true;
        const selectedId = new URLSearchParams(window.location.search).get("producto");
        addItem(selectedId);
        if (selectedId !== null && !findProduct(selectedId)) {
            showError("El producto seleccionado no existe o ya no está disponible. Elige otro producto del catálogo.");
        }
        submitButton.disabled = false;
    } catch {
        const message = createElement("p", "products-message", "No pudimos cargar los productos. Revisa tu conexión e intenta de nuevo.");
        const retry = createElement("button", "btn btn-primary", "Reintentar");
        retry.type = "button";
        retry.addEventListener("click", loadProducts);
        quoteItems.replaceChildren(message, retry);
    } finally {
        loadingProducts = false;
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
    event.target.removeAttribute("aria-invalid");
    const descriptions = (event.target.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== "quoteError");
    if (descriptions.length) event.target.setAttribute("aria-describedby", descriptions.join(" "));
    else event.target.removeAttribute("aria-describedby");
}

quoteForm.addEventListener("input", clearInvalid);
quoteForm.addEventListener("change", clearInvalid);

addItemButton.addEventListener("click", () => {
    if (productsReady && readItems().length < MAX_ITEMS) addItem();
});

quoteForm.addEventListener("submit", sendQuote);
quoteForm.elements.correo.addEventListener("input", updateEmailHint);
quoteForm.elements.correo.addEventListener("blur", () => {
    quoteForm.elements.correo.value = quoteForm.elements.correo.value.trim();
    updateEmailHint();
});

document.getElementById("correctEmail").addEventListener("click", () => {
    document.getElementById("emailReview").hidden = true;
    pendingEmail = null;
    confirmedEmail = null;
    quoteForm.elements.correo.focus();
    quoteForm.elements.correo.select();
});
document.getElementById("confirmEmail").addEventListener("click", () => {
    if (!pendingEmail || pendingEmail !== quoteForm.elements.correo.value.trim() || sendingQuote || registeredQuote) return;
    confirmedEmail = pendingEmail;
    document.getElementById("emailReview").hidden = true;
    quoteForm.requestSubmit();
});

try {
    const previous = JSON.parse(sessionStorage.getItem("gaona-solicitud-confirmada-v1") || "null");
    if (typeof previous?.id === "string" && /^[a-z\d-]{1,80}$/i.test(previous.id)) {
        const notice = document.getElementById("previousQuote");
        notice.textContent = `Última solicitud registrada en esta pestaña. Folio: ${previous.id}. Recargar la página no envía correos. Conserva tu PDF y no vuelvas a registrar esta solicitud para consultar su estado.`;
        notice.hidden = false;
    }
} catch {}

loadProducts();
