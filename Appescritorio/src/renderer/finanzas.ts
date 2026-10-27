// ========================================
// Módulo de finanzas (app de escritorio)
// Anticipos, pagos y saldos pendientes de cada pedido
// ========================================
(() => {
    const API_URL = "http://localhost:3000";

    // Tipos de lo que responde la API
    type Filtro = "todos" | "saldo" | "sinAnticipo" | "liquidados";
    type Pestana = "cuentas" | "historial";
    type TipoPago = "ANTICIPO" | "PARCIAL" | "LIQUIDACION";
    type MetodoPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO";

    interface Resumen {
        porCobrar: number;
        anticiposRecibidos: number;
        cobradoMes: number;
        pedidosConSaldo: number;
    }

    interface Pagina<T> {
        items: T[];
        total: number;
        pagina: number;
        limite: number;
        totalPaginas: number;
    }

    interface Cuenta {
        id: string;
        folio: string;
        estado: string;
        cliente: { nombre: string; apellido: string; telefono: string };
        total: number;
        pagado: number;
        saldo: number;
        tieneAnticipo: boolean;
    }

    interface PagoFila {
        id: string;
        idPedido: string;
        folio: string;
        tipo: TipoPago;
        metodo: MetodoPago;
        monto: number;
        referencia: string | null;
        fecha: string;
        cliente: string;
        registradoPor: string;
    }

    interface PedidoPendiente {
        id: string;
        folio: string;
        cliente: string;
        total: number;
        saldo: number;
        tieneAnticipo: boolean;
    }

    interface DetallePedido {
        id: string;
        folio: string;
        estado: string;
        creadoEn: string;
        cliente: {
            nombre: string;
            apellido: string;
            telefono: string;
            correo: string | null;
        };
        total: number;
        pagado: number;
        saldo: number;
        anticipoRequerido: number | null;
        anticipoPagado: number;
        pagos: {
            id: string;
            tipo: TipoPago;
            metodo: MetodoPago;
            monto: number;
            referencia: string | null;
            fecha: string;
            registradoPor: string;
        }[];
    }

    class ApiError extends Error {
        status: number;

        constructor(status: number, mensaje: string) {
            super(mensaje);
            this.status = status;
        }
    }

    // Textos que se muestran en pantalla
    const ESTADOS_PEDIDO: Record<string, { texto: string; clase: string }> = {
        EN_PROCESO: { texto: "En proceso", clase: "cl-badge-gray" },
        LISTO_PARA_INSTALAR: { texto: "Listo para instalar", clase: "" },
        ENTREGADO: { texto: "Entregado", clase: "cl-badge-green" },
        FACTURADO: { texto: "Facturado", clase: "cl-badge-green" },
        CERRADO: { texto: "Cerrado", clase: "cl-badge-gray" },
        CANCELADO: { texto: "Cancelado", clase: "cl-badge-red" },
    };

    const TIPOS_PAGO: Record<TipoPago, string> = {
        ANTICIPO: "Anticipo",
        PARCIAL: "Pago parcial",
        LIQUIDACION: "Liquidación",
    };

    const METODOS_PAGO: Record<MetodoPago, string> = {
        EFECTIVO: "Efectivo",
        TRANSFERENCIA: "Transferencia",
        TARJETA: "Tarjeta",
        OTRO: "Otro",
    };

    // Estado del módulo
    const estado = {
        pestana: "cuentas" as Pestana,
        filtro: "todos" as Filtro,
        busqueda: "",
        pagina: 1,
        limite: 8,
        peticion: 0, // evita que una respuesta lenta pise a una más nueva
        pendientes: [] as PedidoPendiente[],
        guardando: false,
    };

    // Elementos de la pantalla
    function el<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    const statPorCobrar = el<HTMLElement>("fin-stat-cobrar");
    const statAnticipos = el<HTMLElement>("fin-stat-anticipos");
    const statMes = el<HTMLElement>("fin-stat-mes");
    const statMesEtiqueta = el<HTMLElement>("fin-stat-mes-etiqueta");
    const statConSaldo = el<HTMLElement>("fin-stat-saldo");

    const buscador = el<HTMLInputElement>("fin-buscar");
    const chipsContenedor = el<HTMLDivElement>("fin-chips");
    const chips = chipsContenedor.querySelectorAll<HTMLButtonElement>(".fin-chip");
    const pestanas = document.querySelectorAll<HTMLButtonElement>(".fin-tab");

    const tablaCuentas = el<HTMLDivElement>("fin-tabla-cuentas");
    const tablaHistorial = el<HTMLDivElement>("fin-tabla-historial");
    const filasCuentas = el<HTMLDivElement>("fin-filas-cuentas");
    const filasHistorial = el<HTMLDivElement>("fin-filas-historial");
    const contador = el<HTMLSpanElement>("fin-contador");
    const paginacion = el<HTMLDivElement>("fin-paginacion");

    const modal = el<HTMLDivElement>("fin-modal");
    const form = el<HTMLFormElement>("fin-form");
    const btnGuardar = el<HTMLButtonElement>("fin-form-guardar");
    const formError = el<HTMLDivElement>("fin-form-error");

    const campos = {
        pedido: el<HTMLSelectElement>("fin-f-pedido"),
        tipo: el<HTMLSelectElement>("fin-f-tipo"),
        metodo: el<HTMLSelectElement>("fin-f-metodo"),
        monto: el<HTMLInputElement>("fin-f-monto"),
        referencia: el<HTMLInputElement>("fin-f-referencia"),
        fecha: el<HTMLInputElement>("fin-f-fecha"),
    };

    const errores = {
        pedido: el<HTMLSpanElement>("fin-e-pedido"),
        tipo: el<HTMLSpanElement>("fin-e-tipo"),
        metodo: el<HTMLSpanElement>("fin-e-metodo"),
        monto: el<HTMLSpanElement>("fin-e-monto"),
        referencia: el<HTMLSpanElement>("fin-e-referencia"),
        fecha: el<HTMLSpanElement>("fin-e-fecha"),
    };

    const ayudaPedido = el<HTMLSpanElement>("fin-ayuda-pedido");
    const ayudaMonto = el<HTMLSpanElement>("fin-ayuda-monto");

    const modalDetalle = el<HTMLDivElement>("fin-detalle");
    const detalleContenido = el<HTMLDivElement>("fin-detalle-contenido");
    const toast = el<HTMLDivElement>("fin-toast");

    // Utilidades
    // Evita que un texto con < o & rompa la pantalla
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

    function fecha(valor: string): string {
        return new Date(valor).toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    function iniciales(nombre: string, apellido: string): string {
        return (nombre.trim().charAt(0) + apellido.trim().charAt(0)).toUpperCase();
    }

    // Fecha de hoy en formato yyyy-mm-dd (hora local, no UTC)
    function hoy(): string {
        const ahora = new Date();
        const mes = String(ahora.getMonth() + 1).padStart(2, "0");
        const dia = String(ahora.getDate()).padStart(2, "0");
        return `${ahora.getFullYear()}-${mes}-${dia}`;
    }

    function redondear(valor: number): number {
        return Math.round(valor * 100) / 100;
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

    // Resumen (tarjetas de arriba)
    async function cargarResumen(): Promise<void> {
        try {
            const datos = await api<Resumen>("/finanzas/resumen");

            statPorCobrar.textContent = dinero(datos.porCobrar);
            statAnticipos.textContent = dinero(datos.anticiposRecibidos);
            statMes.textContent = dinero(datos.cobradoMes);
            statConSaldo.textContent = String(datos.pedidosConSaldo);
        } catch (error) {
            avisar(mensajeDe(error), true);
        }

        const mes = new Date().toLocaleDateString("es-MX", { month: "long" });
        statMesEtiqueta.textContent = `Cobrado en ${mes}`;
    }

    // Cuentas por cobrar
    async function cargarCuentas(): Promise<void> {
        const peticion = ++estado.peticion;

        const parametros = new URLSearchParams({
            filtro: estado.filtro,
            busqueda: estado.busqueda,
            pagina: String(estado.pagina),
            limite: String(estado.limite),
        });

        try {
            const datos = await api<Pagina<Cuenta>>(`/finanzas/cuentas?${parametros}`);

            if (peticion !== estado.peticion) return;

            estado.pagina = datos.pagina;
            pintarCuentas(datos);
            pintarPaginacion(datos);
        } catch (error) {
            if (peticion !== estado.peticion) return;

            filasCuentas.innerHTML = `<div class="cl-vacio error">${esc(mensajeDe(error))}</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
        }
    }

    function pintarCuentas(datos: Pagina<Cuenta>): void {
        if (datos.items.length === 0) {
            const hayFiltros = estado.busqueda !== "" || estado.filtro !== "todos";

            filasCuentas.innerHTML = `<div class="cl-vacio">${
                hayFiltros
                    ? "No se encontraron pedidos con esos criterios."
                    : "Aún no hay pedidos. Cuando una cotización sea aprobada y se convierta en pedido, aparecerá aquí."
            }</div>`;
            contador.textContent = "";
            return;
        }

        filasCuentas.innerHTML = datos.items
            .map((c) => {
                const porcentaje =
                    c.total > 0 ? Math.min(100, (c.pagado / c.total) * 100) : 0;
                const liquidado = c.saldo <= 0;
                const infoEstado = ESTADOS_PEDIDO[c.estado] ?? {
                    texto: c.estado,
                    clase: "cl-badge-gray",
                };
                const sinAnticipo =
                    !c.tieneAnticipo && !liquidado
                        ? '<span class="cl-badge">Sin anticipo</span>'
                        : "";

                return `
                <div class="fin-row fin-row-cuentas">
                    <span class="fin-folio">#${esc(c.folio)}</span>

                    <div class="fin-cliente">
                        <div class="cl-avatar">${esc(iniciales(c.cliente.nombre, c.cliente.apellido))}</div>
                        <div>
                            <strong class="fin-nombre">${esc(c.cliente.nombre)} ${esc(c.cliente.apellido)}</strong>
                            <span class="fin-sub">${esc(c.cliente.telefono)}</span>
                        </div>
                    </div>

                    <div class="fin-badges">
                        <span class="cl-badge ${infoEstado.clase}">${esc(infoEstado.texto)}</span>
                        ${sinAnticipo}
                    </div>

                    <span>${dinero(c.total)}</span>

                    <div class="fin-pagado">
                        <span>${dinero(c.pagado)}</span>
                        <div class="fin-barra"><div class="fin-barra-relleno${liquidado ? " completa" : ""}" style="width:${porcentaje.toFixed(0)}%"></div></div>
                    </div>

                    ${
                        liquidado
                            ? '<span class="cl-badge cl-badge-green">Liquidado</span>'
                            : `<span class="fin-saldo">${dinero(c.saldo)}</span>`
                    }

                    <div class="fin-acciones">
                        ${
                            liquidado
                                ? ""
                                : `<button type="button" class="cl-link" data-accion="pagar" data-id="${esc(c.id)}">Registrar pago</button>`
                        }
                        <button type="button" class="cl-link" data-accion="detalle" data-id="${esc(c.id)}">Ver detalle</button>
                    </div>
                </div>`;
            })
            .join("");

        contador.textContent =
            datos.total === 1 ? "1 pedido" : `${datos.total} pedidos`;
    }

    // Historial de pagos
    async function cargarHistorial(): Promise<void> {
        const peticion = ++estado.peticion;

        const parametros = new URLSearchParams({
            busqueda: estado.busqueda,
            pagina: String(estado.pagina),
            limite: String(estado.limite),
        });

        try {
            const datos = await api<Pagina<PagoFila>>(`/finanzas/pagos?${parametros}`);

            if (peticion !== estado.peticion) return;

            estado.pagina = datos.pagina;
            pintarHistorial(datos);
            pintarPaginacion(datos);
        } catch (error) {
            if (peticion !== estado.peticion) return;

            filasHistorial.innerHTML = `<div class="cl-vacio error">${esc(mensajeDe(error))}</div>`;
            contador.textContent = "";
            paginacion.innerHTML = "";
        }
    }

    function pintarHistorial(datos: Pagina<PagoFila>): void {
        if (datos.items.length === 0) {
            filasHistorial.innerHTML = `<div class="cl-vacio">${
                estado.busqueda !== ""
                    ? "No se encontraron pagos con esa búsqueda."
                    : "Todavía no se ha registrado ningún pago."
            }</div>`;
            contador.textContent = "";
            return;
        }

        filasHistorial.innerHTML = datos.items
            .map(
                (p) => `
                <div class="fin-row fin-row-historial">
                    <span>${fecha(p.fecha)}</span>
                    <span class="fin-folio">#${esc(p.folio)}</span>
                    <span class="fin-nombre">${esc(p.cliente)}</span>
                    <span><span class="cl-badge ${p.tipo === "ANTICIPO" ? "" : p.tipo === "LIQUIDACION" ? "cl-badge-green" : "cl-badge-gray"}">${esc(TIPOS_PAGO[p.tipo])}</span></span>
                    <span>${esc(METODOS_PAGO[p.metodo])}</span>
                    <span class="fin-monto">${dinero(p.monto)}</span>
                    <span class="fin-sub">${esc(p.referencia) || "—"}</span>
                </div>`
            )
            .join("");

        contador.textContent =
            datos.total === 1 ? "1 pago" : `${datos.total} pagos`;
    }

    // Paginación (la misma para las dos pestañas)
    function pintarPaginacion(datos: Pagina<unknown>): void {
        if (datos.totalPaginas <= 1) {
            paginacion.innerHTML = "";
            return;
        }

        let botones = `<button class="fin-page" type="button" data-pagina="${datos.pagina - 1}" ${
            datos.pagina <= 1 ? "disabled" : ""
        } aria-label="Anterior">‹</button>`;

        for (let n = 1; n <= datos.totalPaginas; n++) {
            botones += `<button class="fin-page${
                n === datos.pagina ? " active" : ""
            }" type="button" data-pagina="${n}">${n}</button>`;
        }

        botones += `<button class="fin-page" type="button" data-pagina="${datos.pagina + 1}" ${
            datos.pagina >= datos.totalPaginas ? "disabled" : ""
        } aria-label="Siguiente">›</button>`;

        paginacion.innerHTML = botones;
    }

    // Recarga lo que se ve en pantalla
    function recargarLista(): Promise<void> {
        return estado.pestana === "cuentas" ? cargarCuentas() : cargarHistorial();
    }

    function recargarTodo(): void {
        void cargarResumen();
        void recargarLista();
    }

    function cambiarPestana(pestana: Pestana): void {
        estado.pestana = pestana;
        estado.pagina = 1;

        pestanas.forEach((boton) => {
            boton.classList.toggle("active", boton.dataset.pestana === pestana);
        });

        const enCuentas = pestana === "cuentas";

        tablaCuentas.classList.toggle("hidden", !enCuentas);
        tablaHistorial.classList.toggle("hidden", enCuentas);
        chipsContenedor.classList.toggle("hidden", !enCuentas);

        buscador.placeholder = enCuentas
            ? "Buscar por cliente o número de pedido..."
            : "Buscar por cliente, pedido o referencia...";

        contador.textContent = "";
        paginacion.innerHTML = "";

        void recargarLista();
    }

    // Formulario: registrar pago
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

    function pedidoElegido(): PedidoPendiente | undefined {
        return estado.pendientes.find((p) => p.id === campos.pedido.value);
    }

    // Ajusta tipos permitidos y la ayuda del monto según el pedido elegido
    function actualizarFormulario(): void {
        const pedido = pedidoElegido();
        const opcionAnticipo = campos.tipo.querySelector<HTMLOptionElement>(
            'option[value="ANTICIPO"]'
        );

        if (!pedido) {
            ayudaPedido.textContent = "";
            ayudaMonto.textContent = "";
            campos.monto.readOnly = false;
            if (opcionAnticipo) opcionAnticipo.disabled = false;
            return;
        }

        ayudaPedido.textContent = `Total ${dinero(pedido.total)} · Saldo pendiente ${dinero(pedido.saldo)}`;

        // Un pedido solo tiene un anticipo
        if (opcionAnticipo) {
            opcionAnticipo.disabled = pedido.tieneAnticipo;

            if (pedido.tieneAnticipo && campos.tipo.value === "ANTICIPO") {
                campos.tipo.value = "PARCIAL";
            }
        }

        if (campos.tipo.value === "LIQUIDACION") {
            // La liquidación siempre cubre todo el saldo
            campos.monto.value = pedido.saldo.toFixed(2);
            campos.monto.readOnly = true;
            ayudaMonto.textContent = "La liquidación cubre todo el saldo pendiente.";
        } else {
            if (campos.monto.readOnly) campos.monto.value = "";
            campos.monto.readOnly = false;
            ayudaMonto.textContent = `Máximo ${dinero(pedido.saldo)}. Si cubre todo el saldo, usa Liquidación.`;
        }
    }

    async function abrirFormulario(idPedido?: string): Promise<void> {
        form.reset();
        limpiarErrores();
        campos.fecha.value = hoy();
        campos.fecha.max = hoy();
        campos.monto.readOnly = false;
        ayudaPedido.textContent = "";
        ayudaMonto.textContent = "";

        try {
            const datos = await api<{ items: PedidoPendiente[] }>(
                "/finanzas/pedidos-pendientes"
            );
            estado.pendientes = datos.items;
        } catch (error) {
            avisar(mensajeDe(error), true);
            return;
        }

        if (estado.pendientes.length === 0) {
            avisar("No hay pedidos con saldo pendiente para registrar pagos.", true);
            return;
        }

        campos.pedido.innerHTML =
            '<option value="">Selecciona un pedido</option>' +
            estado.pendientes
                .map(
                    (p) =>
                        `<option value="${esc(p.id)}">#${esc(p.folio)} · ${esc(p.cliente)} · saldo ${dinero(p.saldo)}</option>`
                )
                .join("");

        if (idPedido && estado.pendientes.some((p) => p.id === idPedido)) {
            campos.pedido.value = idPedido;
        }

        // Si el pedido aún no tiene anticipo, se sugiere ese tipo
        const elegido = pedidoElegido();
        campos.tipo.value = elegido && !elegido.tieneAnticipo ? "ANTICIPO" : "PARCIAL";

        actualizarFormulario();
        modal.classList.remove("hidden");
        (idPedido ? campos.monto : campos.pedido).focus();
    }

    function cerrarFormulario(): void {
        if (estado.guardando) return;
        modal.classList.add("hidden");
    }

    function validarFormulario(): { ok: boolean; monto: number } {
        limpiarErrores();
        let ok = true;

        const pedido = pedidoElegido();
        const monto = redondear(Number(campos.monto.value));

        if (!pedido) {
            mostrarError("pedido", "Selecciona un pedido.");
            ok = false;
        }

        if (campos.monto.value.trim() === "" || !Number.isFinite(monto) || monto <= 0) {
            mostrarError("monto", "Escribe un monto mayor a 0.");
            ok = false;
        } else if (pedido && monto > pedido.saldo) {
            mostrarError("monto", `El monto supera el saldo (${dinero(pedido.saldo)}).`);
            ok = false;
        } else if (
            pedido &&
            campos.tipo.value !== "LIQUIDACION" &&
            monto === pedido.saldo
        ) {
            mostrarError("monto", "Cubre todo el saldo: usa el tipo Liquidación.");
            ok = false;
        }

        if (campos.referencia.value.trim().length > 100) {
            mostrarError("referencia", "La referencia es demasiado larga.");
            ok = false;
        }

        if (campos.fecha.value === "") {
            mostrarError("fecha", "Selecciona la fecha del pago.");
            ok = false;
        } else if (campos.fecha.value > hoy()) {
            mostrarError("fecha", "La fecha no puede ser futura.");
            ok = false;
        }

        return { ok, monto };
    }

    async function guardarPago(): Promise<void> {
        if (estado.guardando) return;

        const { ok, monto } = validarFormulario();
        if (!ok) return;

        estado.guardando = true;
        btnGuardar.disabled = true;
        btnGuardar.textContent = "Guardando...";

        try {
            await api("/finanzas/pagos", {
                method: "POST",
                body: JSON.stringify({
                    idPedido: campos.pedido.value,
                    tipo: campos.tipo.value,
                    metodo: campos.metodo.value,
                    monto,
                    referencia: campos.referencia.value.trim() || undefined,
                    fecha: campos.fecha.value,
                }),
            });

            estado.guardando = false;
            modal.classList.add("hidden");
            avisar("Pago registrado correctamente.");
            recargarTodo();
        } catch (error) {
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        } finally {
            estado.guardando = false;
            btnGuardar.disabled = false;
            btnGuardar.textContent = "Guardar pago";
        }
    }

    // Detalle de un pedido
    async function abrirDetalle(idPedido: string): Promise<void> {
        detalleContenido.innerHTML = '<div class="cl-vacio">Cargando...</div>';
        modalDetalle.classList.remove("hidden");

        try {
            const d = await api<DetallePedido>(
                `/finanzas/pedidos/${encodeURIComponent(idPedido)}`
            );

            const infoEstado = ESTADOS_PEDIDO[d.estado] ?? {
                texto: d.estado,
                clase: "cl-badge-gray",
            };

            let anticipoTexto = "No se requiere anticipo";

            if (d.anticipoRequerido !== null) {
                anticipoTexto =
                    d.anticipoPagado >= d.anticipoRequerido
                        ? `Cubierto (${dinero(d.anticipoPagado)} de ${dinero(d.anticipoRequerido)})`
                        : `Pendiente (${dinero(d.anticipoPagado)} de ${dinero(d.anticipoRequerido)})`;
            }

            const pagos =
                d.pagos.length === 0
                    ? '<div class="cl-vacio">Este pedido todavía no tiene pagos.</div>'
                    : d.pagos
                          .map(
                              (p) => `
                        <div class="fin-pago-item">
                            <div>
                                <strong>${esc(TIPOS_PAGO[p.tipo])} · ${esc(METODOS_PAGO[p.metodo])}</strong>
                                <span class="fin-sub">${fecha(p.fecha)} · ${esc(p.registradoPor)}${
                                    p.referencia ? ` · Ref. ${esc(p.referencia)}` : ""
                                }</span>
                            </div>
                            <strong class="fin-monto">${dinero(p.monto)}</strong>
                        </div>`
                          )
                          .join("");

            detalleContenido.innerHTML = `
                <div class="cl-modal-head">
                    <div>
                        <h3>Pedido #${esc(d.folio)}</h3>
                        <span class="fin-subtitulo">${esc(d.cliente.nombre)} ${esc(d.cliente.apellido)} · ${esc(d.cliente.telefono)}</span>
                    </div>
                    <button class="cl-close" type="button" data-accion="cerrar-detalle" aria-label="Cerrar">×</button>
                </div>

                <div class="fin-detalle-resumen">
                    <div><span>Total</span><strong>${dinero(d.total)}</strong></div>
                    <div><span>Pagado</span><strong>${dinero(d.pagado)}</strong></div>
                    <div><span>Saldo</span><strong class="fin-saldo">${dinero(d.saldo)}</strong></div>
                </div>

                <div class="fin-detalle-datos">
                    <div><span>Estado del pedido</span><span class="cl-badge ${infoEstado.clase}">${esc(infoEstado.texto)}</span></div>
                    <div><span>Anticipo</span><strong>${esc(anticipoTexto)}</strong></div>
                </div>

                <h4 class="fin-detalle-titulo">Pagos registrados</h4>
                <div class="fin-pagos-lista">${pagos}</div>

                <div class="cl-modal-actions">
                    <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar-detalle">Cerrar</button>
                    ${
                        d.saldo > 0 && d.estado !== "CANCELADO"
                            ? `<button class="cl-btn cl-btn-primary" type="button" data-accion="pagar-desde-detalle" data-id="${esc(d.id)}">Registrar pago</button>`
                            : ""
                    }
                </div>`;
        } catch (error) {
            detalleContenido.innerHTML = `<div class="cl-vacio error">${esc(mensajeDe(error))}</div>
                <div class="cl-modal-actions">
                    <button class="cl-btn cl-btn-outline" type="button" data-accion="cerrar-detalle">Cerrar</button>
                </div>`;
        }
    }

    // Eventos
    // Al entrar a la sección Finanzas se cargan los datos
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="finanzas"]')
        ?.addEventListener("click", () => {
            recargarTodo();
        });

    el("fin-nuevo").addEventListener("click", () => void abrirFormulario());

    // Buscador (con una pequeña espera para no consultar en cada tecla)
    let temporizadorBusqueda: number | undefined;

    buscador.addEventListener("input", () => {
        window.clearTimeout(temporizadorBusqueda);

        temporizadorBusqueda = window.setTimeout(() => {
            estado.busqueda = buscador.value.trim();
            estado.pagina = 1;
            void recargarLista();
        }, 300);
    });

    // Filtros de cuentas por cobrar
    chips.forEach((chip) => {
        chip.addEventListener("click", () => {
            estado.filtro = (chip.dataset.filtro as Filtro) ?? "todos";
            estado.pagina = 1;

            chips.forEach((c) => c.classList.toggle("active", c === chip));

            void cargarCuentas();
        });
    });

    // Pestañas
    pestanas.forEach((boton) => {
        boton.addEventListener("click", () => {
            const pestana = boton.dataset.pestana as Pestana;
            if (pestana !== estado.pestana) cambiarPestana(pestana);
        });
    });

    // Paginación
    paginacion.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>(
            "[data-pagina]"
        );
        if (!boton || boton.disabled) return;

        estado.pagina = Number(boton.dataset.pagina);
        void recargarLista();
    });

    // Acciones de cada fila de cuentas por cobrar
    filasCuentas.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>(
            "[data-accion]"
        );
        if (!boton) return;

        const id = boton.dataset.id ?? "";

        if (boton.dataset.accion === "pagar") void abrirFormulario(id);
        if (boton.dataset.accion === "detalle") void abrirDetalle(id);
    });

    // Acciones dentro del detalle
    modalDetalle.addEventListener("click", (evento) => {
        const objetivo = evento.target as HTMLElement;

        // Clic en el fondo oscuro
        if (objetivo === modalDetalle) {
            modalDetalle.classList.add("hidden");
            return;
        }

        const boton = objetivo.closest<HTMLButtonElement>("[data-accion]");
        if (!boton) return;

        if (boton.dataset.accion === "cerrar-detalle") {
            modalDetalle.classList.add("hidden");
        }

        if (boton.dataset.accion === "pagar-desde-detalle") {
            modalDetalle.classList.add("hidden");
            void abrirFormulario(boton.dataset.id ?? "");
        }
    });

    // Formulario
    campos.pedido.addEventListener("change", () => {
        const elegido = pedidoElegido();

        if (elegido) {
            campos.tipo.value = !elegido.tieneAnticipo ? "ANTICIPO" : "PARCIAL";
        }

        actualizarFormulario();
    });

    campos.tipo.addEventListener("change", actualizarFormulario);

    el("fin-modal-cerrar").addEventListener("click", cerrarFormulario);
    el("fin-form-cancelar").addEventListener("click", cerrarFormulario);

    form.addEventListener("submit", (evento) => {
        evento.preventDefault();
        void guardarPago();
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