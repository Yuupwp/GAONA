// ========================================
// Pantalla de Inicio (app de escritorio)
// ========================================
(() => {
    const API_URL = "http://127.0.0.1:3001";

    type EstadoPedido = "EN_PROCESO" | "LISTO_PARA_INSTALAR";
    type TipoCita = "MEDICION" | "ENTREGA" | "INSTALACION";

    interface ResumenInicio {
        solicitudesNuevas: number;
        pedidosPendientes: number;
        citasHoy: number;
        cobradoMes: number;
        pedidos: {
            id: string;
            folio: string;
            cliente: string;
            fecha: string | null;
            estado: EstadoPedido;
        }[];
        citas: {
            id: string;
            tipo: TipoCita;
            horaInicio: string;
            horaFin: string;
            direccion: string | null;
            cliente: string;
            responsable: string;
        }[];
    }

    const ESTADOS: Record<EstadoPedido, { texto: string; clase: string }> = {
        EN_PROCESO: { texto: "En proceso", clase: "processing" },
        LISTO_PARA_INSTALAR: { texto: "Listo para instalar", clase: "pending" },
    };

    const CITAS: Record<TipoCita, { texto: string; indicador: string }> = {
        MEDICION: { texto: "Visita para medir", indicador: "quote-indicator" },
        ENTREGA: { texto: "Entrega", indicador: "order-indicator" },
        INSTALACION: { texto: "Instalación", indicador: "client-indicator" },
    };

    const statSolicitudes = document.getElementById("inicio-stat-solicitudes");
    const statCitas = document.getElementById("inicio-stat-citas");
    const statPedidos = document.getElementById("inicio-stat-pedidos");
    const statCobrado = document.getElementById("inicio-stat-cobrado");
    const listaPedidos = document.getElementById("inicio-pedidos-lista");
    const listaCitas = document.getElementById("inicio-citas-lista");
    const botonVerPedidos = document.getElementById("inicio-ver-pedidos");
    const pantallaPrincipal = document.getElementById("main-screen");

    // Si falta alguno de estos elementos, no hay nada que pintar
    if (!statSolicitudes || !statCitas || !statPedidos || !statCobrado || !listaPedidos || !listaCitas) {
        return;
    }

    const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

    // Los nombres vienen de la base: se escapan antes de ponerlos en el HTML
    function esc(texto: string): string {
        return texto
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // "2026-11-11" -> "11/11/2026"
    function fechaCorta(valor: string | null): string {
        if (!valor) return "—";
        const [anio, mes, dia] = valor.split("-");
        return `${dia}/${mes}/${anio}`;
    }

    function pintarPedidos(pedidos: ResumenInicio["pedidos"]): void {
        if (pedidos.length === 0) {
            listaPedidos!.innerHTML = '<p class="home-empty">No hay pedidos pendientes.</p>';
            return;
        }

        listaPedidos!.innerHTML = pedidos
            .map((p) => {
                const estado = ESTADOS[p.estado];
                return `
                    <div class="home-order-row">
                        <span class="home-order-number">#${esc(p.folio)}</span>
                        <span>${esc(p.cliente)}</span>
                        <span>${fechaCorta(p.fecha)}</span>
                        <span>
                            <span class="home-status ${estado.clase}">${estado.texto}</span>
                        </span>
                    </div>`;
            })
            .join("");
    }

    function pintarCitas(citas: ResumenInicio["citas"]): void {
        if (citas.length === 0) {
            listaCitas!.innerHTML = '<p class="home-empty">No hay citas programadas para hoy.</p>';
            return;
        }

        listaCitas!.innerHTML = citas
            .map((c) => {
                const tipo = CITAS[c.tipo];
                const lugar = c.direccion ? ` · ${esc(c.direccion)}` : "";
                return `
                    <div class="home-activity-item">
                        <div class="activity-indicator ${tipo.indicador}"></div>
                        <div class="home-activity-info">
                            <strong>${tipo.texto} · ${esc(c.cliente)}</strong>
                            <p>${c.horaInicio} – ${c.horaFin}${lugar}</p>
                            <span>Responsable: ${esc(c.responsable)}</span>
                        </div>
                    </div>`;
            })
            .join("");
    }

    function limpiar(): void {
        for (const elemento of [statSolicitudes, statCitas, statPedidos, statCobrado]) elemento!.textContent = "—";
        listaPedidos!.replaceChildren();
        listaCitas!.replaceChildren();
    }

    async function recargar(): Promise<void> {
        if (!window.gaonaSesion.puede("inicio")) { limpiar(); return; }
        try {
            const respuesta = await window.gaonaApiFetch(`${API_URL}/inicio/resumen`);
            const datos = await respuesta.json().catch(() => null);

            if (!respuesta.ok) {
                throw new Error(datos?.error ?? "No se pudo cargar el resumen.");
            }

            const resumen = datos as ResumenInicio;

            statSolicitudes!.textContent = String(resumen.solicitudesNuevas);
            statCitas!.textContent = String(resumen.citasHoy);
            statPedidos!.textContent = String(resumen.pedidosPendientes);
            statCobrado!.textContent = dinero.format(resumen.cobradoMes);

            pintarPedidos(resumen.pedidos);
            pintarCitas(resumen.citas);
        } catch {
            listaPedidos!.innerHTML =
                '<p class="home-empty">No se pudo conectar con la API. Revisa que esté encendida.</p>';
            listaCitas!.innerHTML = '<p class="home-empty">No se pudo conectar con la API.</p>';
        }
    }

    // "Ver todos" lleva al módulo de Pedidos
    botonVerPedidos?.addEventListener("click", () => {
        document
            .querySelector<HTMLButtonElement>('.menu-item[data-section="pedidos"]')
            ?.click();
    });

    // Se actualiza cada vez que se abre Inicio...
    document
        .querySelector<HTMLButtonElement>('.menu-item[data-section="inicio"]')
        ?.addEventListener("click", () => void recargar());

    // ...y cuando termina el login y aparece la pantalla principal
    if (pantallaPrincipal) {
        new MutationObserver(() => {
            if (!pantallaPrincipal.classList.contains("hidden")) void recargar();
        }).observe(pantallaPrincipal, { attributes: true, attributeFilter: ["class"] });
    }

    document.addEventListener("gaona:sesion", () => {
        if (!window.gaonaSesion.puede("inicio")) limpiar();
    });
    void recargar();
})();