// ========================================
// Módulo de pedidos (app de escritorio)
// Lee los pedidos de la API (/pedidos) y guarda los cambios de estado.
// Los pedidos se crean desde Cotizaciones ("Crear pedido").
// ========================================
(() => {
    const API_URL = "http://127.0.0.1:3001";

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

    interface PedidoDetalle extends Pedido {
        conceptos: { nombre: string; cantidad: number; subtotal: number }[];
        historial: { estadoAnterior: Estado | null; estadoNuevo: Estado; fecha: string; usuario: string }[];
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

    // Un pedido cerrado o cancelado ya no cambia de estado
    const FINALES: Estado[] = ["CERRADO", "CANCELADO"];

    // Datos cargados de la API
    let PEDIDOS: Pedido[] = [];
    let cargando = false;
    let ocupado = false; // evita doble clic mientras se guarda

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

    function fechaHora(valor: string): string {
        return new Date(valor).toLocaleString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
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

    // Llamadas a la API
    async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
        let respuesta: Response;

        try {
            respuesta = await window.gaonaApiFetch(`${API_URL}${ruta}`, {
                ...opciones,
                headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
            });
        } catch {
            throw new Error(
                "No se pudo conectar con la API. Revisa que esté encendida (npm run dev dentro de la carpeta api)."
            );
        }

        const datos = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new Error(datos?.error ?? "Ocurrió un error inesperado.");
        }

        return datos as T;
    }

    function mensajeDe(error: unknown): string {
        return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
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
        const texto = estado.busqueda.toLowerCase().replace(/^#/, "");

        return PEDIDOS.filter((p) => {
            const coincideEstado = estado.filtro === "todos" || p.estado === estado.filtro;
            const coincideTexto =
                texto === "" ||
                p.cliente.toLowerCase().includes(texto) ||
                p.folio.toLowerCase().includes(texto);

            return coincideEstado && coincideTexto;
        });
    }

    function pintarLista(): void {
        if (cargando && PEDIDOS.length === 0) {
            filas.innerHTML = `<div class="cl-vacio">Cargando pedidos…</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
            return;
        }

        const resultado = filtrar();
        const totalPaginas = Math.max(1, Math.ceil(resultado.length / estado.limite));
        estado.pagina = Math.min(estado.pagina, totalPaginas);

        if (resultado.length === 0) {
            const hayFiltros = estado.busqueda !== "" || estado.filtro !== "todos";

            filas.innerHTML = `<div class="cl-vacio">${hayFiltros
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

        let botones = `<button class="ped-page" type="button" data-pagina="${estado.pagina - 1}" ${estado.pagina <= 1 ? "disabled" : ""
            } aria-label="Anterior">‹</button>`;

        for (let n = 1; n <= totalPaginas; n++) {
            botones += `<button class="ped-page${n === estado.pagina ? " active" : ""
                }" type="button" data-pagina="${n}">${n}</button>`;
        }

        botones += `<button class="ped-page" type="button" data-pagina="${estado.pagina + 1}" ${estado.pagina >= totalPaginas ? "disabled" : ""
            } aria-label="Siguiente">›</button>`;

        paginacion.innerHTML = botones;
    }

    async function recargar(): Promise<void> {
        cargando = true;
        pintarLista();

        try {
            const datos = await api<{ items: Pedido[] }>("/pedidos");
            PEDIDOS = datos.items;
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            cargando = false;
        }

        pintarResumen();
        pintarLista();
    }

    // Detalle de un pedido
    async function abrirDetalle(id: string): Promise<void> {
        let p: PedidoDetalle;

        try {
            p = await api<PedidoDetalle>(`/pedidos/${encodeURIComponent(id)}`);
        } catch (error) {
            avisar(mensajeDe(error), true);
            return;
        }

        const info = ESTADOS[p.estado];
        const saldo = Math.max(0, p.total - p.pagado);
        const esFinal = FINALES.includes(p.estado);

        const opciones = (Object.keys(ESTADOS) as Estado[])
            .map(
                (e) =>
                    `<option value="${e}"${e === p.estado ? " selected" : ""}>${esc(ESTADOS[e].texto)}</option>`
            )
            .join("");

        const conceptos = p.conceptos
            .map(
                (c) => `
                <div class="cot-concepto">
                    <div><strong>${esc(c.nombre)}</strong><span class="cot-sub">Cantidad: ${c.cantidad}</span></div>
                    <strong>${dinero(c.subtotal)}</strong>
                </div>`
            )
            .join("");

        const historial = p.historial
            .map(
                (h) => `
                <div class="cot-concepto">
                    <div>
                        <strong>${h.estadoAnterior ? `${esc(ESTADOS[h.estadoAnterior].texto)} → ` : "Pedido creado · "}${esc(ESTADOS[h.estadoNuevo].texto)}</strong>
                        <span class="cot-sub">${esc(h.usuario)}</span>
                    </div>
                    <span class="cot-sub">${fechaHora(h.fecha)}</span>
                </div>`
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

            ${conceptos ? `<h4 class="cot-detalle-titulo">Conceptos (antes de IVA)</h4><div class="cot-conceptos">${conceptos}</div>` : ""}

            ${historial ? `<h4 class="cot-detalle-titulo">Historial</h4><div class="cot-conceptos">${historial}</div>` : ""}

            ${esFinal
                ? `<p class="ped-subtitulo">Este pedido está ${p.estado === "CERRADO" ? "cerrado" : "cancelado"} y ya no cambia de estado.</p>`
                : `<div class="cl-field">
                        <label for="ped-f-estado">Cambiar estado</label>
                        <select id="ped-f-estado">${opciones}</select>
                    </div>`
            }

            <div class="cl-modal-actions">
                <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar">Cerrar</button>
                ${esFinal
                ? ""
                : `<button class="cl-btn cl-btn-primary" type="button" data-accion="guardar-estado" data-id="${esc(p.id)}">Guardar estado</button>`
            }
            </div>`;

        modalDetalle.classList.remove("hidden");
    }

    async function guardarEstado(id: string): Promise<void> {
        const p = PEDIDOS.find((x) => x.id === id);
        const selector = document.getElementById("ped-f-estado") as HTMLSelectElement | null;
        if (!p || !selector || ocupado) return;

        const nuevo = selector.value as Estado;

        if (nuevo === p.estado) {
            avisar("El pedido ya está en ese estado.", true);
            return;
        }

        if (
            FINALES.includes(nuevo) &&
            !window.confirm(
                `Un pedido ${nuevo === "CERRADO" ? "cerrado" : "cancelado"} ya no se puede cambiar. ¿Continuar?`
            )
        ) {
            return;
        }

        ocupado = true;

        try {
            await api(`/pedidos/${encodeURIComponent(id)}/estado`, {
                method: "PATCH",
                body: JSON.stringify({ estado: nuevo }),
            });

            modalDetalle.classList.add("hidden");
            avisar(`Pedido #${p.folio} actualizado a "${ESTADOS[nuevo].texto}".`);
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            ocupado = false;
        }

        await recargar();
    }

    // Eventos
    // Al entrar a la sección Pedidos se cargan los datos
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="pedidos"]')
        ?.addEventListener("click", () => void recargar());

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

        if (boton.dataset.accion === "detalle") void abrirDetalle(boton.dataset.id ?? "");
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
        if (boton.dataset.accion === "guardar-estado") void guardarEstado(boton.dataset.id ?? "");
    });

    // Escape cierra el cuadro abierto
    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape" && !modalDetalle.classList.contains("hidden")) {
            modalDetalle.classList.add("hidden");
        }
    });
})();
