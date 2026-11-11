// ========================================
// Agenda (app de escritorio)
// Lee y guarda las citas en la API (/citas):
// visitas para medir, instalaciones y entregas.
// ========================================
(() => {
    const API_URL = "http://localhost:3001";

    type TipoCita = "MEDICION" | "INSTALACION" | "ENTREGA";
    type EstadoCita = "PROGRAMADA" | "REPROGRAMADA" | "REALIZADA" | "CANCELADA";

    interface Cita {
        id: string;
        tipo: TipoCita;
        estado: EstadoCita;
        fecha: string;
        horaInicio: string;
        horaFin: string;
        direccion: string | null;
        notas: string | null;
        idResponsable: string;
        responsable: string;
        cliente: string;
        telefono: string | null;
        folioPedido: string | null;
    }

    interface Opciones {
        responsables: { id: string; nombre: string }[];
        solicitudes: { id: string; estado: string; cliente: string; direccion: string | null; productos: string }[];
        pedidos: { id: string; folio: string; estado: string; cliente: string; direccion: string | null }[];
    }

    const TIPOS: Record<TipoCita, { texto: string; clase: string }> = {
        MEDICION: { texto: "Visita para medir", clase: "visita" },
        INSTALACION: { texto: "Instalación", clase: "instalacion" },
        ENTREGA: { texto: "Entrega", clase: "entrega" },
    };

    const ESTADOS: Record<EstadoCita, { texto: string; clase: string }> = {
        PROGRAMADA: { texto: "Programada", clase: "" },
        REPROGRAMADA: { texto: "Reprogramada", clase: "" },
        REALIZADA: { texto: "Realizada", clase: "cl-badge-green" },
        CANCELADA: { texto: "Cancelada", clase: "cl-badge-red" },
    };

    const esActiva = (c: Cita) => c.estado === "PROGRAMADA" || c.estado === "REPROGRAMADA";

    // Estado del módulo
    let mes = new Date();
    mes.setDate(1);
    let seleccionada = new Date();
    let CITAS: Cita[] = [];
    let OPCIONES: Opciones = { responsables: [], solicitudes: [], pedidos: [] };
    let reprogramando: Cita | null = null; // null = cita nueva
    let ocupado = false;

    function el<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    const dias = el<HTMLDivElement>("agenda-dias");
    const titulo = el<HTMLElement>("agenda-mes-titulo");
    const fechaTitulo = el<HTMLElement>("agenda-fecha-seleccionada");
    const total = el<HTMLElement>("agenda-total-eventos");
    const lista = el<HTMLDivElement>("agenda-lista-eventos");
    const toast = el<HTMLDivElement>("ag-toast");

    const modal = el<HTMLDivElement>("ag-modal");
    const form = el<HTMLFormElement>("ag-form");
    const formError = el<HTMLDivElement>("ag-form-error");
    const botonGuardar = el<HTMLButtonElement>("ag-form-guardar");

    const campos = {
        tipo: el<HTMLSelectElement>("ag-f-tipo"),
        para: el<HTMLSelectElement>("ag-f-para"),
        responsable: el<HTMLSelectElement>("ag-f-responsable"),
        fecha: el<HTMLInputElement>("ag-f-fecha"),
        inicio: el<HTMLInputElement>("ag-f-inicio"),
        fin: el<HTMLInputElement>("ag-f-fin"),
        direccion: el<HTMLInputElement>("ag-f-direccion"),
        notas: el<HTMLTextAreaElement>("ag-f-notas"),
    };

    const errores = {
        para: el<HTMLSpanElement>("ag-e-para"),
        responsable: el<HTMLSpanElement>("ag-e-responsable"),
        fecha: el<HTMLSpanElement>("ag-e-fecha"),
        hora: el<HTMLSpanElement>("ag-e-hora"),
    };

    // Utilidades
    function esc(texto: string | null | undefined): string {
        return (texto ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function clave(fecha: Date): string {
        const m = String(fecha.getMonth() + 1).padStart(2, "0");
        const d = String(fecha.getDate()).padStart(2, "0");
        return `${fecha.getFullYear()}-${m}-${d}`;
    }

    let temporizadorAviso: number | undefined;

    function avisar(mensaje: string, esError = false): void {
        toast.textContent = mensaje;
        toast.classList.toggle("error", esError);
        toast.classList.remove("hidden");
        window.clearTimeout(temporizadorAviso);
        temporizadorAviso = window.setTimeout(() => toast.classList.add("hidden"), 4500);
    }

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
        if (!respuesta.ok) throw new Error(datos?.error ?? "Ocurrió un error inesperado.");
        return datos as T;
    }

    function mensajeDe(error: unknown): string {
        return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
    }

    // ---------- Datos ----------
    async function cargarMes(): Promise<void> {
        const desde = clave(new Date(mes.getFullYear(), mes.getMonth(), 1));
        const hasta = clave(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));

        try {
            const datos = await api<{ items: Cita[] }>(`/citas?desde=${desde}&hasta=${hasta}`);
            CITAS = datos.items;
        } catch (error) {
            CITAS = [];
            avisar(mensajeDe(error), true);
        }

        dibujar();
    }

    // ---------- Calendario ----------
    function dibujar(): void {
        titulo.textContent = mes.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
        dias.replaceChildren();

        const desfase = (new Date(mes.getFullYear(), mes.getMonth(), 1).getDay() + 6) % 7;
        const cantidad = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
        const hoy = clave(new Date());
        const elegido = clave(seleccionada);

        // Los espacios iniciales alinean el día 1 con su día de la semana
        for (let i = 0; i < desfase; i++) {
            const vacio = document.createElement("div");
            vacio.className = "agenda-day-vacio";
            dias.append(vacio);
        }

        for (let n = 1; n <= cantidad; n++) {
            const fecha = new Date(mes.getFullYear(), mes.getMonth(), n);
            const k = clave(fecha);

            const boton = document.createElement("button");
            boton.type = "button";
            boton.className = "agenda-day";
            boton.setAttribute("aria-label", fecha.toLocaleDateString("es-MX"));
            if (k === hoy) boton.classList.add("hoy");
            if (k === elegido) boton.classList.add("seleccionado");

            const numero = document.createElement("span");
            numero.className = "agenda-day-numero";
            numero.textContent = String(n);

            // Un punto por cada cita activa del día
            const indicadores = document.createElement("span");
            indicadores.className = "agenda-day-indicadores";
            CITAS.filter((c) => c.fecha === k && esActiva(c)).forEach((c) => {
                const punto = document.createElement("i");
                punto.className = `agenda-dot ${TIPOS[c.tipo].clase}`;
                indicadores.append(punto);
            });

            boton.append(numero, indicadores);
            boton.addEventListener("click", () => {
                seleccionada = fecha;
                dibujar();
            });
            dias.append(boton);
        }

        dibujarDia();
    }

    function dibujarDia(): void {
        fechaTitulo.textContent = seleccionada.toLocaleDateString("es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
        });

        const delDia = CITAS.filter((c) => c.fecha === clave(seleccionada));
        const activas = delDia.filter(esActiva).length;
        total.textContent = activas === 1 ? "1 actividad programada" : `${activas} actividades programadas`;

        if (delDia.length === 0) {
            lista.innerHTML = `
                <div class="agenda-empty">
                    <strong>Sin actividades</strong>
                    <p>No hay visitas, instalaciones ni entregas para este día.</p>
                </div>`;
            return;
        }

        lista.innerHTML = delDia
            .map((c) => {
                const estado = ESTADOS[c.estado];
                const acciones = esActiva(c)
                    ? `<div class="agenda-event-acciones">
                        <button type="button" class="cl-btn cl-btn-primary cl-btn-small" data-accion="realizada" data-id="${esc(c.id)}">Realizada</button>
                        <button type="button" class="cl-btn cl-btn-outline cl-btn-small" data-accion="reprogramar" data-id="${esc(c.id)}">Reprogramar</button>
                        <button type="button" class="cl-btn cl-btn-danger cl-btn-small" data-accion="cancelar" data-id="${esc(c.id)}">Cancelar</button>
                    </div>`
                    : "";

                return `
                <article class="agenda-event tipo-${TIPOS[c.tipo].clase}${esActiva(c) ? "" : " inactiva"}${c.estado === "CANCELADA" ? " cancelada" : ""}">
                    <div class="agenda-event-top">
                        <div class="agenda-event-hora">${esc(c.horaInicio)} – ${esc(c.horaFin)}</div>
                        ${c.estado !== "PROGRAMADA" ? `<span class="cl-badge ${estado.clase}">${esc(estado.texto)}</span>` : ""}
                    </div>
                    <h4>${esc(c.cliente)}</h4>
                    <p>${esc(TIPOS[c.tipo].texto)}${c.folioPedido ? ` · Pedido #${esc(c.folioPedido)}` : ""}</p>
                    <p>${esc(c.direccion || "Sin dirección registrada")}</p>
                    ${c.telefono ? `<p>Tel. ${esc(c.telefono)}</p>` : ""}
                    <p>Responsable: ${esc(c.responsable)}</p>
                    ${c.notas ? `<p>Notas: ${esc(c.notas)}</p>` : ""}
                    ${acciones}
                </article>`;
            })
            .join("");
    }

    // ---------- Acciones de una cita ----------
    async function cambiar(id: string, accion: "realizada" | "cancelar"): Promise<void> {
        const cita = CITAS.find((c) => c.id === id);
        if (!cita || ocupado) return;

        if (accion === "cancelar" && !window.confirm(`¿Cancelar la cita de ${cita.cliente} a las ${cita.horaInicio}?`)) {
            return;
        }

        ocupado = true;
        try {
            await api(`/citas/${encodeURIComponent(id)}`, {
                method: "PATCH",
                body: JSON.stringify({ accion }),
            });
            avisar(accion === "realizada" ? "Cita marcada como realizada." : "Cita cancelada.");
        } catch (error) {
            avisar(mensajeDe(error), true);
        } finally {
            ocupado = false;
        }

        await cargarMes();
    }

    // ---------- Formulario ----------
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

    // La lista "Para" cambia según el tipo: solicitudes para medir, pedidos para instalar o entregar
    function pintarPara(): void {
        const esMedicion = campos.tipo.value === "MEDICION";
        el("ag-f-para-label").textContent = esMedicion ? "Solicitud a medir*" : "Pedido*";

        const opciones = esMedicion
            ? OPCIONES.solicitudes.map(
                  (s) => `<option value="${esc(s.id)}">${esc(s.cliente)}${s.productos ? ` · ${esc(s.productos)}` : ""}</option>`
              )
            : OPCIONES.pedidos.map(
                  (p) => `<option value="${esc(p.id)}">#${esc(p.folio)} · ${esc(p.cliente)}</option>`
              );

        const vacio = esMedicion ? "No hay solicitudes abiertas" : "No hay pedidos activos";
        campos.para.innerHTML = opciones.length
            ? `<option value="">Selecciona…</option>${opciones.join("")}`
            : `<option value="">${vacio}</option>`;

        llenarDireccion();
    }

    function llenarDireccion(): void {
        const id = campos.para.value;
        const encontrado =
            OPCIONES.solicitudes.find((s) => s.id === id) ?? OPCIONES.pedidos.find((p) => p.id === id);
        campos.direccion.value = encontrado?.direccion ?? "";
    }

    function mostrarCamposDeNueva(mostrar: boolean): void {
        ["ag-campo-tipo", "ag-campo-para", "ag-campo-direccion", "ag-campo-notas"].forEach((id) =>
            el(id).classList.toggle("hidden", !mostrar)
        );
    }

    async function abrirFormulario(cita?: Cita): Promise<void> {
        reprogramando = cita ?? null;
        form.reset();
        limpiarErrores();

        const hoy = clave(new Date());
        campos.fecha.min = hoy;

        el("ag-modal-titulo").textContent = cita ? "Reprogramar cita" : "Nueva cita";
        el("ag-modal-subtitulo").textContent = cita
            ? `${cita.cliente} · ${TIPOS[cita.tipo].texto}`
            : "Los campos con * son obligatorios.";
        botonGuardar.textContent = cita ? "Guardar cambios" : "Agendar cita";
        mostrarCamposDeNueva(!cita);

        campos.responsable.innerHTML = '<option value="">Cargando…</option>';
        modal.classList.remove("hidden");

        try {
            OPCIONES = await api<Opciones>("/citas/opciones");
        } catch (error) {
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        }

        campos.responsable.innerHTML =
            '<option value="">Selecciona…</option>' +
            OPCIONES.responsables.map((r) => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join("");

        if (cita) {
            campos.responsable.value = cita.idResponsable;
            campos.fecha.value = cita.fecha < hoy ? hoy : cita.fecha;
            campos.inicio.value = cita.horaInicio;
            campos.fin.value = cita.horaFin;
        } else {
            // Por omisión: quien inició sesión, el día elegido en el calendario (si no es pasado)
            campos.responsable.value = window.gaonaSesion?.actual()?.id ?? "";
            const elegido = clave(seleccionada);
            campos.fecha.value = elegido < hoy ? hoy : elegido;
            campos.inicio.value = "10:00";
            campos.fin.value = "11:00";
            pintarPara();
        }
    }

    function cerrarFormulario(): void {
        modal.classList.add("hidden");
    }

    async function guardar(): Promise<void> {
        if (ocupado) return;
        limpiarErrores();
        let ok = true;

        if (!reprogramando && !campos.para.value) {
            mostrarError("para", campos.tipo.value === "MEDICION" ? "Selecciona la solicitud." : "Selecciona el pedido.");
            ok = false;
        }
        if (!campos.responsable.value) {
            mostrarError("responsable", "Selecciona al responsable.");
            ok = false;
        }
        if (!campos.fecha.value) {
            mostrarError("fecha", "Selecciona la fecha.");
            ok = false;
        } else if (campos.fecha.value < clave(new Date())) {
            mostrarError("fecha", "La fecha no puede ser pasada.");
            ok = false;
        }
        if (!campos.inicio.value || !campos.fin.value || campos.fin.value <= campos.inicio.value) {
            mostrarError("hora", "La hora de fin debe ser después de la de inicio.");
            ok = false;
        }
        if (!ok) return;

        ocupado = true;
        botonGuardar.disabled = true;

        try {
            if (reprogramando) {
                await api(`/citas/${encodeURIComponent(reprogramando.id)}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        accion: "reprogramar",
                        fecha: campos.fecha.value,
                        horaInicio: campos.inicio.value,
                        horaFin: campos.fin.value,
                        idResponsable: campos.responsable.value,
                    }),
                });
            } else {
                const esMedicion = campos.tipo.value === "MEDICION";
                await api("/citas", {
                    method: "POST",
                    body: JSON.stringify({
                        tipo: campos.tipo.value,
                        idSolicitud: esMedicion ? campos.para.value : null,
                        idPedido: esMedicion ? null : campos.para.value,
                        idResponsable: campos.responsable.value,
                        fecha: campos.fecha.value,
                        horaInicio: campos.inicio.value,
                        horaFin: campos.fin.value,
                        direccion: campos.direccion.value.trim() || null,
                        notas: campos.notas.value.trim() || null,
                    }),
                });
            }

            const eraReprogramacion = reprogramando !== null;
            cerrarFormulario();

            // El calendario salta al día de la cita
            const [a, m, d] = campos.fecha.value.split("-").map(Number);
            seleccionada = new Date(a, m - 1, d);
            mes = new Date(a, m - 1, 1);
            avisar(eraReprogramacion ? "Cita reprogramada." : "Cita agendada.");
            await cargarMes();
        } catch (error) {
            formError.textContent = mensajeDe(error);
            formError.classList.remove("hidden");
        } finally {
            ocupado = false;
            botonGuardar.disabled = false;
        }
    }

    // ---------- Eventos ----------
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="agenda"]')
        ?.addEventListener("click", () => void cargarMes());

    el("agenda-anterior").addEventListener("click", () => {
        mes = new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
        void cargarMes();
    });

    el("agenda-siguiente").addEventListener("click", () => {
        mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1);
        void cargarMes();
    });

    el("agenda-hoy").addEventListener("click", () => {
        seleccionada = new Date();
        mes = new Date(seleccionada.getFullYear(), seleccionada.getMonth(), 1);
        void cargarMes();
    });

    el("agenda-nueva").addEventListener("click", () => void abrirFormulario());

    lista.addEventListener("click", (evento) => {
        const boton = (evento.target as HTMLElement).closest<HTMLButtonElement>("[data-accion]");
        if (!boton) return;

        const id = boton.dataset.id ?? "";
        const accion = boton.dataset.accion;

        if (accion === "realizada" || accion === "cancelar") void cambiar(id, accion);
        if (accion === "reprogramar") {
            const cita = CITAS.find((c) => c.id === id);
            if (cita) void abrirFormulario(cita);
        }
    });

    campos.tipo.addEventListener("change", pintarPara);
    campos.para.addEventListener("change", llenarDireccion);

    // Al cambiar la hora de inicio, la de fin se recorre una hora si quedó antes
    campos.inicio.addEventListener("change", () => {
        if (campos.inicio.value && (!campos.fin.value || campos.fin.value <= campos.inicio.value)) {
            const [h, m] = campos.inicio.value.split(":").map(Number);
            campos.fin.value = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
    });

    el("ag-modal-cerrar").addEventListener("click", cerrarFormulario);
    el("ag-form-cancelar").addEventListener("click", cerrarFormulario);
    modal.addEventListener("click", (evento) => {
        if (evento.target === modal) cerrarFormulario();
    });

    form.addEventListener("submit", (evento) => {
        evento.preventDefault();
        void guardar();
    });

    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape" && !modal.classList.contains("hidden")) cerrarFormulario();
    });

    dibujar();
})();
