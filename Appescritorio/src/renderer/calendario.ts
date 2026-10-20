
type TipoEventoAgenda = "visita" | "instalacion";

interface EventoAgenda {
    fecha: string;
    hora: string;
    tipo: TipoEventoAgenda;
    titulo: string;
    direccion: string;
}

const agendaDias = document.getElementById("agenda-dias");
const agendaTitulo = document.getElementById("agenda-mes-titulo");
const agendaFecha = document.getElementById("agenda-fecha-seleccionada");
const agendaTotal = document.getElementById("agenda-total-eventos");
const agendaEventos = document.getElementById("agenda-lista-eventos");
const agendaAnterior = document.getElementById("agenda-anterior");
const agendaSiguiente = document.getElementById("agenda-siguiente");
const agendaHoy = document.getElementById("agenda-hoy");

let agendaMes: Date = new Date();
agendaMes.setDate(1);

let agendaSeleccionada: Date = new Date();

// Por ahora no hay citas registradas.
const eventosAgenda: EventoAgenda[] = [];

function fechaAgenda(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, "0");
    const dia = String(fecha.getDate()).padStart(2, "0");

    return `${anio}-${mes}-${dia}`;
}

function dibujarAgenda(): void {
    if (
        !agendaDias ||
        !agendaTitulo ||
        !agendaFecha ||
        !agendaTotal ||
        !agendaEventos
    ) {
        console.error(
            "Agenda: no se encontraron todos los elementos HTML."
        );
        return;
    }

    agendaTitulo.textContent = agendaMes.toLocaleDateString("es-MX", {
        month: "long",
        year: "numeric"
    });

    agendaDias.replaceChildren();

    const primerDia = new Date(
        agendaMes.getFullYear(),
        agendaMes.getMonth(),
        1
    );

    const inicio = (primerDia.getDay() + 6) % 7;

    const cantidadDias = new Date(
        agendaMes.getFullYear(),
        agendaMes.getMonth() + 1,
        0
    ).getDate();

    const hoy = fechaAgenda(new Date());
    const seleccionada = fechaAgenda(agendaSeleccionada);

    for (let i = 0; i < cantidadDias; i++) {
        const numeroDia = i + 1;

        const fecha = new Date(
            agendaMes.getFullYear(),
            agendaMes.getMonth(),
            numeroDia
        );

        const clave = fechaAgenda(fecha);

        // Los espacios iniciales alinean el día 1 con su día de la semana.
        if (i === 0) {
            for (let espacio = 0; espacio < inicio; espacio++) {
                const celdaVacia = document.createElement("div");
                celdaVacia.className = "agenda-day-vacio";
                agendaDias.append(celdaVacia);
            }
        }

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "agenda-day";
        boton.setAttribute(
            "aria-label",
            fecha.toLocaleDateString("es-MX")
        );

        if (clave === hoy) {
            boton.classList.add("hoy");
        }

        if (clave === seleccionada) {
            boton.classList.add("seleccionado");
        }

        const numero = document.createElement("span");
        numero.className = "agenda-day-numero";
        numero.textContent = String(numeroDia);

        const indicadores = document.createElement("span");
        indicadores.className = "agenda-day-indicadores";

        eventosAgenda
            .filter((evento: EventoAgenda) => evento.fecha === clave)
            .forEach((evento: EventoAgenda) => {
                const punto = document.createElement("i");
                punto.className = `agenda-dot ${evento.tipo}`;
                indicadores.append(punto);
            });

        boton.append(numero, indicadores);

        boton.addEventListener("click", () => {
            agendaSeleccionada = fecha;
            dibujarAgenda();
        });

        agendaDias.append(boton);
    }

    agendaFecha.textContent = agendaSeleccionada.toLocaleDateString(
        "es-MX",
        {
            weekday: "long",
            day: "numeric",
            month: "long"
        }
    );

    const delDia = eventosAgenda.filter(
        (evento: EventoAgenda) =>
            evento.fecha === fechaAgenda(agendaSeleccionada)
    );

    agendaTotal.textContent =
        `${delDia.length} actividades programadas`;

    agendaEventos.replaceChildren();

    if (delDia.length === 0) {
        const vacio = document.createElement("div");
        vacio.className = "agenda-empty";

        const mensaje = document.createElement("p");
        mensaje.textContent =
            "No hay visitas ni instalaciones registradas para este día.";

        const tituloVacio = document.createElement("strong");
        tituloVacio.textContent = "Sin actividades";

        vacio.append(tituloVacio, mensaje);
        agendaEventos.append(vacio);
        return;
    }

    delDia.forEach((evento: EventoAgenda) => {
        const tarjeta = document.createElement("article");
        tarjeta.className = `agenda-event tipo-${evento.tipo}`;

        const hora = document.createElement("div");
        hora.className = "agenda-event-hora";
        hora.textContent = evento.hora;

        const titulo = document.createElement("h4");
        titulo.textContent = evento.titulo;

        const tipo = document.createElement("p");
        tipo.textContent = evento.tipo === "visita"
            ? "Visita para medir"
            : "Instalación";

        const direccion = document.createElement("p");
        direccion.textContent =
            evento.direccion || "Sin dirección registrada";

        tarjeta.append(hora, titulo, tipo, direccion);
        agendaEventos.append(tarjeta);
    });
}

agendaAnterior?.addEventListener("click", () => {
    agendaMes = new Date(
        agendaMes.getFullYear(),
        agendaMes.getMonth() - 1,
        1
    );

    dibujarAgenda();
});

agendaSiguiente?.addEventListener("click", () => {
    agendaMes = new Date(
        agendaMes.getFullYear(),
        agendaMes.getMonth() + 1,
        1
    );

    dibujarAgenda();
});

agendaHoy?.addEventListener("click", () => {
    agendaSeleccionada = new Date();

    agendaMes = new Date(
        agendaSeleccionada.getFullYear(),
        agendaSeleccionada.getMonth(),
        1
    );

    dibujarAgenda();
});

dibujarAgenda();
