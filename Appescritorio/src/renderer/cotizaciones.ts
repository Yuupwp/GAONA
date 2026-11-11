// ========================================
// Módulo de cotizaciones (app de escritorio)
// DISEÑO CON DATOS DE EJEMPLO: aún no se conecta a la API.
// Cuando existan las rutas, solo hay que cambiar
// COTIZACIONES y CLIENTES por llamadas a la API.
// ========================================
(() => {
    // OJO: ajusta estos valores a los de tu enum EstadoCotizacion
    type Estado = "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA";
    type Filtro = "todos" | Estado;

    interface Concepto {
        nombre: string;
        cantidad: number;
        precio: number;
    }

    interface Cotizacion {
        id: string;
        folio: string;
        cliente: string;
        telefono: string;
        estado: Estado;
        conceptos: Concepto[];
        anticipoRequerido: number | null;
        vigenciaHasta: string | null;
        creadoEn: string;
        pdfUrl: string | null;
    }

    const IVA = 0.16;

    const ESTADOS: Record<Estado, { texto: string; clase: string }> = {
        BORRADOR: { texto: "Borrador", clase: "cl-badge-gray" },
        ENVIADA: { texto: "Enviada", clase: "" },
        APROBADA: { texto: "Aprobada", clase: "cl-badge-green" },
        RECHAZADA: { texto: "Rechazada", clase: "cl-badge-red" },
        VENCIDA: { texto: "Vencida", clase: "cl-badge-gray" },
    };

    // ---------- DATOS DE EJEMPLO (borrar al conectar la API) ----------
    const CLIENTES = [
        { nombre: "Roberto Garza Treviño", telefono: "81 5550 0101" },
        { nombre: "María Fernanda López", telefono: "81 5550 0102" },
        { nombre: "Carlos Treviño Salinas", telefono: "81 5550 0103" },
        { nombre: "Ana Sofía Martínez", telefono: "81 5550 0104" },
        { nombre: "Jorge Ramírez Cantú", telefono: "81 5550 0105" },
    ];

    const COTIZACIONES: Cotizacion[] = [
        {
            id: "c1", folio: "0001", cliente: "Roberto Garza Treviño", telefono: "81 5550 0101",
            estado: "APROBADA", anticipoRequerido: 9250, vigenciaHasta: "2026-11-30", creadoEn: "2026-10-01", pdfUrl: "#",
            conceptos: [
                { nombre: "Cocina integral 3 m", cantidad: 1, precio: 14200 },
                { nombre: "Instalación", cantidad: 1, precio: 1660.34 },
            ],
        },
        {
            id: "c2", folio: "0002", cliente: "María Fernanda López", telefono: "81 5550 0102",
            estado: "ENVIADA", anticipoRequerido: 18000, vigenciaHasta: "2026-11-20", creadoEn: "2026-10-20", pdfUrl: "#",
            conceptos: [
                { nombre: "Clóset empotrado", cantidad: 2, precio: 15500 },
                { nombre: "Puertas corredizas", cantidad: 2, precio: 3200 },
            ],
        },
        {
            id: "c3", folio: "0003", cliente: "Carlos Treviño Salinas", telefono: "81 5550 0103",
            estado: "ENVIADA", anticipoRequerido: null, vigenciaHasta: "2026-11-15", creadoEn: "2026-10-27", pdfUrl: "#",
            conceptos: [{ nombre: "Mesa de comedor 8 personas", cantidad: 1, precio: 11000 }],
        },
        {
            id: "c4", folio: "0004", cliente: "Ana Sofía Martínez", telefono: "81 5550 0104",
            estado: "BORRADOR", anticipoRequerido: null, vigenciaHasta: null, creadoEn: "2026-11-03", pdfUrl: null,
            conceptos: [
                { nombre: "Baño: gabinete y espejo", cantidad: 1, precio: 6800 },
                { nombre: "Cubierta de cuarzo", cantidad: 1, precio: 5200 },
            ],
        },
        {
            id: "c5", folio: "0005", cliente: "Jorge Ramírez Cantú", telefono: "81 5550 0105",
            estado: "RECHAZADA", anticipoRequerido: 5000, vigenciaHasta: "2026-10-25", creadoEn: "2026-10-10", pdfUrl: "#",
            conceptos: [{ nombre: "Librero a la medida", cantidad: 1, precio: 9900 }],
        },
        {
            id: "c6", folio: "0006", cliente: "María Fernanda López", telefono: "81 5550 0102",
            estado: "VENCIDA", anticipoRequerido: null, vigenciaHasta: "2026-10-15", creadoEn: "2026-09-28", pdfUrl: "#",
            conceptos: [{ nombre: "Recámara completa", cantidad: 1, precio: 28000 }],
        },
    ];

    // Estado del módulo
    const estado = {
        filtro: "todos" as Filtro,
        busqueda: "",
        pagina: 1,
        limite: 8,
    };

    // Elementos de la pantalla
    function el<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    const buscador = el<HTMLInputElement>("cot-buscar");
    const chips = el<HTMLDivElement>("cot-chips").querySelectorAll<HTMLButtonElement>(".cot-chip");
    const filas = el<HTMLDivElement>("cot-filas");
    const contador = el<HTMLSpanElement>("cot-contador");
    const paginacion = el<HTMLDivElement>("cot-paginacion");

    const modal = el<HTMLDivElement>("cot-modal");
    const form = el<HTMLFormElement>("cot-form");
    const formError = el<HTMLDivElement>("cot-form-error");
    const contLineas = el<HTMLDivElement>("cot-lineas");

    const campos = {
        cliente: el<HTMLSelectElement>("cot-f-cliente"),
        vigencia: el<HTMLInputElement>("cot-f-vigencia"),
        anticipo: el<HTMLInputElement>("cot-f-anticipo"),
    };

    const errores = {
        cliente: el<HTMLSpanElement>("cot-e-cliente"),
        vigencia: el<HTMLSpanElement>("cot-e-vigencia"),
        anticipo: el<HTMLSpanElement>("cot-e-anticipo"),
        lineas: el<HTMLSpanElement>("cot-e-lineas"),
    };

    const modalDetalle = el<HTMLDivElement>("cot-detalle");
    const detalleContenido = el<HTMLDivElement>("cot-detalle-contenido");
    const toast = el<HTMLDivElement>("cot-toast");

    // Utilidades
    function esc(texto: string | null | undefined): string {
        return (texto ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const formatoMoneda = new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
    });

    function dinero(valor: number): string {
        return formatoMoneda.format(valor);
    }

    function fecha(valor: string | null): string {
        if (!valor) return "—";

        return new Date(`${valor}T00:00:00`).toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    function iniciales(nombreCompleto: string): string {
        const partes = nombreCompleto.trim().split(/\s+/);
        return ((partes[0]?.charAt(0) ?? "") + (partes[1]?.charAt(0) ?? "")).toUpperCase();
    }

    function redondear(valor: number): number {
        return Math.round(valor * 100) / 100;
    }

    function hoy(): string {
        const ahora = new Date();
        const mes = String(ahora.getMonth() + 1).padStart(2, "0");
        const dia = String(ahora.getDate()).padStart(2, "0");
        return `${ahora.getFullYear()}-${mes}-${dia}`;
    }

    // Subtotal, IVA y total de una lista de conceptos
    function calcular(conceptos: Concepto[]): { subtotal: number; iva: number; total: number } {
        const subtotal = redondear(conceptos.reduce((s, c) => s + c.cantidad * c.precio, 0));
        const iva = redondear(subtotal * IVA);
        return { subtotal, iva, total: redondear(subtotal + iva) };
    }

    let temporizadorAviso: number | undefined;

    function avisar(mensaje: string, esError = false): void {
        toast.textContent = mensaje;
        toast.classList.toggle("error", esError);
        toast.classList.remove("hidden");

        window.clearTimeout(temporizadorAviso);
        temporizadorAviso = window.setTimeout(() => {
            toast.classList.add("hidden");
        }, 4500);
    }

    // Resumen (tarjetas de arriba)
    function pintarResumen(): void {
        const pendientes = COTIZACIONES.filter((c) => c.estado === "ENVIADA");
        const monto = pendientes.reduce((s, c) => s + calcular(c.conceptos).total, 0);

        el("cot-stat-total").textContent = String(COTIZACIONES.length);
        el("cot-stat-pendientes").textContent = String(pendientes.length);
        el("cot-stat-aprobadas").textContent = String(
            COTIZACIONES.filter((c) => c.estado === "APROBADA").length
        );
        el("cot-stat-monto").textContent = dinero(monto);
    }

    // Lista
    function filtrar(): Cotizacion[] {
        const texto = estado.busqueda.toLowerCase();

        return COTIZACIONES.filter((c) => {
            const coincideEstado = estado.filtro === "todos" || c.estado === estado.filtro;
            const coincideTexto =
                texto === "" ||
                c.cliente.toLowerCase().includes(texto) ||
                c.folio.includes(texto);

            return coincideEstado && coincideTexto;
        });
    }

    function pintarLista(): void {
        const resultado = filtrar();
        const totalPaginas = Math.max(1, Math.ceil(resultado.length / estado.limite));
        estado.pagina = Math.min(estado.pagina, totalPaginas);

        if (resultado.length === 0) {
            const hayFiltros = estado.busqueda !== "" || estado.filtro !== "todos";

            filas.innerHTML = `<div class="cl-vacio">${
                hayFiltros
                    ? "No se encontraron cotizaciones con esos criterios."
                    : "Aún no hay cotizaciones. Crea la primera con el botón “Nueva cotización”."
            }</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
            return;
        }

        const inicio = (estado.pagina - 1) * estado.limite;
        const visibles = resultado.slice(inicio, inicio + estado.limite);

        filas.innerHTML = visibles
            .map((c) => {
                const info = ESTADOS[c.estado];
                const { total } = calcular(c.conceptos);

                return `
                <div class="cot-row">
                    <span class="cot-folio">#${esc(c.folio)}</span>

                    <div class="cot-cliente">
                        <div class="cl-avatar">${esc(iniciales(c.cliente))}</div>
                        <div>
                            <strong class="cot-nombre">${esc(c.cliente)}</strong>
                            <span class="cot-sub">${esc(c.telefono)}</span>
                        </div>
                    </div>

                    <div><span class="cl-badge ${info.clase}">${esc(info.texto)}</span></div>

                    <span class="cot-monto">${dinero(total)}</span>

                    <span>${c.anticipoRequerido !== null ? dinero(c.anticipoRequerido) : "—"}</span>

                    <span>${fecha(c.vigenciaHasta)}</span>

                    <div class="cot-acciones">
                        <button type="button" class="cl-link" data-accion="detalle" data-id="${esc(c.id)}">Ver detalle</button>
                        ${
                            c.estado === "APROBADA"
                                ? `<button type="button" class="cl-link" data-accion="convertir" data-id="${esc(c.id)}">Crear pedido</button>`
                                : ""
                        }
                    </div>
                </div>`;
            })
            .join("");

        contador.textContent =
            resultado.length === 1 ? "1 cotización" : `${resultado.length} cotizaciones`;

        pintarPaginacion(totalPaginas);
    }

    function pintarPaginacion(totalPaginas: number): void {
        if (totalPaginas <= 1) {
            paginacion.innerHTML = "";
            return;
        }

        let botones = `<button class="cot-page" type="button" data-pagina="${estado.pagina - 1}" ${
            estado.pagina <= 1 ? "disabled" : ""
        } aria-label="Anterior">‹</button>`;

        for (let n = 1; n <= totalPaginas; n++) {
            botones += `<button class="cot-page${
                n === estado.pagina ? " active" : ""
            }" type="button" data-pagina="${n}">${n}</button>`;
        }

        botones += `<button class="cot-page" type="button" data-pagina="${estado.pagina + 1}" ${
            estado.pagina >= totalPaginas ? "disabled" : ""
        } aria-label="Siguiente">›</button>`;

        paginacion.innerHTML = botones;
    }

    function recargar(): void {
        pintarResumen();
        pintarLista();
    }

    // Detalle de una cotización
    function abrirDetalle(id: string): void {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c) return;

        const info = ESTADOS[c.estado];
        const { subtotal, iva, total } = calcular(c.conceptos);

        const conceptos = c.conceptos
            .map(
                (k) => `
                <div class="cot-concepto">
                    <div>
                        <strong>${esc(k.nombre)}</strong>
                        <span class="cot-sub">${k.cantidad} × ${dinero(k.precio)}</span>
                    </div>
                    <strong class="cot-monto">${dinero(k.cantidad * k.precio)}</strong>
                </div>`
            )
            .join("");

        // Acciones según el estado
        let acciones = "";

        if (c.estado === "BORRADOR") {
            acciones = `<button class="cl-btn cl-btn-primary" type="button" data-accion="cambiar" data-nuevo="ENVIADA" data-id="${esc(c.id)}">Marcar como enviada</button>`;
        } else if (c.estado === "ENVIADA") {
            acciones = `
                <button class="cl-btn cl-btn-danger" type="button" data-accion="cambiar" data-nuevo="RECHAZADA" data-id="${esc(c.id)}">Rechazar</button>
                <button class="cl-btn cl-btn-primary" type="button" data-accion="cambiar" data-nuevo="APROBADA" data-id="${esc(c.id)}">Aprobar</button>`;
        } else if (c.estado === "APROBADA") {
            acciones = `<button class="cl-btn cl-btn-primary" type="button" data-accion="convertir" data-id="${esc(c.id)}">Crear pedido</button>`;
        }

        detalleContenido.innerHTML = `
            <div class="cl-modal-head">
                <div>
                    <h3>Cotización #${esc(c.folio)}</h3>
                    <span class="cot-subtitulo">${esc(c.cliente)} · ${esc(c.telefono)}</span>
                </div>
                <button class="cl-close" type="button" data-accion="cerrar" aria-label="Cerrar">×</button>
            </div>

            <div class="cot-detalle-datos">
                <div><span>Estado</span><span class="cl-badge ${info.clase}">${esc(info.texto)}</span></div>
                <div><span>Creada</span><strong>${fecha(c.creadoEn)}</strong></div>
                <div><span>Vigencia</span><strong>${fecha(c.vigenciaHasta)}</strong></div>
                <div><span>Anticipo requerido</span><strong>${c.anticipoRequerido !== null ? dinero(c.anticipoRequerido) : "No se requiere"}</strong></div>
            </div>

            <h4 class="cot-detalle-titulo">Conceptos</h4>
            <div class="cot-conceptos">${conceptos}</div>

            <div class="cot-totales">
                <div><span>Subtotal</span><span>${dinero(subtotal)}</span></div>
                <div><span>IVA (16%)</span><span>${dinero(iva)}</span></div>
                <div class="cot-total-final"><span>Total</span><span>${dinero(total)}</span></div>
            </div>

            <div class="cl-modal-actions">
                <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar">Cerrar</button>
                ${
                    c.pdfUrl
                        ? `<button class="cl-btn cl-btn-outline" type="button" data-accion="pdf" data-id="${esc(c.id)}">Ver PDF</button>`
                        : ""
                }
                ${acciones}
            </div>`;

        modalDetalle.classList.remove("hidden");
    }

    function cambiarEstado(id: string, nuevo: Estado): void {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c) return;

        c.estado = nuevo;
        modalDetalle.classList.add("hidden");
        avisar(`Cotización #${c.folio} marcada como "${ESTADOS[nuevo].texto.toLowerCase()}".`);
        recargar();
    }

    function convertirEnPedido(id: string): void {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c) return;

        modalDetalle.classList.add("hidden");
        // Aquí irá la llamada a la API: POST /cotizaciones/:id/convertir
        avisar(`Se creará el pedido de la cotización #${c.folio} cuando se conecte la API.`);
    }

    // Formulario: nueva cotización
    function lineaHtml(): string {
        return `
            <div class="cot-linea">
                <input type="text" class="cot-l-nombre" placeholder="Producto o servicio" maxlength="120" autocomplete="off">
                <input type="number" class="cot-l-cantidad" min="1" step="1" value="1">
                <input type="number" class="cot-l-precio" min="0" step="0.01" placeholder="0.00">
                <button type="button" class="cot-quitar" data-accion="quitar" aria-label="Quitar concepto">×</button>
            </div>`;
    }

    function leerConceptos(): Concepto[] {
        const lineas = contLineas.querySelectorAll<HTMLDivElement>(".cot-linea");
        const conceptos: Concepto[] = [];

        lineas.forEach((linea) => {
            const nombre = linea.querySelector<HTMLInputElement>(".cot-l-nombre")?.value.trim() ?? "";
            const cantidad = Number(linea.querySelector<HTMLInputElement>(".cot-l-cantidad")?.value);
            const precio = Number(linea.querySelector<HTMLInputElement>(".cot-l-precio")?.value);

            if (nombre !== "" && cantidad > 0 && precio > 0) {
                conceptos.push({ nombre, cantidad, precio });
            }
        });

        return conceptos;
    }

    function actualizarTotales(): void {
        const { subtotal, iva, total } = calcular(leerConceptos());

        el("cot-t-subtotal").textContent = dinero(subtotal);
        el("cot-t-iva").textContent = dinero(iva);
        el("cot-t-total").textContent = dinero(total);
    }

    function limpiarErrores(): void {
        Object.values(errores).forEach((e) => {
            e.textContent = "";
            e.parentElement?.classList.remove("has-error");
        });
        formError.classList.add("hidden");
        formError.textContent = "";
    }

    function mostrarError(campo: keyof typeof errores, mensaje: string): void {
        errores[campo].textContent = mensaje;
        errores[campo].parentElement?.classList.add("has-error");
    }

    function abrirFormulario(): void {
        form.reset();
        limpiarErrores();

        campos.cliente.innerHTML =
            '<option value="">Selecciona un cliente</option>' +
            CLIENTES.map((c, i) => `<option value="${i}">${esc(c.nombre)}</option>`).join("");

        campos.vigencia.min = hoy();
        contLineas.innerHTML = lineaHtml();
        actualizarTotales();

        modal.classList.remove("hidden");
        campos.cliente.focus();
    }

    function cerrarFormulario(): void {
        modal.classList.add("hidden");
    }

    function guardarCotizacion(): void {
        limpiarErrores();
        let ok = true;

        const cliente = CLIENTES[Number(campos.cliente.value)];
        const conceptos = leerConceptos();
        const { total } = calcular(conceptos);
        const anticipo =
            campos.anticipo.value.trim() === "" ? null : redondear(Number(campos.anticipo.value));

        if (campos.cliente.value === "" || !cliente) {
            mostrarError("cliente", "Selecciona un cliente.");
            ok = false;
        }

        if (conceptos.length === 0) {
            mostrarError("lineas", "Agrega al menos un concepto con nombre, cantidad y precio.");
            ok = false;
        }

        if (anticipo !== null && (!Number.isFinite(anticipo) || anticipo < 0)) {
            mostrarError("anticipo", "Escribe un anticipo válido.");
            ok = false;
        } else if (anticipo !== null && anticipo > total) {
            mostrarError("anticipo", `El anticipo no puede superar el total (${dinero(total)}).`);
            ok = false;
        }

        if (campos.vigencia.value !== "" && campos.vigencia.value < hoy()) {
            mostrarError("vigencia", "La vigencia no puede ser una fecha pasada.");
            ok = false;
        }

        if (!ok || !cliente) return;

        // Aquí irá la llamada a la API: POST /cotizaciones
        const siguiente = Math.max(0, ...COTIZACIONES.map((c) => Number(c.folio))) + 1;

        COTIZACIONES.unshift({
            id: `c${Date.now()}`,
            folio: String(siguiente).padStart(4, "0"),
            cliente: cliente.nombre,
            telefono: cliente.telefono,
            estado: "BORRADOR",
            conceptos,
            anticipoRequerido: anticipo,
            vigenciaHasta: campos.vigencia.value || null,
            creadoEn: hoy(),
            pdfUrl: null,
        });

        cerrarFormulario();
        avisar("Cotización guardada como borrador.");
        recargar();
    }

    // Eventos
    // Al entrar a la sección Cotizaciones se pinta la pantalla
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="cotizaciones"]')
        ?.addEventListener("click", recargar);

    el("cot-nueva").addEventListener("click", abrirFormulario);

    let temporizadorBusqueda: number | undefined;

    buscador.addEventListener("input", () => {
        window.clearTimeout(temporizadorBusqueda);

        temporizadorBusqueda = window.setTimeout(() => {
            estado.busqueda = buscador.value.trim();
            estado.pagina = 1;
            pintarLista();
        }, 250);
    });

    chips.forEach((chip) => {
        chip.addEventListener("click", () => {
            estado.filtro = (chip.dataset.filtro as Filtro) ?? "todos";
            estado.pagina = 1;

            chips.forEach((c) => c.classList.toggle("active", c === chip));
            pintarLista();
        });
    });

    paginacion.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>("[data-pagina]");
        if (!boton || boton.disabled) return;

        estado.pagina = Number(boton.dataset.pagina);
        pintarLista();
    });

    filas.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>("[data-accion]");
        if (!boton) return;

        const id = boton.dataset.id ?? "";

        if (boton.dataset.accion === "detalle") abrirDetalle(id);
        if (boton.dataset.accion === "convertir") convertirEnPedido(id);
    });

    modalDetalle.addEventListener("click", (evento) => {
        const objetivo = evento.target as HTMLElement;

        // Clic en el fondo oscuro
        if (objetivo === modalDetalle) {
            modalDetalle.classList.add("hidden");
            return;
        }

        const boton = objetivo.closest<HTMLButtonElement>("[data-accion]");
        if (!boton) return;

        const id = boton.dataset.id ?? "";

        if (boton.dataset.accion === "cerrar") modalDetalle.classList.add("hidden");
        if (boton.dataset.accion === "cambiar") cambiarEstado(id, boton.dataset.nuevo as Estado);
        if (boton.dataset.accion === "convertir") convertirEnPedido(id);
        if (boton.dataset.accion === "pdf") {
            avisar("El PDF se abrirá cuando se conecte la API.");
        }
    });

    // Formulario
    el("cot-agregar-linea").addEventListener("click", () => {
        contLineas.insertAdjacentHTML("beforeend", lineaHtml());
    });

    contLineas.addEventListener("input", actualizarTotales);

    contLineas.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>('[data-accion="quitar"]');
        if (!boton) return;

        // Siempre se deja al menos una línea
        if (contLineas.querySelectorAll(".cot-linea").length > 1) {
            boton.closest(".cot-linea")?.remove();
            actualizarTotales();
        }
    });

    el("cot-modal-cerrar").addEventListener("click", cerrarFormulario);
    el("cot-form-cancelar").addEventListener("click", cerrarFormulario);

    form.addEventListener("submit", (evento) => {
        evento.preventDefault();
        guardarCotizacion();
    });

    // Escape cierra el cuadro abierto
    document.addEventListener("keydown", (evento) => {
        if (evento.key !== "Escape") return;

        if (!modal.classList.contains("hidden")) cerrarFormulario();
        else if (!modalDetalle.classList.contains("hidden")) {
            modalDetalle.classList.add("hidden");
        }
    });
})();