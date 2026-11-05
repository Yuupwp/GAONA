// ========================================
// Módulo de pedidos (app de escritorio)
// DISEÑO CON DATOS DE EJEMPLO: aún no se conecta a la API.
// Cuando existan las rutas, solo hay que cambiar
// la constante PEDIDOS por una llamada a la API.
// ========================================
(() => {
    type Estado =
        | "EN_PROCESO"
        | "LISTO_PARA_INSTALAR"
        | "ENTREGADO"
        | "FACTURADO"
        | "CERRADO"
        | "CANCELADO";

    type Filtro = "todos" | Estado;

    interface Pedido {
        id: string;
        folio: string;
        cliente: string;
        telefono: string;
        estado: Estado;
        total: number;
        pagado: number;
        creadoEn: string;
        folioCotizacion: string;
    }

    // Mismos textos y colores que usa Finanzas
    const ESTADOS: Record<Estado, { texto: string; clase: string }> = {
        EN_PROCESO: { texto: "En proceso", clase: "cl-badge-gray" },
        LISTO_PARA_INSTALAR: { texto: "Listo para instalar", clase: "" },
        ENTREGADO: { texto: "Entregado", clase: "cl-badge-green" },
        FACTURADO: { texto: "Facturado", clase: "cl-badge-green" },
        CERRADO: { texto: "Cerrado", clase: "cl-badge-gray" },
        CANCELADO: { texto: "Cancelado", clase: "cl-badge-red" },
    };

    // ---------- DATOS DE EJEMPLO (borrar al conectar la API) ----------
    const PEDIDOS: Pedido[] = [
        { id: "p1", folio: "0001", cliente: "Roberto Garza Treviño", telefono: "81 5550 0101", estado: "EN_PROCESO", total: 18500, pagado: 9250, creadoEn: "2026-10-02", folioCotizacion: "0001" },
        { id: "p2", folio: "0002", cliente: "María Fernanda López", telefono: "81 5550 0102", estado: "LISTO_PARA_INSTALAR", total: 42300, pagado: 21150, creadoEn: "2026-10-05", folioCotizacion: "0003" },
        { id: "p3", folio: "0003", cliente: "Carlos Treviño Salinas", telefono: "81 5550 0103", estado: "ENTREGADO", total: 12800, pagado: 12800, creadoEn: "2026-10-08", folioCotizacion: "0004" },
        { id: "p4", folio: "0004", cliente: "Ana Sofía Martínez", telefono: "81 5550 0104", estado: "EN_PROCESO", total: 27600, pagado: 0, creadoEn: "2026-10-12", folioCotizacion: "0006" },
        { id: "p5", folio: "0005", cliente: "Jorge Ramírez Cantú", telefono: "81 5550 0105", estado: "FACTURADO", total: 9900, pagado: 9900, creadoEn: "2026-10-15", folioCotizacion: "0007" },
        { id: "p6", folio: "0006", cliente: "Laura Elizondo", telefono: "81 5550 0106", estado: "CANCELADO", total: 15400, pagado: 0, creadoEn: "2026-10-18", folioCotizacion: "0008" },
        { id: "p7", folio: "0007", cliente: "Héctor Villarreal", telefono: "81 5550 0107", estado: "LISTO_PARA_INSTALAR", total: 33200, pagado: 33200, creadoEn: "2026-10-21", folioCotizacion: "0010" },
        { id: "p8", folio: "0008", cliente: "Patricia Guerra", telefono: "81 5550 0108", estado: "EN_PROCESO", total: 21750, pagado: 10875, creadoEn: "2026-10-25", folioCotizacion: "0011" },
        { id: "p9", folio: "0009", cliente: "Eduardo Salazar", telefono: "81 5550 0109", estado: "ENTREGADO", total: 8600, pagado: 8600, creadoEn: "2026-10-28", folioCotizacion: "0012" },
        { id: "p10", folio: "0010", cliente: "Daniela Cavazos", telefono: "81 5550 0110", estado: "EN_PROCESO", total: 19900, pagado: 5000, creadoEn: "2026-11-02", folioCotizacion: "0014" },
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

    const buscador = el<HTMLInputElement>("ped-buscar");
    const chips = el<HTMLDivElement>("ped-chips").querySelectorAll<HTMLButtonElement>(".ped-chip");
    const filas = el<HTMLDivElement>("ped-filas");
    const contador = el<HTMLSpanElement>("ped-contador");
    const paginacion = el<HTMLDivElement>("ped-paginacion");
    const modalDetalle = el<HTMLDivElement>("ped-detalle");
    const detalleContenido = el<HTMLDivElement>("ped-detalle-contenido");
    const toast = el<HTMLDivElement>("ped-toast");

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

    // "2026-10-02" se interpreta como hora local, no UTC
    function fecha(valor: string): string {
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
        const contar = (e: Estado) => PEDIDOS.filter((p) => p.estado === e).length;

        el("ped-stat-total").textContent = String(PEDIDOS.length);
        el("ped-stat-proceso").textContent = String(contar("EN_PROCESO"));
        el("ped-stat-listos").textContent = String(contar("LISTO_PARA_INSTALAR"));
        el("ped-stat-entregados").textContent = String(contar("ENTREGADO"));
    }

    // Lista
    function filtrar(): Pedido[] {
        const texto = estado.busqueda.toLowerCase();

        return PEDIDOS.filter((p) => {
            const coincideEstado = estado.filtro === "todos" || p.estado === estado.filtro;
            const coincideTexto =
                texto === "" ||
                p.cliente.toLowerCase().includes(texto) ||
                p.folio.includes(texto);

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
                    ? "No se encontraron pedidos con esos criterios."
                    : "Aún no hay pedidos. Cuando una cotización sea aprobada y se convierta en pedido, aparecerá aquí."
            }</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
            return;
        }

        const inicio = (estado.pagina - 1) * estado.limite;
        const visibles = resultado.slice(inicio, inicio + estado.limite);

        filas.innerHTML = visibles
            .map((p) => {
                const info = ESTADOS[p.estado];
                const porcentaje = p.total > 0 ? Math.min(100, (p.pagado / p.total) * 100) : 0;
                const liquidado = p.pagado >= p.total;

                return `
                <div class="ped-row">
                    <span class="ped-folio">#${esc(p.folio)}</span>

                    <div class="ped-cliente">
                        <div class="cl-avatar">${esc(iniciales(p.cliente))}</div>
                        <div>
                            <strong class="ped-nombre">${esc(p.cliente)}</strong>
                            <span class="ped-sub">${esc(p.telefono)}</span>
                        </div>
                    </div>

                    <div><span class="cl-badge ${info.clase}">${esc(info.texto)}</span></div>

                    <span>${dinero(p.total)}</span>

                    <div class="ped-pagado">
                        <span>${dinero(p.pagado)}</span>
                        <div class="ped-barra"><div class="ped-barra-relleno${liquidado ? " completa" : ""}" style="width:${porcentaje.toFixed(0)}%"></div></div>
                    </div>

                    <span>${fecha(p.creadoEn)}</span>

                    <div>
                        <button type="button" class="cl-link" data-accion="detalle" data-id="${esc(p.id)}">Ver detalle</button>
                    </div>
                </div>`;
            })
            .join("");

        contador.textContent =
            resultado.length === 1 ? "1 pedido" : `${resultado.length} pedidos`;

        pintarPaginacion(totalPaginas);
    }

    function pintarPaginacion(totalPaginas: number): void {
        if (totalPaginas <= 1) {
            paginacion.innerHTML = "";
            return;
        }

        let botones = `<button class="ped-page" type="button" data-pagina="${estado.pagina - 1}" ${
            estado.pagina <= 1 ? "disabled" : ""
        } aria-label="Anterior">‹</button>`;

        for (let n = 1; n <= totalPaginas; n++) {
            botones += `<button class="ped-page${
                n === estado.pagina ? " active" : ""
            }" type="button" data-pagina="${n}">${n}</button>`;
        }

        botones += `<button class="ped-page" type="button" data-pagina="${estado.pagina + 1}" ${
            estado.pagina >= totalPaginas ? "disabled" : ""
        } aria-label="Siguiente">›</button>`;

        paginacion.innerHTML = botones;
    }

    // Detalle de un pedido
    function abrirDetalle(id: string): void {
        const p = PEDIDOS.find((x) => x.id === id);
        if (!p) return;

        const info = ESTADOS[p.estado];
        const saldo = Math.max(0, p.total - p.pagado);

        const opciones = (Object.keys(ESTADOS) as Estado[])
            .map(
                (e) =>
                    `<option value="${e}"${e === p.estado ? " selected" : ""}>${esc(ESTADOS[e].texto)}</option>`
            )
            .join("");

        detalleContenido.innerHTML = `
            <div class="cl-modal-head">
                <div>
                    <h3>Pedido #${esc(p.folio)}</h3>
                    <span class="ped-subtitulo">${esc(p.cliente)} · ${esc(p.telefono)}</span>
                </div>
                <button class="cl-close" type="button" data-accion="cerrar" aria-label="Cerrar">×</button>
            </div>

            <div class="ped-detalle-resumen">
                <div><span>Total</span><strong>${dinero(p.total)}</strong></div>
                <div><span>Pagado</span><strong>${dinero(p.pagado)}</strong></div>
                <div><span>Saldo</span><strong class="ped-saldo">${dinero(saldo)}</strong></div>
            </div>

            <div class="ped-detalle-datos">
                <div><span>Estado actual</span><span class="cl-badge ${info.clase}">${esc(info.texto)}</span></div>
                <div><span>Cotización de origen</span><strong>#${esc(p.folioCotizacion)}</strong></div>
                <div><span>Fecha del pedido</span><strong>${fecha(p.creadoEn)}</strong></div>
            </div>

            <div class="cl-field">
                <label for="ped-f-estado">Cambiar estado</label>
                <select id="ped-f-estado">${opciones}</select>
            </div>

            <div class="cl-modal-actions">
                <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar">Cerrar</button>
                <button class="cl-btn cl-btn-primary" type="button" data-accion="guardar-estado" data-id="${esc(p.id)}">Guardar estado</button>
            </div>`;

        modalDetalle.classList.remove("hidden");
    }

    function guardarEstado(id: string): void {
        const p = PEDIDOS.find((x) => x.id === id);
        const selector = document.getElementById("ped-f-estado") as HTMLSelectElement | null;
        if (!p || !selector) return;

        p.estado = selector.value as Estado;

        modalDetalle.classList.add("hidden");
        avisar(`Pedido #${p.folio} actualizado a "${ESTADOS[p.estado].texto}".`);
        pintarResumen();
        pintarLista();
    }

    // Eventos
    // Al entrar a la sección Pedidos se pinta la pantalla
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="pedidos"]')
        ?.addEventListener("click", () => {
            pintarResumen();
            pintarLista();
        });

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

        if (boton.dataset.accion === "detalle") abrirDetalle(boton.dataset.id ?? "");
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

        if (boton.dataset.accion === "cerrar") modalDetalle.classList.add("hidden");
        if (boton.dataset.accion === "guardar-estado") guardarEstado(boton.dataset.id ?? "");
    });

    // Escape cierra el cuadro abierto
    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape" && !modalDetalle.classList.contains("hidden")) {
            modalDetalle.classList.add("hidden");
        }
    });
})();