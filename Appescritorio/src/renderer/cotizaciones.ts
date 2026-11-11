// ========================================
// Módulo de cotizaciones (app de escritorio)
// Lee y guarda las cotizaciones en la API (/cotizaciones).
// ========================================
(() => {
    const API_URL = "http://localhost:3001";

    type Estado = "BORRADOR" | "ENVIADA" | "APROBADA" | "RECHAZADA" | "VENCIDA";
    type Filtro = "todos" | Estado;

    interface Concepto {
        nombre: string;
        cantidad: number;
        precio: number;
        idProducto?: string | null;
        medidas?: string | null;
    }

    interface Cotizacion {
        id: string;
        folio: string;
        cliente: string;
        telefono: string;
        correo: string | null;
        estado: Estado;
        origen: "WEB" | "ESCRITORIO";
        subtotal: number;
        iva: number;
        total: number;
        conceptos: Concepto[];
        anticipoRequerido: number | null;
        vigenciaHasta: string | null;
        fechaAprobacion: string | null;
        creadoEn: string;
        elaboradaPor: string;
        idPedido: string | null;
        folioPedido: string | null;
    }

    interface SolicitudAbierta {
        id: string;
        origen: "WEB" | "ESCRITORIO";
        estado: "NUEVA" | "EN_REVISION" | "VISITA_PROGRAMADA";
        descripcion: string | null;
        creadoEn: string;
        productos: {
            idProducto: string;
            nombre: string;
            cantidad: number;
            precio: number;
            medidas: string | null;
            notas: string | null;
        }[];
    }

    const ESTADOS_SOLICITUD: Record<SolicitudAbierta["estado"], string> = {
        NUEVA: "Nueva",
        EN_REVISION: "En revisión",
        VISITA_PROGRAMADA: "Visita programada",
    };

    // Cuántas solicitudes se ven antes de "Ver todas"
    const SOLICITUDES_VISIBLES = 5;
    let verTodasLasSolicitudes = false;

    interface ClienteOpcion {
        id: string;
        nombre: string;
        telefono: string;
        solicitudes: SolicitudAbierta[];
    }

    const IVA = 0.16;

    const ESTADOS: Record<Estado, { texto: string; clase: string }> = {
        BORRADOR: { texto: "Borrador", clase: "cl-badge-gray" },
        ENVIADA: { texto: "Enviada", clase: "" },
        APROBADA: { texto: "Aprobada", clase: "cl-badge-green" },
        RECHAZADA: { texto: "Rechazada", clase: "cl-badge-red" },
        VENCIDA: { texto: "Vencida", clase: "cl-badge-gray" },
    };

    // Datos cargados de la API
    let COTIZACIONES: Cotizacion[] = [];
    let CLIENTES: ClienteOpcion[] = [];
    let cargando = false;
    let ocupado = false; // evita doble clic mientras se guarda
    let correoActivo = false; // la API dice si el envío de correos está configurado

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
    const botonGuardar = el<HTMLButtonElement>("cot-form-guardar");

    const campos = {
        cliente: el<HTMLSelectElement>("cot-f-cliente"),
        solicitud: el<HTMLSelectElement>("cot-f-solicitud"),
        vigencia: el<HTMLInputElement>("cot-f-vigencia"),
        anticipo: el<HTMLInputElement>("cot-f-anticipo"),
    };

    const errores = {
        cliente: el<HTMLSpanElement>("cot-e-cliente"),
        solicitud: el<HTMLSpanElement>("cot-e-solicitud"),
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

    // "2026-10-02" se interpreta como hora local, no UTC
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

    // Solo para mostrar el total mientras se llena el formulario;
    // el total que se guarda lo calcula la API.
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

    // Llamadas a la API
    async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
        let respuesta: Response;

        try {
            respuesta = await fetch(`${API_URL}${ruta}`, {
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

    function idUsuario(): string | undefined {
        return window.gaonaSesion?.actual()?.id;
    }

    // Resumen (tarjetas de arriba)
    function pintarResumen(): void {
        const pendientes = COTIZACIONES.filter((c) => c.estado === "ENVIADA");
        const monto = pendientes.reduce((s, c) => s + c.total, 0);

        el("cot-stat-total").textContent = String(COTIZACIONES.length);
        el("cot-stat-pendientes").textContent = String(pendientes.length);
        el("cot-stat-aprobadas").textContent = String(
            COTIZACIONES.filter((c) => c.estado === "APROBADA").length
        );
        el("cot-stat-monto").textContent = dinero(monto);
    }

    // Lista
    function filtrar(): Cotizacion[] {
        const texto = estado.busqueda.toLowerCase().replace(/^#/, "");

        return COTIZACIONES.filter((c) => {
            const coincideEstado = estado.filtro === "todos" || c.estado === estado.filtro;
            const coincideTexto =
                texto === "" ||
                c.cliente.toLowerCase().includes(texto) ||
                c.folio.toLowerCase().includes(texto);

            return coincideEstado && coincideTexto;
        });
    }

    function pintarLista(): void {
        if (cargando && COTIZACIONES.length === 0) {
            filas.innerHTML = `<div class="cl-vacio">Cargando cotizaciones…</div>`;
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

                    <span class="cot-monto">${dinero(c.total)}</span>

                    <span>${c.anticipoRequerido !== null ? dinero(c.anticipoRequerido) : "—"}</span>

                    <span>${fecha(c.vigenciaHasta)}</span>

                    <div class="cot-acciones">
                        <button type="button" class="cl-link" data-accion="detalle" data-id="${esc(c.id)}">Ver detalle</button>
                        ${c.estado === "APROBADA" && !c.idPedido
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

        let botones = `<button class="cot-page" type="button" data-pagina="${estado.pagina - 1}" ${estado.pagina <= 1 ? "disabled" : ""
            } aria-label="Anterior">‹</button>`;

        for (let n = 1; n <= totalPaginas; n++) {
            botones += `<button class="cot-page${n === estado.pagina ? " active" : ""
                }" type="button" data-pagina="${n}">${n}</button>`;
        }

        botones += `<button class="cot-page" type="button" data-pagina="${estado.pagina + 1}" ${estado.pagina >= totalPaginas ? "disabled" : ""
            } aria-label="Siguiente">›</button>`;

        paginacion.innerHTML = botones;
    }

    async function recargar(): Promise<void> {
        cargando = true;
        pintarLista();

        try {
            const [datos, opciones] = await Promise.all([
                api<{ items: Cotizacion[]; correoActivo: boolean }>("/cotizaciones"),
                api<{ clientes: ClienteOpcion[] }>("/cotizaciones/opciones"),
            ]);
            COTIZACIONES = datos.items;
            correoActivo = datos.correoActivo;
            CLIENTES = opciones.clientes;
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            cargando = false;
        }

        pintarResumen();
        pintarSolicitudesNuevas();
        pintarLista();
    }

    // ---------- Solicitudes por cotizar ----------
    function hace(fechaTexto: string): string {
        const dias = Math.floor(
            (new Date(`${hoy()}T00:00:00`).getTime() - new Date(`${fechaTexto}T00:00:00`).getTime()) / 86400000
        );
        if (dias <= 0) return "Hoy";
        if (dias === 1) return "Ayer";
        return `Hace ${dias} días`;
    }

    function pintarSolicitudesNuevas(): void {
        const contenedor = el<HTMLDivElement>("cot-sol");
        const filasSol = el<HTMLDivElement>("cot-sol-filas");
        const toggle = el<HTMLButtonElement>("cot-sol-toggle");

        // Las más antiguas primero: son las que llevan más tiempo esperando
        const pendientes = CLIENTES.flatMap((c) => c.solicitudes.map((s) => ({ cliente: c, s }))).sort((a, b) =>
            a.s.creadoEn.localeCompare(b.s.creadoEn)
        );

        contenedor.classList.toggle("hidden", pendientes.length === 0);
        el("cot-sol-num").textContent = String(pendientes.length);

        toggle.classList.toggle("hidden", pendientes.length <= SOLICITUDES_VISIBLES);
        toggle.textContent = verTodasLasSolicitudes ? "Ver menos" : `Ver todas (${pendientes.length})`;

        const visibles = verTodasLasSolicitudes ? pendientes : pendientes.slice(0, SOLICITUDES_VISIBLES);

        filasSol.innerHTML = visibles
            .map(({ cliente, s }) => {
                const productos = s.productos.length
                    ? s.productos
                        .map((p) => `${p.cantidad} × ${esc(p.nombre)}${p.medidas ? ` (${esc(p.medidas)})` : ""}`)
                        .join(", ")
                    : "Sin productos";
                const notas = [s.descripcion, ...s.productos.map((p) => p.notas)].filter(Boolean).join(" · ");
                const estimado = calcular(s.productos.map((p) => ({ nombre: p.nombre, cantidad: p.cantidad, precio: p.precio }))).total;

                return `
                <div class="cot-sol-row">
                    <div class="cot-cliente">
                        <div class="cl-avatar">${esc(iniciales(cliente.nombre))}</div>
                        <div>
                            <strong class="cot-nombre">${esc(cliente.nombre)}</strong>
                            <span class="cot-sub">${esc(cliente.telefono)} · ${s.origen === "WEB" ? "Página" : "Escritorio"}</span>
                        </div>
                    </div>

                    <div>
                        <span>${productos}</span>
                        ${notas ? `<span class="cot-sub">${esc(notas)}</span>` : ""}
                    </div>

                    <div>
                        <span class="${s.estado === "NUEVA" ? "cot-sol-nueva" : ""}">${esc(ESTADOS_SOLICITUD[s.estado])}</span>
                        <span class="cot-sub">${hace(s.creadoEn)}</span>
                    </div>

                    <div>
                        <span class="cot-monto">${s.productos.length ? dinero(estimado) : "—"}</span>
                        <span class="cot-sub">con IVA, precio de catálogo</span>
                    </div>

                    <button class="cl-btn cl-btn-primary" type="button" data-accion="cotizar"
                        data-cliente="${esc(cliente.id)}" data-solicitud="${esc(s.id)}">Cotizar</button>
                </div>`;
            })
            .join("");
    }

    // Detalle de una cotización
    function abrirDetalle(id: string): void {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c) return;

        const info = ESTADOS[c.estado];

        const conceptos = c.conceptos
            .map(
                (k) => `
                <div class="cot-concepto">
                    <div>
                        <strong>${esc(k.nombre)}</strong>
                        <span class="cot-sub">${k.cantidad} × ${dinero(k.precio)}${k.medidas ? ` · ${esc(k.medidas)}` : ""
                    }</span>
                    </div>
                    <strong class="cot-monto">${dinero(redondear(k.cantidad * k.precio))}</strong>
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
        } else if (c.estado === "APROBADA" && !c.idPedido) {
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
                <div><span>Origen</span><strong>${c.origen === "WEB" ? "Solicitud de la página" : "App de escritorio"}</strong></div>
                <div><span>Elaboró</span><strong>${esc(c.elaboradaPor)}</strong></div>
                ${c.folioPedido ? `<div><span>Pedido</span><strong>#${esc(c.folioPedido)}</strong></div>` : ""}
            </div>

            <h4 class="cot-detalle-titulo">Conceptos</h4>
            <div class="cot-conceptos">${conceptos}</div>

            <div class="cot-totales">
                <div><span>Subtotal</span><span>${dinero(c.subtotal)}</span></div>
                <div><span>IVA (16%)</span><span>${dinero(c.iva)}</span></div>
                <div class="cot-total-final"><span>Total</span><span>${dinero(c.total)}</span></div>
            </div>

            ${seccionCorreo(c)}

            <div class="cl-modal-actions">
                <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar">Cerrar</button>
                <button class="cl-btn cl-btn-outline" type="button" data-accion="pdf" data-id="${esc(c.id)}">Ver PDF</button>
                ${acciones}
            </div>`;

        modalDetalle.classList.remove("hidden");
    }

    // Envío por correo: solo si la API tiene el correo configurado y la cotización sigue vigente
    function seccionCorreo(c: Cotizacion): string {
        if (!["BORRADOR", "ENVIADA", "APROBADA"].includes(c.estado)) return "";

        if (!correoActivo) {
            return `<p class="cot-sub">El envío por correo no está configurado en la API (MAIL_ENABLED y SMTP_* en api/.env).</p>`;
        }

        const ayuda =
            c.estado === "BORRADOR"
                ? "Al enviarla, la cotización pasa a “Enviada”."
                : "Se reenviará el PDF actualizado.";

        return `
            <h4 class="cot-detalle-titulo">Enviar por correo</h4>
            <div class="cl-field">
                <label for="cot-f-correo">Correo del cliente</label>
                <input id="cot-f-correo" type="email" maxlength="150" autocomplete="off"
                    placeholder="cliente@correo.com" value="${esc(c.correo ?? "")}">
                <span class="cl-error" id="cot-e-correo"></span>
                <span class="cot-sub">El PDF va adjunto. ${ayuda}${c.correo ? "" : " Como el cliente no tiene correo, se guardará en su ficha."
            }</span>
            </div>
            <div class="cl-modal-actions">
                <button class="cl-btn cl-btn-outline" type="button" data-accion="enviar" data-id="${esc(c.id)}">Enviar PDF por correo</button>
            </div>`;
    }

    async function enviarPorCorreo(id: string, boton: HTMLButtonElement): Promise<void> {
        const c = COTIZACIONES.find((x) => x.id === id);
        const campo = document.getElementById("cot-f-correo") as HTMLInputElement | null;
        const error = document.getElementById("cot-e-correo");
        if (!c || !campo || ocupado) return;

        const correo = campo.value.trim();
        if (error) error.textContent = "";
        campo.parentElement?.classList.remove("has-error");

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
            if (error) error.textContent = "Escribe un correo válido.";
            campo.parentElement?.classList.add("has-error");
            campo.focus();
            return;
        }

        ocupado = true;
        boton.disabled = true;
        boton.textContent = "Enviando…";

        try {
            const r = await api<{ enviadoA: string }>(`/cotizaciones/${encodeURIComponent(id)}/enviar`, {
                method: "POST",
                body: JSON.stringify({ correo, idUsuario: idUsuario() }),
            });

            modalDetalle.classList.add("hidden");
            avisar(`Cotización #${c.folio} enviada a ${r.enviadoA}.`);
            ocupado = false;
            await recargar();
        } catch (e) {
            ocupado = false;
            boton.disabled = false;
            boton.textContent = "Enviar PDF por correo";
            if (error) error.textContent = mensajeDe(e);
            campo.parentElement?.classList.add("has-error");
        }
    }

    // El PDF se abre en el navegador, donde se puede imprimir o guardar
    function verPdf(id: string): void {
        window.open(`${API_URL}/cotizaciones/${encodeURIComponent(id)}/pdf`, "_blank");
    }

    async function cambiarEstado(id: string, nuevo: Estado): Promise<void> {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c || ocupado) return;

        ocupado = true;

        try {
            await api(`/cotizaciones/${encodeURIComponent(id)}/estado`, {
                method: "PATCH",
                body: JSON.stringify({ estado: nuevo, idUsuario: idUsuario() }),
            });

            modalDetalle.classList.add("hidden");
            avisar(`Cotización #${c.folio} marcada como "${ESTADOS[nuevo].texto.toLowerCase()}".`);
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            ocupado = false;
        }

        await recargar();
    }

    async function convertirEnPedido(id: string): Promise<void> {
        const c = COTIZACIONES.find((x) => x.id === id);
        if (!c || ocupado) return;

        if (!window.confirm(`¿Crear el pedido de la cotización #${c.folio} por ${dinero(c.total)}?`)) {
            return;
        }

        ocupado = true;

        try {
            const pedido = await api<{ folio: string }>(
                `/cotizaciones/${encodeURIComponent(id)}/pedido`,
                { method: "POST", body: JSON.stringify({ idUsuario: idUsuario() }) }
            );

            modalDetalle.classList.add("hidden");
            avisar(`Se creó el pedido #${pedido.folio}. Ya aparece en Pedidos y en Finanzas.`);
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            ocupado = false;
        }

        await recargar();
    }

    // Formulario: nueva cotización
    function lineaHtml(concepto?: Concepto): string {
        return `
            <div class="cot-linea" data-id-producto="${esc(concepto?.idProducto ?? "")}" data-medidas="${esc(concepto?.medidas ?? "")}">
                <input type="text" class="cot-l-nombre" placeholder="Producto o servicio" maxlength="200" autocomplete="off" value="${esc(concepto?.nombre ?? "")}">
                <input type="number" class="cot-l-cantidad" min="1" step="1" value="${concepto?.cantidad ?? 1}">
                <input type="number" class="cot-l-precio" min="0" step="0.01" placeholder="0.00" value="${concepto?.precio ?? ""}">
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
                conceptos.push({
                    nombre,
                    cantidad,
                    precio,
                    idProducto: linea.dataset.idProducto || null,
                    medidas: linea.dataset.medidas || null,
                });
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

    function clienteElegido(): ClienteOpcion | undefined {
        return CLIENTES.find((c) => c.id === campos.cliente.value);
    }

    // Al elegir cliente se muestran sus solicitudes abiertas
    function pintarSolicitudes(): void {
        const cliente = clienteElegido();
        const solicitudes = cliente?.solicitudes ?? [];

        campos.solicitud.innerHTML =
            '<option value="">Sin solicitud (cotización directa)</option>' +
            solicitudes
                .map((s) => {
                    const origen = s.origen === "WEB" ? "Página" : "Escritorio";
                    const productos = s.productos.map((p) => p.nombre).join(", ");
                    return `<option value="${esc(s.id)}">${origen} · ${fecha(s.creadoEn)}${productos ? ` · ${esc(productos)}` : ""
                        }</option>`;
                })
                .join("");

        campos.solicitud.disabled = solicitudes.length === 0;

        // Si el cliente pidió algo desde la página, se propone esa solicitud
        if (solicitudes.length > 0) {
            campos.solicitud.value = solicitudes[0].id;
        }
        llenarDesdeSolicitud();
    }

    // Los productos de la solicitud se pasan como conceptos (se pueden editar)
    function llenarDesdeSolicitud(): void {
        const solicitud = clienteElegido()?.solicitudes.find((s) => s.id === campos.solicitud.value);

        if (solicitud && solicitud.productos.length > 0) {
            contLineas.innerHTML = solicitud.productos
                .map((p) =>
                    lineaHtml({
                        // Las notas del cliente van en el concepto para que salgan en el PDF
                        nombre: (p.notas ? `${p.nombre} — ${p.notas.trim()}` : p.nombre).slice(0, 200),
                        cantidad: p.cantidad,
                        precio: p.precio,
                        idProducto: p.idProducto,
                        medidas: p.medidas,
                    })
                )
                .join("");
        } else if (leerConceptos().length === 0) {
            contLineas.innerHTML = lineaHtml();
        }

        actualizarTotales();
    }

    // "preseleccion" llega desde el botón Cotizar de una solicitud
    async function abrirFormulario(preseleccion?: { idCliente: string; idSolicitud: string }): Promise<void> {
        form.reset();
        limpiarErrores();

        campos.vigencia.min = hoy();
        contLineas.innerHTML = lineaHtml();
        campos.cliente.innerHTML = '<option value="">Cargando clientes…</option>';
        campos.solicitud.disabled = true;
        actualizarTotales();

        modal.classList.remove("hidden");

        try {
            const datos = await api<{ clientes: ClienteOpcion[] }>("/cotizaciones/opciones");
            CLIENTES = datos.clientes;
        } catch (error) {
            CLIENTES = [];
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        }

        campos.cliente.innerHTML =
            '<option value="">Selecciona un cliente</option>' +
            CLIENTES.map((c) => {
                const pendientes = c.solicitudes.length > 0 ? ` (${c.solicitudes.length} solicitud${c.solicitudes.length === 1 ? "" : "es"})` : "";
                return `<option value="${esc(c.id)}">${esc(c.nombre)}${pendientes}</option>`;
            }).join("");

        if (preseleccion && CLIENTES.some((c) => c.id === preseleccion.idCliente)) {
            campos.cliente.value = preseleccion.idCliente;
            pintarSolicitudes();
            campos.solicitud.value = preseleccion.idSolicitud;
            llenarDesdeSolicitud();

            // Lo primero que suele ajustarse es el precio
            contLineas.querySelector<HTMLInputElement>(".cot-l-precio")?.focus();
            return;
        }

        campos.cliente.focus();
    }

    function cerrarFormulario(): void {
        modal.classList.add("hidden");
    }

    async function guardarCotizacion(): Promise<void> {
        if (ocupado) return;
        limpiarErrores();
        let ok = true;

        const cliente = clienteElegido();
        const conceptos = leerConceptos();
        const { total } = calcular(conceptos);
        const anticipo =
            campos.anticipo.value.trim() === "" ? null : redondear(Number(campos.anticipo.value));

        if (!cliente) {
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

        ocupado = true;
        botonGuardar.disabled = true;

        try {
            const creada = await api<Cotizacion>("/cotizaciones", {
                method: "POST",
                body: JSON.stringify({
                    idCliente: cliente.id,
                    idSolicitud: campos.solicitud.value || null,
                    conceptos,
                    anticipoRequerido: anticipo,
                    vigenciaHasta: campos.vigencia.value || null,
                    idUsuario: idUsuario(),
                }),
            });

            cerrarFormulario();
            avisar(`Cotización #${creada.folio} guardada como borrador.`);
            await recargar();
        } catch (error) {
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        } finally {
            ocupado = false;
            botonGuardar.disabled = false;
        }
    }

    // Eventos
    // Al entrar a la sección Cotizaciones se cargan los datos
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="cotizaciones"]')
        ?.addEventListener("click", () => void recargar());

    el("cot-nueva").addEventListener("click", () => void abrirFormulario());

    el("cot-sol-toggle").addEventListener("click", () => {
        verTodasLasSolicitudes = !verTodasLasSolicitudes;
        pintarSolicitudesNuevas();
    });

    el("cot-sol-filas").addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>('[data-accion="cotizar"]');
        if (!boton) return;

        void abrirFormulario({
            idCliente: boton.dataset.cliente ?? "",
            idSolicitud: boton.dataset.solicitud ?? "",
        });
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

        const id = boton.dataset.id ?? "";

        if (boton.dataset.accion === "detalle") abrirDetalle(id);
        if (boton.dataset.accion === "convertir") void convertirEnPedido(id);
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
        if (boton.dataset.accion === "cambiar") void cambiarEstado(id, boton.dataset.nuevo as Estado);
        if (boton.dataset.accion === "convertir") void convertirEnPedido(id);
        if (boton.dataset.accion === "pdf") verPdf(id);
        if (boton.dataset.accion === "enviar") void enviarPorCorreo(id, boton);
    });

    // Formulario
    campos.cliente.addEventListener("change", pintarSolicitudes);
    campos.solicitud.addEventListener("change", llenarDesdeSolicitud);

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
        void guardarCotizacion();
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
