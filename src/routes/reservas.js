// rutas de las reservas
// el estudiante reserva su comida y aca se guarda en la base,
// tambien se calcula cuantas minutas hay por fecha para la cocina

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol, leerToken } from "../config/auth.js";
import { crearNotificacion } from "./notificaciones.js";
import { limiteFormularios } from "../config/rateLimit.js";
import { leerSettings } from "../config/settings.js";

const router = Router();

// Fechas y horas SIEMPRE en America/Bogota. Render corre en UTC y
// new Date() daria 5 horas antes; sacamos las partes con Intl.
const ZONA_HORARIA = "America/Bogota";

// Partes de la fecha actual (+ desfase en dias) segun la hora de Bogota
function partesBogota(desfaseDias = 0) {
  const momentanea = new Date(Date.now() + desfaseDias * 24 * 60 * 60 * 1000);
  const partes = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(momentanea);
  const tomar = (tipo) => partes.find((p) => p.type === tipo)?.value || "";
  return {
    anio: tomar("year"),
    mes: tomar("month"),
    dia: tomar("day"),
    hora: tomar("hour"),
    minuto: tomar("minute"),
  };
}

function fechaDe(partes) {
  return `${partes.anio}-${partes.mes}-${partes.dia}`;
}

// Fecha de hoy en formato YYYY-MM-DD (hora de Colombia)
function fechaHoy() {
  return fechaDe(partesBogota());
}

// Fecha dentro de N dias (hora de Colombia); acepta negativos
function fechaDesdeHoy(dias) {
  return fechaDe(partesBogota(dias));
}

// Dia de semana de una fecha YYYY-MM-DD: 0 domingo ... 6 sabado
function diaSemana(fechaTexto) {
  const [anio, mes, dia] = fechaTexto.split("-").map(Number);
  return new Date(anio, mes - 1, dia).getDay();
}

// Hora actual en formato HH:MM (hora de Colombia)
function horaActual() {
  const p = partesBogota();
  return `${p.hora}:${p.minuto}`;
}

// Valida contra la configuracion si ya paso la hora limite para hoy.
// Se usa tanto para reservar como para cancelar. Devuelve null si
// se puede seguir, o el mensaje de error si el dia ya cerro.
async function errorSiDiaCerrado(fecha, accion) {
  const hoy = fechaHoy();
  if (fecha !== hoy) return null;

  const settings = await leerSettings();
  const limite = settings.hora_limite_reserva;
  if (!limite) return null;

  if (horaActual() > limite) {
    return `El límite para ${accion} hoy es a las ${limite} y ya pasó esa hora. Intenta mañana.`;
  }
  return null;
}

// Valida que una fecha sea real (YYYY-MM-DD) y este dentro del rango
// permitido (desde hoy hasta 60 dias). Devuelve un mensaje o null.
// Esto protege la base: si llega un año con demasiados digitos o una
// fecha imposible, se rechaza antes de guardar.
export function validarFecha(fecha) {
  // Debe tener exactamente el formato YYYY-MM-DD
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return "La fecha debe tener el formato año-mes-día (ej: 2026-08-10).";
  }

  // Verifica que sea una fecha real: 2026-02-31 no existe
  const [año, mes, dia] = fecha.split("-").map(Number);
  const fechaObj = new Date(año, mes - 1, dia);
  if (
    fechaObj.getFullYear() !== año ||
    fechaObj.getMonth() !== mes - 1 ||
    fechaObj.getDate() !== dia
  ) {
    return "Esa fecha no existe.";
  }

  // Rango permitido: desde hoy hasta 60 dias (hora de Colombia)
  const hoyTexto = fechaHoy();
  const maxTexto = fechaDesdeHoy(60);

  if (fecha < hoyTexto) {
    return "La fecha no puede ser anterior a hoy.";
  }
  if (fecha > maxTexto) {
    return "Solo se pueden reservar hasta 60 días antes de la fecha.";
  }

  // No hay servicio de alimentacion los fines de semana
  const diaSemana = fechaObj.getDay();
  if (diaSemana === 0 || diaSemana === 6) {
    return "Los sábados y domingos no hay servicio de alimentación. Elige un día entre lunes y viernes.";
  }

  return null;
}

// GET /api/reservas
// Lista todas las reservas (equipo con rol: cocina, profesor, coordinador)
router.get("/", requiereRol("admin", "cocina", "profesor", "coordinador"), async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("reservas")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/reservas/totales
// Total de reservas agrupadas por fecha (para que cocina sepa cuantas
// minutas preparar). Acepta ?desde=YYYY-MM-DD y ?hasta=YYYY-MM-DD para
// limitar a un rango de fechas (semanas o meses).
router.get("/totales", async (req, res) => {
  let consulta = getSupabase()
    .from("reservas")
    .select("fecha, asistio");

  if (req.query.desde) {
    consulta = consulta.gte("fecha", req.query.desde);
  }
  if (req.query.hasta) {
    consulta = consulta.lte("fecha", req.query.hasta);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });

  // Contamos cuantas reservas hay por cada fecha y cuantas asistieron
  const totales = {};
  for (const reserva of data) {
    const fecha = reserva.fecha;
    if (!totales[fecha]) {
      totales[fecha] = { reservas: 0, asistieron: 0 };
    }
    totales[fecha].reservas += 1;
    if (reserva.asistio) {
      totales[fecha].asistieron += 1;
    }
  }

  res.json(totales);
});

// GET /api/reservas/mis?documento=...  (debe ir antes de /:id)
// Reservas propias de un estudiante: exige su token y que coincida con el documento.
router.get("/mis", limiteFormularios, async (req, res) => {
  // Solo el dueno del documento (sesion de estudiante) puede ver sus
  // reservas: se exige el token y que coincida con el documento.
  const token = leerToken(req);
  if (!token) {
    return res.status(401).json({
      error: "Debes ingresar con tu documento y PIN para ver tus reservas.",
    });
  }
  const { documento } = req.query;
  if (!documento) {
    return res.status(400).json({ error: "Falta el documento" });
  }
  const docLimpio = String(documento).replace(/[\s.\-]/g, "");
  if (
      String(token.sub).replace(/[\s.\-]/g, "") !== docLimpio
    ) {
    return res
      .status(403)
      .json({ error: "El token no coincide con el documento" });
  }

  const { data, error } = await getSupabase()
    .from("reservas")
    .select("*")
    .eq("documento", docLimpio)
    .order("fecha", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/reservas/reporte?desde&hasta
// Desperdicio: reservadas vs servidas vs no asistieron, por sede y turno.
router.get("/reporte", async (req, res) => {
  let consulta = getSupabase()
    .from("reservas")
    .select("fecha, asistio, sede, turno");

  if (req.query.desde) {
    consulta = consulta.gte("fecha", req.query.desde);
  }
  if (req.query.hasta) {
    consulta = consulta.lte("fecha", req.query.hasta);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });

  let total = 0;
  let asistieron = 0;
  for (const reserva of data) {
    total += 1;
    if (reserva.asistio) asistieron += 1;
  }

  const desperdicio = total - asistieron;

  // porcentaje de desperdicio, evitando dividir entre cero
  let porcentaje = 0;
  if (total > 0) {
    porcentaje = Math.round((desperdicio / total) * 100);
  }

  // Desglose por sede: cuantas reservas y cuantas asistieron en cada una
  const porSede = {};
  // Desglose por turno: almuerzo / refrigerio
  const porTurno = {};
  for (const reserva of data) {
    const sede = reserva.sede || "Sin sede";
    if (!porSede[sede]) porSede[sede] = { reservas: 0, asistieron: 0 };
    porSede[sede].reservas += 1;
    if (reserva.asistio) porSede[sede].asistieron += 1;

    const turno = reserva.turno || "Sin turno";
    if (!porTurno[turno]) porTurno[turno] = { reservas: 0, asistieron: 0 };
    porTurno[turno].reservas += 1;
    if (reserva.asistio) porTurno[turno].asistieron += 1;
  }

  res.json({
    totalReservas: total,
    minutasServidas: asistieron,
    minutasDesperdiciadas: desperdicio,
    porcentajeDesperdicio: porcentaje,
    porSede,
    porTurno,
  });
});

// GET /api/reservas/plan?dias=7
// Cuantas minutas hay que servir por fecha y por turno en los
// proximos N dias. La cocina lo usa para saber con antelacion
// cuanto preparar (las reservas se hacen dias antes).
router.get("/plan", async (req, res) => {
  const dias = Math.min(14, Math.max(1, Number(req.query.dias) || 7));
  const fechas = [];
  for (let i = 0; i < dias; i++) {
    fechas.push(fechaDesdeHoy(i));
  }

  const primera = fechas[0];
  const ultima = fechas[fechas.length - 1];

  const { data, error } = await getSupabase()
    .from("reservas")
    .select("fecha, turno")
    .gte("fecha", primera)
    .lte("fecha", ultima);

  if (error) return res.status(500).json({ error: error.message });

  // Agrupamos por fecha y turno
  const porFecha = {};
  for (const r of data) {
    if (!porFecha[r.fecha]) porFecha[r.fecha] = {};
    porFecha[r.fecha][r.turno] = (porFecha[r.fecha][r.turno] || 0) + 1;
  }

  // Armamos la respuesta solo con los dias que hay reservas
  const plan = fechas
    .map((fecha) => ({
      fecha,
      porTurno: porFecha[fecha] || {},
      total: Object.values(porFecha[fecha] || {}).reduce((a, b) => a + b, 0),
    }))
    .filter((d) => d.total > 0);

  res.json(plan);
});

// GET /api/reservas/diario?fecha=...
// Lista de reservas de un dia concreto, para que la cocina sepa
// cuantas minutas preparar por turno y sede (tabla diaria).
// Expone datos personales (nombre, documento), por eso requiere rol.
router.get("/diario", requiereRol("admin", "cocina", "profesor", "coordinador"), async (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const { data, error } = await getSupabase()
    .from("reservas")
    .select("*")
    .eq("fecha", fecha);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ fecha, reservas: data });
});

// GET /api/reservas/panel?fecha=...
// Panel compacto de cocina: cuantas minutas preparar para la fecha
// indicada, agrupado por jornada (Almuerzo/Refrigerio) y por sede.
// Tambien devuelve la lista detallada (con codigo Grab&Go, "para llevar"
// y alergias del beneficiario) para el empacado por nombre.
// Devuelve: { fecha, porJornada, porSede, total, reservas }
router.get("/panel", requiereRol("admin", "cocina"), async (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const { data, error } = await getSupabase()
    .from("reservas")
    .select("id, estudiante, documento, sede, turno, grado, asistio, para_llevar, codigo")
    .eq("fecha", fecha);

  if (error) return res.status(500).json({ error: error.message });

  const porJornada = { Almuerzo: 0, Refrigerio: 0 };
  const porSede = {};
  let total = 0;
  const jornadasValidas = ["Almuerzo", "Refrigerio"];
  for (const reserva of data) {
    const turno = reserva.turno || "Otro";
    const clave = jornadasValidas.includes(turno) ? turno : "Otros";
    porJornada[clave] = (porJornada[clave] || 0) + 1;
    const sede = reserva.sede || "Sin sede";
    porSede[sede] = (porSede[sede] || 0) + 1;
    total += 1;
  }

  // Alergias/preferencias de los reservados para avisar a la cocina
  const docs = data.map((r) => r.documento).filter(Boolean);
  const alergiasPorDoc = {};
  if (docs.length > 0) {
    const { data: bens } = await getSupabase()
      .from("beneficiarios")
      .select("documento, alergias, preferencias")
      .in("documento", docs);
    for (const b of bens || []) alergiasPorDoc[b.documento] = b;
  }

  const reservas = data.map((r) => ({
    ...r,
    alergias: alergiasPorDoc[r.documento]?.alergias || "",
    preferencias: alergiasPorDoc[r.documento]?.preferencias || "",
  }));

  res.json({ fecha, porJornada, porSede, total, reservas });
});

// GET /api/reservas/tablero?fecha=...
// Tablero del dia para el coordinador (y el admin): cuantas reservas
// hay para la fecha, la ocupacion por sede y turno, cuantas marcaron
// asistencia y la lista con los nombres de los reservados.
// Acepta ?fecha=YYYY-MM-DD; por defecto usa hoy.
router.get("/tablero", requiereRol("admin", "coordinador"), async (req, res) => {
  const fecha = req.query.fecha || fechaHoy();

  const { data, error } = await getSupabase()
    .from("reservas")
    .select("id, estudiante, documento, sede, turno, grado, asistio")
    .eq("fecha", fecha)
    .order("sede", { ascending: true })
    .order("turno", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const porSede = {};
  const porTurno = {};
  const porSedeTurno = {};
  let asistidos = 0;

  for (const r of data) {
    const sede = r.sede || "Sin sede";
    const turno = r.turno || "Sin turno";

    if (!porSede[sede]) porSede[sede] = { total: 0, asistidos: 0 };
    porSede[sede].total += 1;
    if (r.asistio) porSede[sede].asistidos += 1;

    if (!porTurno[turno]) porTurno[turno] = { total: 0, asistidos: 0 };
    porTurno[turno].total += 1;
    if (r.asistio) porTurno[turno].asistidos += 1;

    const clave = `${sede}||${turno}`;
    if (!porSedeTurno[clave]) porSedeTurno[clave] = { sede, turno, total: 0, asistidos: 0 };
    porSedeTurno[clave].total += 1;
    if (r.asistio) porSedeTurno[clave].asistidos += 1;

    if (r.asistio) asistidos += 1;
  }

  res.json({
    fecha,
    total: data.length,
    asistidos,
    sinMarcar: data.length - asistidos,
    porSede,
    porTurno,
    porSedeTurno: Object.values(porSedeTurno),
    reservas: data,
  });
});

// GET /api/reservas/recordatorio?documento=...
// Dice si el estudiante ya reservó para mañana, para que la Home y la
// pagina de Reserva le avisen ("mañana no tienes reserva"). Solo se
// considera si mañana es dia habil (lunes a viernes).
// Devuelve: { necesita, fecha, finDeSemana }
router.get("/recordatorio", limiteFormularios, async (req, res) => {
  // Solo el dueno del documento puede consultar si tiene reserva
  // para manana: se exige el token y que coincida con el documento.
  const token = leerToken(req);
  if (!token) {
    return res.status(401).json({
      error: "Debes ingresar con tu documento y PIN para consultar tus reservas.",
    });
  }
  const { documento } = req.query;
  if (!documento) {
    return res.status(400).json({ error: "Falta el documento" });
  }
  const docLimpio = String(documento).replace(/[\s.\-]/g, "");
  if (
      String(token.sub).replace(/[\s.\-]/g, "") !== docLimpio
    ) {
    return res
      .status(403)
      .json({ error: "El token no coincide con el documento" });
  }

  const fecha = fechaDesdeHoy(1);
  const esFinDeSemana = [0, 6].includes(diaSemana(fecha));

  const { data, error } = await getSupabase()
    .from("reservas")
    .select("id")
    .eq("documento", docLimpio)
    .eq("fecha", fecha)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    necesita: !data && !esFinDeSemana,
    fecha,
    finDeSemana: esFinDeSemana,
  });
});

// GET /api/reservas/tendencia?dias=14
// Ultimos N dias habiles (reservas, asistieron, sobrantes) y pronostico
// de demanda para los proximos 5 dias habiles (promedio por dia de semana).
// La usa el panel (pestana Reportes). Es publico (datos agregados).
router.get("/tendencia", async (req, res) => {
  const dias = Math.min(30, Math.max(7, Number(req.query.dias) || 14));
  const hoy = fechaHoy();

  // Dias habiles de atras (de hoy hacia 2*N para juntar bastantes habiles)
  const hasta = hoy;
  const desde = fechaDesdeHoy(-Math.ceil(dias * 2));

  const [{ data: reservas, error: errRes }, { data: sobrantes, error: errSob }] = await Promise.all([
    getSupabase()
      .from("reservas")
      .select("fecha, asistio")
      .gte("fecha", desde)
      .lte("fecha", hasta),
    getSupabase()
      .from("sobrantes")
      .select("fecha, porciones")
      .gte("fecha", desde)
      .lte("fecha", hasta),
  ]);

  if (errRes || errSob) {
    return res.status(500).json({ error: errRes?.message || errSob?.message });
  }

  const porFecha = {};
  for (const r of reservas || []) {
    if (!porFecha[r.fecha]) porFecha[r.fecha] = { reservas: 0, asistieron: 0 };
    porFecha[r.fecha].reservas += 1;
    if (r.asistio) porFecha[r.fecha].asistieron += 1;
  }
  for (const s of sobrantes || []) {
    if (!porFecha[s.fecha]) porFecha[s.fecha] = { reservas: 0, asistieron: 0, porciones_sobrantes: 0 };
    porFecha[s.fecha].porciones_sobrantes = (porFecha[s.fecha].porciones_sobrantes || 0) + (s.porciones || 0);
  }

  // Armamos la serie hacia atras: consentre los dias habiles mas recientes
  const serie = [];
  let cursor = new Date(hasta);
  const totalPorDiaSemana = {}; // para el pronostico
  const conteoDiasSemana = {};
  while (serie.length < dias && cursor >= new Date(desde)) {
    const f = cursor.toISOString().split("T")[0];
    const diaSem = diaSemana(f);
    if (diaSem !== 0 && diaSem !== 6) {
      const dato = porFecha[f] || { reservas: 0, asistieron: 0 };
      const desperdiciados = Math.max(0, dato.reservas - dato.asistieron);
      serie.push({
        fecha: f,
        reservas: dato.reservas,
        asistieron: dato.asistieron,
        porciones_sobrantes: dato.porciones_sobrantes || 0,
        porcentajeDesperdicio: dato.reservas > 0
          ? Math.round((desperdiciados / dato.reservas) * 100)
          : 0,
      });
      totalPorDiaSemana[diaSem] = (totalPorDiaSemana[diaSem] || 0) + dato.reservas;
      conteoDiasSemana[diaSem] = (conteoDiasSemana[diaSem] || 0) + 1;
    }
    const prev = new Date(cursor);
    prev.setDate(prev.getDate() - 1);
    cursor = prev;
  }
  serie.reverse();

  // Pronostico: proximos 5 dias habiles con el promedio de reservas
  // de ese mismo dia de la semana segun lo observado.
  const pronostico = [];
  let futuro = new Date(
    new Date(hoy + "T12:00:00").getTime() + 24 * 60 * 60 * 1000
  );
  while (pronostico.length < 5) {
    const f = futuro.toISOString().split("T")[0];
    const diaSem = diaSemana(f);
    if (diaSem !== 0 && diaSem !== 6) {
      const conteo = conteoDiasSemana[diaSem] || 0;
      const esperado = conteo > 0
        ? Math.round((totalPorDiaSemana[diaSem] || 0) / conteo)
        : 0;
      pronostico.push({ fecha: f, esperado });
    }
    futuro = new Date(futuro.getTime() + 24 * 60 * 60 * 1000);
  }

  res.json({ dias: serie, pronostico });
});

// GET /api/reservas/por-codigo/:codigo
// Busca una reserva por el codigo corto de entrega (Grab & Go). Lo usa
// la cocina en el panel y la hoja de entrega imprime el codigo para
// escanear/leer rapido.
router.get("/por-codigo/:codigo", requiereRol("admin", "cocina", "profesor", "coordinador"), async (req, res) => {
  const codigo = String(req.params.codigo || "").trim().toUpperCase();
  if (!codigo) return res.status(400).json({ error: "Falta el código" });

  const { data, error } = await getSupabase()
    .from("reservas")
    .select("*")
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "No se encontró ninguna reserva con ese código" });
  res.json(data);
});

// GET /api/reservas/:id
// Busca una reserva por su id. Expone datos personales (nombre,
// documento), por eso solo lo pueden consultar roles del panel.
router.get("/:id", requiereRol("admin", "cocina", "coordinador", "profesor"), async (req, res) => {
  const { data, error } = await getSupabase()
    .from("reservas")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Reserva no encontrada" });
  res.json(data);
});

// Valida cupo, hora limite y doble reserva para una fecha y, si todo
// esta bien, inserta la reserva. La reutilizan la reserva de un dia
// (fail-fast: devuelve el primer error) y la semanal (fail-soft: la
// ruta omite los dias que no se puedan). settings se pasa desde afuera
// para no releer la configuracion por cada fecha.
// Devuelve { ok: true, data } o { ok: false, motivo, errorInterno }.
async function crearReservaValidada(fecha, { nombre, documento, sede, turno, grado, llevar, settings }) {
  // La fecha debe ser real y estar dentro del rango permitido
  const errorFecha = validarFecha(fecha);
  if (errorFecha) return { ok: false, motivo: errorFecha };

  // Hora limite: si la reserva es para HOY y ya paso la hora limite
  // configurada (settings.hora_limite_reserva), el dia se cierra y no
  // se aceptan reservas nuevas ni cambios para hoy.
  const errorLimite = await errorSiDiaCerrado(fecha, "reservar");
  if (errorLimite) return { ok: false, motivo: errorLimite };

  // Cupo por sede: si la sede ya alcanzo el cupo maximo de reservas
  // para esa fecha, no se aceptan mas (settings.cupos_sede).
  const cupo = settings.cupos_sede?.[sede];
  if (typeof cupo === "number" && cupo > 0) {
    const { count, error: errCount } = await getSupabase()
      .from("reservas")
      .select("*", { count: "exact", head: true })
      .eq("fecha", fecha)
      .eq("sede", sede);

    if (errCount) return { ok: false, motivo: errCount.message, errorInterno: true };
    if (count >= cupo) {
      return {
        ok: false,
        motivo: `La sede ${sede} ya alcanzó su cupo de ${cupo} reservas para ese día.`,
      };
    }
  }

  // Evitar reservar dos veces la misma fecha y turno
  const { data: existente } = await getSupabase()
    .from("reservas")
    .select("id")
    .eq("documento", documento)
    .eq("fecha", fecha)
    .eq("turno", turno)
    .maybeSingle();
  if (existente) {
    return { ok: false, motivo: "Ya tienes una reserva para esa fecha y ese turno." };
  }

  const { data: dataInsertada, error } = await insertarReserva(
    nombre, documento, sede, turno, fecha, grado, llevar
  );
  if (error) return { ok: false, motivo: error.message, errorInterno: true };

  return { ok: true, data: dataInsertada };
}

// POST /api/reservas
// Crea una reserva nueva.
// Cuerpo esperado: { estudiante, documento, sede, turno, fecha, para_llevar? }
// Si llega semanal:true, en vez de reservar un solo dia, reserva del
// dia indicado en adelante todos los dias habil de esa misma semana
// (de lunes a viernes hasta el que toca). Devuelve:
//   { creadas, omitidas: [{fecha, motivo}], reservas }
router.post("/", limiteFormularios, async (req, res) => {
  const { estudiante, documento, sede, turno, fecha, para_llevar, semanal } = req.body;

  // La reserva semanal empieza en el PROXIMO LUNES si no se pasa fecha
  // explicita: asi "reservar toda la semana" siempre deja una semana
  // completa (lunes a viernes) y no un sobrante de la semana actual
  // que puede empezar en sabado.
  const fechaBase = fecha || (semanal ? proximoLunes() : fechaDesdeHoy(0));

  // Validacion basica de datos obligatorios
  if (!estudiante || !documento || !sede || !turno || !fechaBase) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  // El turno y la sede deben ser valores conocidos (evita datos raros)
  const turnosValidos = ["Almuerzo", "Refrigerio", "Ambas jornadas", "Ambos"];
  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({ error: "Turno no válido" });
  }

  const listaTurnos = (turno === "Ambas jornadas" || turno === "Ambos") ? ["Almuerzo", "Refrigerio"] : [turno];

  // La sede se valida contra la tabla de sedes (la maneja el admin).
  // Si no hay sedes configuradas, no se aceptan reservas.
  const { data: sedes, error: errSedes } = await getSupabase()
    .from("sedes")
    .select("nombre");
  if (errSedes || !sedes || sedes.length === 0) {
    return res
      .status(503)
      .json({ error: "No hay sedes configuradas. Contacta al administrador." });
  }
  if (!sedes.map((s) => s.nombre).includes(sede)) {
    return res.status(400).json({ error: "Sede no válida" });
  }

  // El documento debe tener formato numerico razonable (4-20 digitos).
  // Se ignoran espacios, puntos y guiones para aceptar formatos comunes.
  const docLimpio = String(documento).replace(/[\s.\-]/g, "");
  if (!/^\d{4,20}$/.test(docLimpio)) {
    return res.status(400).json({ error: "Documento no válido" });
  }
  // La reserva solo la puede crear el estudiante dueno del documento:
  // se exige el token de su sesion (documento + PIN) y que coincida.
  const token = leerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: "Debes ingresar con tu documento y PIN para reservar." });
  }
  if (String(token.sub).replace(/[\s.\-]/g, "") !== docLimpio) {
    return res
      .status(403)
      .json({ error: "No puedes reservar a nombre de otra persona." });
  }

  // El documento debe estar registrado como beneficiario del programa.
  // Asi la reserva solo la pueden hacer estudiantes matriculados.
  const { data: beneficiario, error: errBen } = await getSupabase()
    .from("beneficiarios")
    .select("nombre, documento, grado")
    .eq("documento", docLimpio)
    .maybeSingle();

  if (errBen) return res.status(500).json({ error: errBen.message });

  if (!beneficiario) {
    return res
      .status(400)
      .json({ error: "Documento no registrado en el programa" });
  }

  const nombreFinal = estudiante || beneficiario.nombre;
  const gradoFinal = beneficiario.grado || null;
  const llevar = para_llevar === true;

  // La configuracion (hora limite, cupos por sede) se lee una sola vez
  // por request; el helper la recibe por parametro.
  const settings = await leerSettings();

  // Reserva solo un dia
  if (!semanal) {
    const creadas = [];
    const omitidas = [];
    let errorCritico = null;
    let errStatus = 400;

    for (const t of listaTurnos) {
      const { ok, data, motivo, errorInterno } = await crearReservaValidada(fechaBase, {
        nombre: nombreFinal,
        documento: docLimpio,
        sede,
        turno: t,
        grado: gradoFinal,
        llevar,
        settings,
      });
      if (ok) creadas.push(data);
      else {
        omitidas.push({ turno: t, motivo });
        if (errorInterno) { errorCritico = motivo; errStatus = 500; }
      }
    }

    if (creadas.length === 0) {
      return res.status(errStatus).json({ error: errorCritico || omitidas[0].motivo });
    }

    crearNotificacion({
      tipo: "reserva",
      destinatario: req.body.correo || "",
      mensaje: armarMensajeEmail(nombreFinal, fechaBase, turno, sede),
      mensajeHtml: armarMensajeEmailHtml(nombreFinal, fechaBase, turno, sede),
    });

    const resUnica = { ...creadas[0], turno };
    return res.status(201).json(resUnica);
  }

  // --- Reserva de TODA la semana (de una sola vez) ---
  // Calcula los dias habil (lunes a viernes) desde la fecha base hasta
  // el final de esa semana. Para cada uno valida lo mismo que una
  // reserva normal y guarda solo los que se puedan.
  const diasASem = diasDeLaSemanaDesde(fechaBase);
  const creadas = [];
  const omitidas = [];

  for (const f of diasASem) {
    if (f < fechaHoy()) {
      omitidas.push({ fecha: f, turno, motivo: "ya pas�" });
      continue;
    }

    for (const t of listaTurnos) {
      const { ok, data, motivo } = await crearReservaValidada(f, {
        nombre: nombreFinal,
        documento: docLimpio,
        sede,
        turno: t,
        grado: gradoFinal,
        llevar,
        settings,
      });
      if (ok) {
        creadas.push(data);
      } else {
        omitidas.push({ fecha: f, turno: t, motivo });
      }
    }
  }

  if (creadas.length > 0) {
    crearNotificacion({
      tipo: "reserva",
      destinatario: req.body.correo || "",
      mensaje: `Confirmación de ${creadas.length} minutas para ${nombreFinal} (${sede}, ${turno}).`,
      mensajeHtml: `<p>Confirmación de <strong>${creadas.length}</strong> minutas para <strong>${nombreFinal}</strong> (${sede}, ${turno}).</p>`,
    });
  }

  res.status(201).json({
    creadas: creadas.length,
    omitidas,
    reservas: creadas,
  });
});

// Proximo lunes a partir de hoy (aunque hoy sea lunes se reserva la
// semana siguiente). Se usa como inicio de la reserva semanal.
function proximoLunes() {
  const hoy = new Date();
  const dia = hoy.getDay();
  const faltan = ((8 - dia) % 7) || 7;
  const lunes = new Date(hoy);
  lunes.setDate(lunes.getDate() + faltan);
  return `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, "0")}-${String(lunes.getDate()).padStart(2, "0")}`;
}

// Dias habil (lunes a viernes) desde una fecha hasta el final de esa
// semana (el sabado para). Ej: miercoles -> miercoles, jueves, viernes.
function diasDeLaSemanaDesde(fechaTexto) {
  const [anio, mes, dia] = fechaTexto.split("-").map(Number);
  const base = new Date(anio, mes - 1, dia);
  const dias = [];
  const cursor = new Date(base);
  while (cursor.getDay() !== 6) {
    const f = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (cursor.getDay() !== 0) dias.push(f);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

// Genera un codigo corto unico para entrega (Grab & Go). Intenta
// hasta 3 veces por si hay colision.
async function generarCodigoUnico() {
  const abecedario = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let intento = 0; intento < 3; intento++) {
    let codigo = "";
    for (let i = 0; i < 6; i++) {
      codigo += abecedario[Math.floor(Math.random() * abecedario.length)];
    }
    const { data: existente } = await getSupabase()
      .from("reservas")
      .select("id")
      .eq("codigo", codigo)
      .maybeSingle();
    if (!existente) return codigo;
  }
  // Ultimo recurso: basado en el tiempo para evitar colisiones reales
  return `R${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 9) + 1}`;
}

// Inserta una reserva con su codigo de entrega. El codigo se genera
// antes del insert (si una mil colisiona, se regenera y reintenta).
async function insertarReserva(estudiante, documento, sede, turno, fecha, grado, paraLlevar) {
  for (let intento = 0; intento < 3; intento++) {
    const codigo = await generarCodigoUnico();
    const { data, error } = await getSupabase()
      .from("reservas")
      .insert([{
        estudiante,
        documento,
        sede,
        turno,
        fecha,
        grado: grado || null,
        para_llevar: paraLlevar,
        codigo,
      }])
      .select()
      .single();
    if (!error) return { data };
    // Si fue por el codigo repetido, reintentamos
    if (error.code !== "23505") return { error };
  }
  return {
    error: new Error("No se pudo generar un código de entrega único"),
  };
}

// DELETE /api/reservas/mis/:id?documento=...
// Cancelacion propia: solo se puede borrar si el documento de la
// consulta coincide con el dueño de la reserva.
router.delete("/mis/:id", limiteFormularios, async (req, res) => {
  // Solo el estudiante dueno de la reserva puede cancelarla: se
  // exige el token y que coincida con el documento de la reserva.
  const token = leerToken(req);
  if (!token) {
    return res.status(401).json({
      error: "Debes ingresar con tu documento y PIN para cancelar tu reserva.",
    });
  }
  const { documento } = req.query;
  if (!documento) {
    return res.status(400).json({ error: "Falta el documento" });
  }
  const docLimpio = String(documento).replace(/[\s.\-]/g, "");
  if (String(token.sub).replace(/[\s.\-]/g, "") !== docLimpio) {
    return res
      .status(403)
      .json({ error: "El token no coincide con el documento" });
  }

  const { data: reserva, error: errReserva } = await getSupabase()
    .from("reservas")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errReserva) return res.status(500).json({ error: errReserva.message });
  if (!reserva) return res.status(404).json({ error: "Reserva no encontrada" });

  // Solo el dueño puede cancelar su propia reserva
  if (String(reserva.documento).replace(/[\s.\-]/g, "") !== docLimpio) {
    return res
      .status(403)
      .json({ error: "No puedes cancelar la reserva de otra persona" });
  }

  // Limite de anulacion: las reservas de HOY no se pueden cancelar
  // despues de la hora limite configurada en settings.
  const errorLimite = await errorSiDiaCerrado(reserva.fecha, "cancelar");
  if (errorLimite) return res.status(400).json({ error: errorLimite });

  const { error } = await getSupabase()
    .from("reservas")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// PUT /api/reservas/:id
// Actualiza el estado de una reserva (por ejemplo: asistio o no)
// Equipo con rol (admin, cocina, profesor).
router.put("/:id", requiereRol("admin", "cocina", "profesor"), async (req, res) => {
  // Lista blanca: la unica edicion permitida es marcar si el
  // estudiante asistio. Los demas campos de una reserva no se
  // tocan desde aqui, asi nadie puede cambiarle el documento,
  // la fecha o la sede a una reserva ya hecha.
  const body = {};
  if (typeof req.body?.asistio === "boolean") {
    body.asistio = req.body.asistio;
  } else {
    return res.status(400).json({
      error: "El unico campo editable es asistio (verdadero o falso)",
    });
  }

  // Verificamos que la reserva exista (si no, es 404, no 500)
  const { data: reserva, error: errBusca } = await getSupabase()
    .from("reservas")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errBusca) return res.status(500).json({ error: errBusca.message });
  if (!reserva) return res.status(404).json({ error: "Reserva no encontrada" });

  const { data, error } = await getSupabase()
    .from("reservas")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/reservas/:id
// Elimina una reserva (solo administrador)
router.delete("/:id", requiereRol("admin"), async (req, res) => {
  const { error } = await getSupabase().from("reservas").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// Formatea una fecha YYYY-MM-DD a algo legible: "sábado, 8 de agosto"
export function fechalegible(fecha) {
  const [año, mes, dia] = fecha.split("-").map(Number);
  const f = new Date(año, mes - 1, dia);
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(f);
}

// Version en texto plano del correo (para clientes de email simples)
export function armarMensajeEmail(nombre, fecha, turno, sede) {
  const fechaL = fechalegible(fecha);
  return [
    `¡Hola ${nombre}!`,
    "",
    "Tu minuta quedó reservada y la cocina ya te está esperando. 😊",
    "",
    `   📅 Fecha: ${fechaL}`,
    `   🍽️  Turno: ${turno}`,
    `   🏫 Sede: ${sede}`,
    "",
    "Recuerda asistir el día señalado: cada reserva que no se usa es comida que se desperdicia.",
    "Si al final no puedes ir, cancela tu reserva desde la página para que otra persona pueda aprovecharla.",
    "",
    "¡Gracias por ayudarnos a reducir el desperdicio de alimentos!",
    "— Equipo PAE",
  ].join("\n");
}

// Version HTML del correo (bonita, con estructura)
export function armarMensajeEmailHtml(nombre, fecha, turno, sede) {
  const fechaL = fechalegible(fecha);
  const fila = (etiqueta, valor) =>
    `<tr><td style="padding:6px 0;color:#666;width:90px;">${etiqueta}</td><td style="padding:6px 0;font-weight:600;color:#1f2937;">${valor}</td></tr>`;
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#2e9e6b;padding:20px 24px;">
    <div style="font-size:28px;">🍽️</div>
    <div style="color:#ffffff;font-size:18px;font-weight:bold;">PAE · Reserva confirmada</div>
  </div>
  <div style="padding:24px;">
    <p style="color:#1f2937;font-size:15px;line-height:1.6;">¡Hola <strong>${nombre}</strong>! Tu minuta quedó reservada y la cocina ya te está esperando. 😊</p>
    <table style="width:100%;margin:16px 0;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 16px;">
      ${fila("📅 Fecha", fechaL)}
      ${fila("🍽️ Turno", turno)}
      ${fila("🏫 Sede", sede)}
    </table>
    <p style="color:#4b5563;font-size:14px;line-height:1.6;">Recuerda asistir el día señalado: cada reserva que no se usa es comida que se desperdicia. Si no puedes ir, cancela tu reserva desde la página para que otra persona pueda aprovecharla.</p>
    <p style="color:#4b5563;font-size:14px;line-height:1.6;">¡Gracias por ayudarnos a reducir el desperdicio de alimentos!</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px;">— Equipo PAE</p>
  </div>
</div>`;
}

export default router;
