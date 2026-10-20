// ========================================
// Módulo de clientes (app de escritorio)
// ========================================
(() => {
    const API_URL = "http://localhost:3000";

    // Tipos de lo que responde la API
    type Filtro = "todos" | "nueva" | "saldo" | "pedido";
    type Origen = "WEB" | "MANUAL";

    interface ClienteFila {
        id: string;
        nombre: string;
        apellido: string;
        telefono: string;
        correo: string | null;
        direccion: string | null;
        origen: Origen;
        solicitudNueva: boolean;
        totalPedidos: number;
        saldoPendiente: number;
    }

    interface RespuestaLista {
        items: ClienteFila[];
        total: number;
        pagina: number;
        limite: number;
        totalPaginas: number;
        resumen: {
            total: number;
            conSaldo: number;
            solicitudesNuevas: number;
        };
    }

    interface DatosCliente {
        id: string;
        nombre: string;
        apellido: string;
        telefono: string;
        correo: string | null;
        direccion: string | null;
        origen: Origen;
        creadoEn: string;
    }

    interface RespuestaDetalle {
        cliente: DatosCliente;
        finanzas: { anticipos: number; pagos: number; saldo: number };
        solicitudes: {
            id: string;
            titulo: string;
            estado: string;
            origen: string;
            creadoEn: string;
        }[];
        cotizaciones: {
            id: string;
            estado: string;
            total: number;
            vigenciaHasta: string | null;
            creadoEn: string;
        }[];
        pedidos: {
            id: string;
            estado: string;
            total: number;
            pagado: number;
            saldo: number;
            creadoEn: string;
        }[];
        citas: {
            id: string;
            tipo: string;
            estado: string;
            inicio: string;
            fin: string;
            direccion: string | null;
        }[];
    }

    type Pestana = "solicitudes" | "cotizaciones" | "pedidos" | "agenda";

    class ApiError extends Error {
        status: number;

        constructor(status: number, mensaje: string) {
            super(mensaje);
            this.status = status;
        }
    }

    
    // Estado del módulo
    const estado = {
        filtro: "todos" as Filtro,
        busqueda: "",
        pagina: 1,
        limite: 8,
        pedidoLista: 0, // evita que una respuesta lenta pise a una más nueva
        detalleId: null as string | null,
        pestana: "solicitudes" as Pestana,
        editandoId: null as string | null,
        eliminando: null as DatosCliente | null,
        guardando: false,
    };

    // Elementos de la pantalla

    function el<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    const vistaLista = el<HTMLDivElement>("cl-vista-lista");
    const vistaDetalle = el<HTMLDivElement>("cl-vista-detalle");
    const filas = el<HTMLDivElement>("cl-filas");
    const contador = el<HTMLSpanElement>("cl-contador");
    const paginacion = el<HTMLDivElement>("cl-paginacion");
    const buscador = el<HTMLInputElement>("cl-buscar");
    const chips = document.querySelectorAll<HTMLButtonElement>(".cl-chip");
    const banner = el<HTMLDivElement>("cl-banner");
    const bannerTexto = el<HTMLElement>("cl-banner-texto");
    const statTotal = el<HTMLElement>("cl-stat-total");
    const statSaldo = el<HTMLElement>("cl-stat-saldo");
    const statNuevas = el<HTMLElement>("cl-stat-nuevas");

    const modal = el<HTMLDivElement>("cl-modal");
    const modalTitulo = el<HTMLElement>("cl-modal-titulo");
    const form = el<HTMLFormElement>("cl-form");
    const btnGuardar = el<HTMLButtonElement>("cl-form-guardar");
    const formError = el<HTMLDivElement>("cl-form-error");

    const campos = {
        nombre: el<HTMLInputElement>("cl-f-nombre"),
        apellido: el<HTMLInputElement>("cl-f-apellido"),
        telefono: el<HTMLInputElement>("cl-f-telefono"),
        correo: el<HTMLInputElement>("cl-f-correo"),
        direccion: el<HTMLTextAreaElement>("cl-f-direccion"),
    };

    const confirmar = el<HTMLDivElement>("cl-confirm");
    const confirmarTitulo = el<HTMLElement>("cl-confirm-titulo");
    const btnConfirmarEliminar = el<HTMLButtonElement>("cl-confirm-eliminar");
    const toast = el<HTMLDivElement>("cl-toast");

    
    // Utilidades
    // Evita que un nombre con < o & rompa la pantalla (los clientes del
    // catálogo web escriben sus propios datos)
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
        return `${formatoMoneda.format(valor)} MXN`;
    }

    function fecha(valor: string): string {
        return new Date(valor).toLocaleDateString("es-MX", {
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

    function iniciales(nombre: string, apellido: string): string {
        const a = nombre.trim().charAt(0);
        const b = apellido.trim().charAt(0);
        return (a + b).toUpperCase();
    }

    function soloDigitos(texto: string): string {
        return texto.replace(/\D/g, "");
    }

    // 10 dígitos (o 52 + 10) -> enlace de WhatsApp. null si no es válido
    function enlaceWhatsApp(telefono: string): string | null {
        let digitos = soloDigitos(telefono);

        if (digitos.length === 12 && digitos.startsWith("52")) {
            digitos = digitos.slice(2);
        }

        return digitos.length === 10 ? `https://wa.me/52${digitos}` : null;
    }

    function abrirWhatsApp(telefono: string): void {
        const enlace = enlaceWhatsApp(telefono);

        if (!enlace) {
            avisar("El teléfono no tiene 10 dígitos para usar WhatsApp.", true);
            return;
        }

        window.open(enlace, "_blank");
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
                headers: opciones.body
                    ? { "Content-Type": "application/json" }
                    : undefined,
            });
        } catch {
            throw new ApiError(
                0,
                "No se pudo conectar con la API. Revisa que esté encendida (npm run dev dentro de la carpeta api)."
            );
        }

        const datos = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
            throw new ApiError(
                respuesta.status,
                datos?.error ?? "Ocurrió un error inesperado."
            );
        }

        return datos as T;
    }

    function mensajeDe(error: unknown): string {
        return error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado.";
    }

    
    // Lista de clientes
    async function cargarLista(): Promise<void> {
        const pedido = ++estado.pedidoLista;

        const parametros = new URLSearchParams({
            filtro: estado.filtro,
            busqueda: estado.busqueda,
            pagina: String(estado.pagina),
            limite: String(estado.limite),
        });

        try {
            const datos = await api<RespuestaLista>(`/clientes?${parametros}`);

            if (pedido !== estado.pedidoLista) return;

            estado.pagina = datos.pagina;
            pintarResumen(datos);
            pintarFilas(datos);
            pintarPaginacion(datos);
        } catch (error) {
            if (pedido !== estado.pedidoLista) return;

            filas.innerHTML = `<div class="cl-vacio error">${esc(mensajeDe(error))}</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
        }
    }

    function pintarResumen(datos: RespuestaLista): void {
        statTotal.textContent = String(datos.resumen.total);
        statSaldo.textContent = String(datos.resumen.conSaldo);
        statNuevas.textContent = String(datos.resumen.solicitudesNuevas);

        const nuevas = datos.resumen.solicitudesNuevas;

        if (nuevas > 0) {
            bannerTexto.textContent =
                nuevas === 1
                    ? "1 solicitud de cotización nueva llegó desde el catálogo web"
                    : `${nuevas} solicitudes de cotización nuevas llegaron desde el catálogo web`;
            banner.classList.remove("hidden");
        } else {
            banner.classList.add("hidden");
        }
    }

    function pintarFilas(datos: RespuestaLista): void {
        if (datos.items.length === 0) {
            const sinClientes =
                datos.resumen.total === 0
                    ? "Aún no hay clientes. Registra tu primer cliente para comenzar a cotizar."
                    : "No se encontraron clientes con esos criterios.";

            filas.innerHTML = `<div class="cl-vacio">${sinClientes}</div>`;
            contador.textContent = "";
            return;
        }

        filas.innerHTML = datos.items
            .map((c) => {
                const origen = c.origen === "WEB" ? "Catálogo web" : "Registro manual";

                const nueva = c.solicitudNueva
                    ? `<span class="cl-badge">Nueva</span>`
                    : "";

                const whatsapp = enlaceWhatsApp(c.telefono)
                    ? ""
                    : "disabled";

                return `
                <div class="cl-row" data-id="${esc(c.id)}">
                    <div class="cl-cliente">
                        <div class="cl-avatar">${esc(iniciales(c.nombre, c.apellido))}</div>
                        <div>
                            <span class="cl-nombre">${esc(c.nombre)} ${esc(c.apellido)}</span>
                            <div class="cl-origen ${c.origen === "WEB" ? "web" : ""}"><span>${origen}</span>${nueva}</div>
                        </div>
                    </div>

                    <div class="cl-telefono">
                        <span>${esc(c.telefono)}</span>
                        <button type="button" class="cl-btn cl-btn-outline cl-btn-small" data-accion="whatsapp" ${whatsapp}>WhatsApp</button>
                    </div>

                    <span class="cl-cell-muted">${esc(c.correo) || "—"}</span>
                    <span class="cl-cell-muted">${esc(c.direccion) || "—"}</span>
                    <strong>${c.totalPedidos}</strong>
                    <span class="${c.saldoPendiente > 0 ? "cl-saldo" : "cl-cell-muted"}">
                        ${c.saldoPendiente > 0 ? dinero(c.saldoPendiente) : "—"}
                    </span>

                    <div class="cl-acciones">
                        <button type="button" class="cl-link" data-accion="ver">Ver</button>
                        <button type="button" class="cl-link" data-accion="editar">Editar</button>
                        <button type="button" class="cl-link danger" data-accion="eliminar">Eliminar</button>
                    </div>
                </div>`;
            })
            .join("");

        const desde = (datos.pagina - 1) * datos.limite + 1;
        const hasta = desde + datos.items.length - 1;
        contador.textContent = `Mostrando ${desde}–${hasta} de ${datos.total} clientes`;
    }

    function pintarPaginacion(datos: RespuestaLista): void {
        if (datos.totalPaginas <= 1) {
            paginacion.innerHTML = "";
            return;
        }

        const botones: string[] = [];

        botones.push(
            `<button type="button" class="cl-page" data-pagina="${datos.pagina - 1}" ${datos.pagina === 1 ? "disabled" : ""} aria-label="Anterior">‹</button>`
        );

        for (let n = 1; n <= datos.totalPaginas; n++) {
            botones.push(
                `<button type="button" class="cl-page ${n === datos.pagina ? "active" : ""}" data-pagina="${n}">${n}</button>`
            );
        }

        botones.push(
            `<button type="button" class="cl-page" data-pagina="${datos.pagina + 1}" ${datos.pagina === datos.totalPaginas ? "disabled" : ""} aria-label="Siguiente">›</button>`
        );

        paginacion.innerHTML = botones.join("");
    }

    // Para editar, eliminar o abrir WhatsApp se pide el cliente a la API
    // y así nunca se trabaja con datos viejos de la tabla.
    async function buscarCliente(id: string): Promise<DatosCliente | null> {
        try {
            const datos = await api<RespuestaDetalle>(`/clientes/${encodeURIComponent(id)}`);
            return datos.cliente;
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
        }
    }

    // Detalle de un cliente
    const ETIQUETA_SOLICITUD: Record<string, [string, string]> = {
        NUEVA: ["Nueva", ""],
        EN_REVISION: ["En revisión", "cl-badge-gray"],
        VISITA_PROGRAMADA: ["Visita programada", "cl-badge-gray"],
        COTIZADA: ["Cotizada", "cl-badge-gray"],
        CANCELADA: ["Cancelada", "cl-badge-red"],
    };

    const ETIQUETA_COTIZACION: Record<string, [string, string]> = {
        BORRADOR: ["Borrador", "cl-badge-gray"],
        ENVIADA: ["Enviada", ""],
        APROBADA: ["Aprobada", "cl-badge-green"],
        RECHAZADA: ["Rechazada", "cl-badge-red"],
        VENCIDA: ["Vencida", "cl-badge-gray"],
    };

    const ETIQUETA_PEDIDO: Record<string, [string, string]> = {
        EN_PROCESO: ["En proceso", ""],
        LISTO_PARA_INSTALAR: ["Listo para instalar", ""],
        ENTREGADO: ["Entregado", "cl-badge-green"],
        FACTURADO: ["Facturado", "cl-badge-green"],
        CERRADO: ["Cerrado", "cl-badge-gray"],
        CANCELADO: ["Cancelado", "cl-badge-red"],
    };

    const ETIQUETA_CITA: Record<string, string> = {
        MEDICION: "Visita para medir",
        ENTREGA: "Entrega",
        INSTALACION: "Instalación",
    };

    const ETIQUETA_ESTADO_CITA: Record<string, [string, string]> = {
        PROGRAMADA: ["Programada", ""],
        REALIZADA: ["Realizada", "cl-badge-green"],
        CANCELADA: ["Cancelada", "cl-badge-red"],
        REPROGRAMADA: ["Reprogramada", "cl-badge-gray"],
    };

    function insignia(
        etiquetas: Record<string, [string, string]>,
        clave: string
    ): string {
        const [texto, clase] = etiquetas[clave] ?? [clave, "cl-badge-gray"];
        return `<span class="cl-badge ${clase}">${esc(texto)}</span>`;
    }

    // Código corto para mostrar (los ids reales son uuid largos)
    function codigo(id: string): string {
        return id.slice(0, 8).toUpperCase();
    }

    let detalleActual: RespuestaDetalle | null = null;

    async function abrirDetalle(id: string, pestana: Pestana = "solicitudes"): Promise<void> {
        estado.detalleId = id;
        estado.pestana = pestana;

        vistaLista.classList.add("hidden");
        vistaDetalle.classList.remove("hidden");
        vistaDetalle.innerHTML = `<div class="cl-vacio">Cargando…</div>`;

        try {
            detalleActual = await api<RespuestaDetalle>(`/clientes/${encodeURIComponent(id)}`);
            pintarDetalle();
        } catch (error) {
            vistaDetalle.innerHTML = `
                <button type="button" class="cl-btn cl-btn-outline" data-accion="volver">← Volver a clientes</button>
                <div class="cl-vacio error">${esc(mensajeDe(error))}</div>`;
        }
    }

    function volverALista(): void {
        estado.detalleId = null;
        detalleActual = null;

        vistaDetalle.classList.add("hidden");
        vistaDetalle.innerHTML = "";
        vistaLista.classList.remove("hidden");

        void cargarLista();
    }

    function pintarDetalle(): void {
        if (!detalleActual) return;

        const { cliente, finanzas } = detalleActual;
        const origen =
            cliente.origen === "WEB" ? "Catálogo web" : "Registro manual";
        const whatsapp = enlaceWhatsApp(cliente.telefono) ? "" : "disabled";

        vistaDetalle.innerHTML = `
            <button type="button" class="cl-btn cl-btn-outline" data-accion="volver">← Volver a clientes</button>

            <div class="cl-detalle-layout">

                <aside class="cl-panel cl-perfil">
                    <div class="cl-avatar">${esc(iniciales(cliente.nombre, cliente.apellido))}</div>
                    <h2>${esc(cliente.nombre)} ${esc(cliente.apellido)}</h2>
                    <span class="cl-badge cl-badge-gray">${origen}</span>

                    <div class="cl-perfil-datos">
                        <div class="cl-dato"><span>Teléfono</span><strong>${esc(cliente.telefono)}</strong></div>
                        <div class="cl-dato"><span>Correo</span><strong>${esc(cliente.correo) || "—"}</strong></div>
                        <div class="cl-dato"><span>Dirección</span><strong>${esc(cliente.direccion) || "—"}</strong></div>
                    </div>

                    <div class="cl-perfil-botones">
                        <button type="button" class="cl-btn cl-btn-outline" data-accion="editar-detalle">Editar</button>
                        <button type="button" class="cl-btn cl-btn-outline" data-accion="whatsapp-detalle" ${whatsapp}>Enviar WhatsApp</button>
                        <button type="button" class="cl-btn cl-btn-primary" data-accion="cotizar-cliente">Nueva cotización</button>
                    </div>
                </aside>

                <div>
                    <div class="cl-panel cl-finanzas">
                        <div class="cl-stat"><span>Anticipos recibidos</span><strong>${dinero(finanzas.anticipos)}</strong></div>
                        <div class="cl-stat"><span>Pagos realizados</span><strong>${dinero(finanzas.pagos)}</strong></div>
                        <div class="cl-stat"><span>Saldo pendiente</span><strong class="cl-accent">${dinero(finanzas.saldo)}</strong></div>
                    </div>

                    <div class="cl-panel">
                        <div class="cl-tabs">
                            ${pestanaBoton("solicitudes", "Solicitudes")}
                            ${pestanaBoton("cotizaciones", "Cotizaciones")}
                            ${pestanaBoton("pedidos", "Pedidos")}
                            ${pestanaBoton("agenda", "Agenda")}
                        </div>
                        <div id="cl-pestana-contenido">${contenidoPestana()}</div>
                    </div>
                </div>

            </div>`;
    }

    function pestanaBoton(clave: Pestana, texto: string): string {
        const activa = estado.pestana === clave ? "active" : "";
        return `<button type="button" class="cl-tab ${activa}" data-pestana="${clave}">${texto}</button>`;
    }

    function contenidoPestana(): string {
        if (!detalleActual) return "";

        const vacio = (texto: string) => `<div class="cl-vacio">${texto}</div>`;

        switch (estado.pestana) {
            case "solicitudes": {
                if (detalleActual.solicitudes.length === 0) {
                    return vacio("Este cliente aún no tiene solicitudes.");
                }

                return detalleActual.solicitudes
                    .map((s) => {
                        const origen =
                            s.origen === "WEB" ? "Catálogo web" : "Escritorio";
                        const pendiente = ["NUEVA", "EN_REVISION", "VISITA_PROGRAMADA"].includes(s.estado);
                        const puedeCotizar = s.estado !== "CANCELADA";

                        return `
                        <div class="cl-item">
                            <div>
                                <span class="cl-item-titulo">${esc(s.titulo)}</span>
                                <span class="cl-item-sub">${origen} · Recibida el ${fecha(s.creadoEn)}</span>
                            </div>
                            <div class="cl-item-lado">
                                ${insignia(ETIQUETA_SOLICITUD, s.estado)}
                                ${puedeCotizar ? `<button type="button" class="cl-btn ${pendiente ? "cl-btn-primary" : "cl-btn-outline"}" data-accion="cotizar-solicitud" data-solicitud="${esc(s.id)}">Cotizar</button>` : ""}
                            </div>
                        </div>`;
                    })
                    .join("");
            }

            case "cotizaciones": {
                if (detalleActual.cotizaciones.length === 0) {
                    return vacio("Este cliente aún no tiene cotizaciones.");
                }

                return detalleActual.cotizaciones
                    .map((c) => {
                        const vigencia = c.vigenciaHasta
                            ? ` · Vigente hasta ${fecha(c.vigenciaHasta)}`
                            : "";

                        return `
                        <div class="cl-item">
                            <div>
                                <span class="cl-item-titulo">Cotización #${codigo(c.id)} · ${dinero(c.total)}</span>
                                <span class="cl-item-sub">Creada el ${fecha(c.creadoEn)}${vigencia}</span>
                            </div>
                            <div class="cl-item-lado">${insignia(ETIQUETA_COTIZACION, c.estado)}</div>
                        </div>`;
                    })
                    .join("");
            }

            case "pedidos": {
                if (detalleActual.pedidos.length === 0) {
                    return vacio("Este cliente aún no tiene pedidos.");
                }

                return detalleActual.pedidos
                    .map(
                        (p) => `
                        <div class="cl-item">
                            <div>
                                <span class="cl-item-titulo">Pedido #${codigo(p.id)} · ${dinero(p.total)}</span>
                                <span class="cl-item-sub">Creado el ${fecha(p.creadoEn)} · Pagado ${dinero(p.pagado)} · Saldo ${dinero(p.saldo)}</span>
                            </div>
                            <div class="cl-item-lado">${insignia(ETIQUETA_PEDIDO, p.estado)}</div>
                        </div>`
                    )
                    .join("");
            }

            case "agenda": {
                if (detalleActual.citas.length === 0) {
                    return vacio("Este cliente aún no tiene citas programadas.");
                }

                return detalleActual.citas
                    .map(
                        (c) => `
                        <div class="cl-item">
                            <div>
                                <span class="cl-item-titulo">${esc(ETIQUETA_CITA[c.tipo] ?? c.tipo)}</span>
                                <span class="cl-item-sub">${fechaHora(c.inicio)}${c.direccion ? " · " + esc(c.direccion) : ""}</span>
                            </div>
                            <div class="cl-item-lado">${insignia(ETIQUETA_ESTADO_CITA, c.estado)}</div>
                        </div>`
                    )
                    .join("");
            }
        }
    }

    // Avisa al módulo de cotizaciones. Si nadie lo escucha, se informa.
    function pedirCotizacion(idCliente: string, idSolicitud?: string): void {
        const evento = new CustomEvent("gaona:cotizar", {
            detail: { idCliente, idSolicitud },
            cancelable: true,
        });

        const sinAtender = window.dispatchEvent(evento);

        if (sinAtender) {
            avisar("El módulo de cotizaciones todavía no está conectado.");
        }
    }

    
    // Formulario: nuevo y editar

    const nombresCampos = ["nombre", "apellido", "telefono", "correo", "direccion"] as const;

    function limpiarErrores(): void {
        for (const nombre of nombresCampos) {
            el<HTMLSpanElement>(`cl-e-${nombre}`).textContent = "";
            campos[nombre].parentElement?.classList.remove("has-error");
        }

        formError.classList.add("hidden");
        formError.textContent = "";
    }

    function errorCampo(nombre: (typeof nombresCampos)[number], mensaje: string): void {
        el<HTMLSpanElement>(`cl-e-${nombre}`).textContent = mensaje;
        campos[nombre].parentElement?.classList.add("has-error");
    }

    function abrirFormulario(cliente?: DatosCliente): void {
        limpiarErrores();

        estado.editandoId = cliente?.id ?? null;
        modalTitulo.textContent = cliente ? "Editar cliente" : "Nuevo cliente";

        campos.nombre.value = cliente?.nombre ?? "";
        campos.apellido.value = cliente?.apellido ?? "";
        campos.telefono.value = cliente?.telefono ?? "";
        campos.correo.value = cliente?.correo ?? "";
        campos.direccion.value = cliente?.direccion ?? "";

        modal.classList.remove("hidden");
        campos.nombre.focus();
    }

    function cerrarFormulario(): void {
        modal.classList.add("hidden");
        estado.editandoId = null;
    }

    // Misma validación que la API, para avisar antes de enviar
    function validarFormulario(): boolean {
        limpiarErrores();
        let valido = true;

        if (campos.nombre.value.trim() === "") {
            errorCampo("nombre", "El nombre es obligatorio.");
            valido = false;
        }

        if (campos.apellido.value.trim() === "") {
            errorCampo("apellido", "El apellido es obligatorio.");
            valido = false;
        }

        let telefono = soloDigitos(campos.telefono.value);
        if (telefono.length === 12 && telefono.startsWith("52")) {
            telefono = telefono.slice(2);
        }

        if (telefono.length !== 10) {
            errorCampo("telefono", "El teléfono debe tener 10 dígitos.");
            valido = false;
        }

        const correo = campos.correo.value.trim();
        if (correo !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
            errorCampo("correo", "El correo no es válido.");
            valido = false;
        }

        return valido;
    }

    async function guardarFormulario(): Promise<void> {
        if (estado.guardando || !validarFormulario()) return;

        const datos = {
            nombre: campos.nombre.value.trim(),
            apellido: campos.apellido.value.trim(),
            telefono: campos.telefono.value.trim(),
            correo: campos.correo.value.trim(),
            direccion: campos.direccion.value.trim(),
        };

        const editando = estado.editandoId;

        estado.guardando = true;
        btnGuardar.disabled = true;
        btnGuardar.textContent = "Guardando…";

        try {
            if (editando) {
                await api(`/clientes/${encodeURIComponent(editando)}`, {
                    method: "PUT",
                    body: JSON.stringify(datos),
                });
            } else {
                await api("/clientes", {
                    method: "POST",
                    body: JSON.stringify(datos),
                });
            }

            cerrarFormulario();
            avisar(editando ? "Cliente actualizado." : "Cliente guardado.");

            if (editando && estado.detalleId === editando) {
                await abrirDetalle(editando, estado.pestana);
            } else {
                estado.pagina = 1;
                await cargarLista();
            }
        } catch (error) {
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        } finally {
            estado.guardando = false;
            btnGuardar.disabled = false;
            btnGuardar.textContent = "Guardar cliente";
        }
    }

    
    // Eliminar
    function pedirEliminar(cliente: DatosCliente): void {
        estado.eliminando = cliente;
        confirmarTitulo.textContent = `¿Eliminar a ${cliente.nombre} ${cliente.apellido}?`;
        confirmar.classList.remove("hidden");
    }

    function cerrarConfirmar(): void {
        confirmar.classList.add("hidden");
        estado.eliminando = null;
    }

    async function eliminarConfirmado(): Promise<void> {
        const cliente = estado.eliminando;
        if (!cliente) return;

        btnConfirmarEliminar.disabled = true;

        try {
            await api(`/clientes/${encodeURIComponent(cliente.id)}`, {
                method: "DELETE",
            });

            cerrarConfirmar();
            avisar("Cliente eliminado.");
            await cargarLista();
        } catch (error) {
            cerrarConfirmar();
            avisar(mensajeDe(error), true);
        } finally {
            btnConfirmarEliminar.disabled = false;
        }
    }

    
    // Eventos
    
    // Al entrar a la sección Clientes se carga la lista
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="clientes"]')
        ?.addEventListener("click", () => {
            if (estado.detalleId) {
                volverALista();
            } else {
                void cargarLista();
            }
        });

    el("cl-nuevo").addEventListener("click", () => abrirFormulario());

    el("cl-ver-solicitudes").addEventListener("click", () => {
        estado.filtro = "nueva";
        estado.pagina = 1;
        chips.forEach((c) =>
            c.classList.toggle("active", c.dataset.filtro === "nueva")
        );
        void cargarLista();
    });

    // Filtros
    chips.forEach((chip) => {
        chip.addEventListener("click", () => {
            estado.filtro = (chip.dataset.filtro as Filtro) ?? "todos";
            estado.pagina = 1;
            chips.forEach((c) => c.classList.toggle("active", c === chip));
            void cargarLista();
        });
    });

    // Buscador (espera a que dejes de escribir para no saturar la API)
    let temporizadorBusqueda: number | undefined;

    buscador.addEventListener("input", () => {
        window.clearTimeout(temporizadorBusqueda);
        temporizadorBusqueda = window.setTimeout(() => {
            estado.busqueda = buscador.value.trim();
            estado.pagina = 1;
            void cargarLista();
        }, 300);
    });

    // Paginación
    paginacion.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>("[data-pagina]");
        if (!boton || boton.disabled) return;

        estado.pagina = Number(boton.dataset.pagina);
        void cargarLista();
    });

    // Acciones de cada fila de la tabla
    filas.addEventListener("click", async (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>("[data-accion]");
        const fila = (evento.target as HTMLElement).closest<HTMLElement>(".cl-row");

        if (!boton || !fila || boton.disabled) return;

        const id = fila.dataset.id ?? "";

        try {
            if (boton.dataset.accion === "ver") {
                await abrirDetalle(id);
                return;
            }

            const cliente = await buscarCliente(id);

            if (!cliente) {
                avisar("El cliente ya no existe.", true);
                await cargarLista();
                return;
            }

            switch (boton.dataset.accion) {
                case "whatsapp":
                    abrirWhatsApp(cliente.telefono);
                    break;
                case "editar":
                    abrirFormulario(cliente);
                    break;
                case "eliminar":
                    pedirEliminar(cliente);
                    break;
            }
        } catch (error) {
            avisar(mensajeDe(error), true);
        }
    });

    // Acciones dentro de la vista de detalle
    vistaDetalle.addEventListener("click", (evento) => {
        const objetivo = evento.target as HTMLElement;

        const pestana = objetivo.closest<HTMLButtonElement>("[data-pestana]");
        if (pestana) {
            estado.pestana = pestana.dataset.pestana as Pestana;
            pintarDetalle();
            return;
        }

        const boton = objetivo.closest<HTMLButtonElement>("[data-accion]");
        if (!boton || boton.disabled || !detalleActual) return;

        const { cliente } = detalleActual;

        switch (boton.dataset.accion) {
            case "volver":
                volverALista();
                break;
            case "editar-detalle":
                abrirFormulario(cliente);
                break;
            case "whatsapp-detalle":
                abrirWhatsApp(cliente.telefono);
                break;
            case "cotizar-cliente":
                pedirCotizacion(cliente.id);
                break;
            case "cotizar-solicitud":
                pedirCotizacion(cliente.id, boton.dataset.solicitud);
                break;
        }
    });

    // Formulario
    form.addEventListener("submit", (evento) => {
        evento.preventDefault();
        void guardarFormulario();
    });

    el("cl-modal-cerrar").addEventListener("click", cerrarFormulario);
    el("cl-form-cancelar").addEventListener("click", cerrarFormulario);

    // Confirmación de eliminar
    el("cl-confirm-cancelar").addEventListener("click", cerrarConfirmar);
    btnConfirmarEliminar.addEventListener("click", () => void eliminarConfirmado());

    // Clic fuera de la ventana o tecla Escape para cerrar
    for (const capa of [modal, confirmar]) {
        capa.addEventListener("mousedown", (evento) => {
            if (evento.target !== capa) return;

            if (capa === modal) cerrarFormulario();
            else cerrarConfirmar();
        });
    }

    document.addEventListener("keydown", (evento) => {
        if (evento.key !== "Escape") return;

        if (!confirmar.classList.contains("hidden")) cerrarConfirmar();
        else if (!modal.classList.contains("hidden")) cerrarFormulario();
    });
})();