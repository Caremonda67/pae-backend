// Chatbot con Gemini. Responde con datos reales de la base: menu (rota
// por semana del mes y jornada), reservas del dia, desperdicio, avisos.
// La fecha y la semana se calculan en hora de Colombia para no cruzar semanas.
import { Router } from "express";
import { limiteChat } from "../config/rateLimit.js";
import { getSupabase } from "../config/supabase.js";

const router = Router();

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Fecha de hoy en español, en la zona horaria de Colombia
// (ej: "viernes, 7 de agosto de 2026"). Usamos timeZone explicito
// porque el servidor puede estar en UTC y desfasar el día.
function fechaDeHoy() {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

// Semana del mes (1-4) en la hora de Colombia: dias 1-7 semana 1,
// 8-14 semana 2, etc. Es el mismo calculo que usa /api/menus/hoy.
function semanaDelMesEnColombia() {
  const colombia = new Date(new Date().getTime() - 5 * 60 * 60 * 1000);
  return Math.min(4, Math.ceil(colombia.getDate() / 7));
}

// Dia de la semana de hoy en español (Lunes..Domingo)
function diaDeHoy() {
  const colombia = new Date(new Date().getTime() - 5 * 60 * 60 * 1000);
  return DIAS_ES[colombia.getDay()];
}

// Convierte el menu de la base en un texto agrupado por semana y
// por dia, dejando clara cada jornada (Almuerzo / Refrigerio).
function menuEnTexto(menus) {
  if (!menus || menus.length === 0) {
    return "(El menú está vacío en la base de datos)";
  }

  const semanas = [...new Set(menus.map((m) => m.semana))].sort((a, b) => a - b);
  const partes = [];

  for (const semana of semanas) {
    partes.push(`SEMANA ${semana} DEL MES:`);
    for (const dia of ORDEN_DIAS) {
      const platos = menus.filter(
        (m) => m.semana === semana && normalizar(m.dia) === normalizar(dia)
      );
      if (platos.length === 0) continue;
      partes.push(`  ${dia}:`);
      for (const p of platos) {
        partes.push(
          `   - ${p.jornada || "Sin jornada"}: ${p.platillo}. ${p.descripcion || "Sin descripción"}` +
            (p.calorias ? ` (${p.calorias} kcal)` : "")
        );
      }
    }
    partes.push("");
  }

  return partes.join("\n");
}

// Junta todo el contexto del programa en un texto que entiende el bot
function construirPromptSistema(contexto) {
  return [
    "Eres 'PAE Bot', el asistente virtual del Programa de Alimentación Escolar",
    "de la institución educativa. Respondes en español, con tono amable, claro y",
    "cercano, como un orientador del programa.",
    "",
    "Tu objetivo es ayudar a estudiantes, padres y docentes. Debes usar SIEMPRE",
    "la información REAL que se te da abajo (menú, reservas, reporte, avisos y",
    "métricas del programa). Si te preguntan algo que no esté en esos datos, di",
    "que puedes consultarlo y sugiere hablar con el equipo del PAE por el",
    "formulario de contacto.",
    "",
    `HOY ES: ${contexto.fechaHoy}. La semana ACTUAL del mes es la SEMANA ${contexto.semanaActual} y`,
    `hoy es ${contexto.diaActual}. El servicio del PAE es de LUNES a VIERNES.`,
    "IMPORTANTE SOBRE EL MENÚ: el menú rota cada semana del mes (semana 1, 2,",
    "3 y 4) y cada día tiene una comida por jornada (Almuerzo y Refrigerio).",
    "Cuando te pregunten 'qué hay de comer hoy', 'esta semana', 'el lunes',",
    "'mañana' o un día cualquiera SIN decir la semana, usa SIEMPRE el menú de la",
    `SEMANA ${contexto.semanaActual} (la actual). Solo usa otra semana si el usuario la pide.`,
    "No mezcles ni confundas los platillos de una semana con los de otra.",
    "Si hoy es sábado o domingo, recuerda que no hay servicio y menciona el menú",
    "del próximo lunes de la semana vigente.",
    "",
    "Información importante del programa:",
    "- El estudiante debe RESERVAR su comida para que la cocina prepare solo",
    "  la cantidad exacta y así evitar el desperdicio de alimentos.",
    "- Para reservar: entrar a la página y usar la opción 'Reservar comida'.",
    `- Las sedes disponibles son: ${contexto.sedes}.`,
    "- Los turnos son: Almuerzo y Refrigerio.",
    "- El usuario debe escribir su documento y puede ser validado con el registro",
    "  de beneficiarios.",
    "",
    `MENÚ COMPLETO POR SEMANA (menú oficial del programa):\n${contexto.menu}`,
    "",
    `RESERVAS (cuántas minutas se han reservado por fecha):\n${contexto.reservas}`,
    "",
    `REPORTE DE DESPERDICIO:\n${contexto.reporte}`,
    "",
    `AVISOS PUBLICADOS POR EL ADMINISTRADOR:\n${contexto.avisos}`,
    "",
    `MÉTRICAS DEL PROGRAMA (datos reales):\n${contexto.metricas}`,
    "",
    "Responde de forma breve y útil (máximo 4-5 líneas). Si te preguntan por un",
    "día específico, indica exactamente el platillo de ese día y su jornada de la",
    "semana vigente. Si te preguntan cuántas minutas hay reservadas, usa los",
    "totales. Si te preguntan por avisos o por el programa, cuéntales con los",
    "datos reales. Ayuda a reducir el desperdicio recordando reservar la comida.",
    "Personaliza la respuesta con el historial de la conversación: si te vuelven",
    "a preguntar lo mismo, puedes decir que ya lo comentaron antes.",
  ].join("\n");
}

// Guarda un mensaje del chat en la base (con sesion_id del navegador)
// para que la conversacion sobreviva a recargas y cambios de pagina.
// Si la base falla no tumba la conversacion con Gemini: solo se registra.
async function guardarMensaje(sesionId, rol, texto) {
  if (!sesionId || typeof sesionId !== "string") return;
  const contenido = String(texto || "").trim().slice(0, 2000);
  if (!contenido) return;
  try {
    const { error } = await getSupabase()
      .from("chatbot_mensajes")
      .insert({ sesion_id: sesionId.slice(0, 64), rol, texto: contenido });
    if (error) console.error("No se pudo guardar el chat:", error.message);
  } catch (e) {
    console.error("No se pudo guardar el chat:", e.message);
  }
}

// GET /api/chat/historial?sesion=abc
// Devuelve la conversacion guardada de un navegador (sesion anonima).
router.get("/historial", limiteChat, async (req, res) => {
  const sesion = typeof req.query.sesion === "string" ? req.query.sesion.trim() : "";
  if (!sesion) return res.json([]);

  const { data, error } = await getSupabase()
    .from("chatbot_mensajes")
    .select("rol, texto")
    .eq("sesion_id", sesion.slice(0, 64))
    .order("id", { ascending: true })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat
// Cuerpo esperado: { mensaje: "texto del usuario", historial: [{rol, texto}], sesion_id?: "abc" }
router.post("/", limiteChat, async (req, res) => {
  const { mensaje, historial, sesion_id } = req.body;

  if (!mensaje || typeof mensaje !== "string") {
    return res.status(400).json({ error: "Falta el mensaje" });
  }

  // Persistimos la pregunta del estudiante de inmediato (incluso si
  // Gemini luego falla) para que el historial quede completo.
  await guardarMensaje(sesion_id, "usuario", mensaje);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "El chatbot no está configurado aún. Pide al equipo que complete GEMINI_API_KEY en backend/.env",
    });
  }

  // Modelo de Gemini. Configurable por si Google actualiza la lista
  // de modelos gratuitos (ver https://ai.google.dev/gemini-api/docs/models)
  const modelo = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  try {
    const supabase = getSupabase();

    // Cargamos menu, reservas recientes, avisos y sedes en paralelo
    // (antes eran 4+ queries secuenciales que sumaban ~500ms cada una)
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const [menusRes, reservasRes, avisosRes, sedesRes] = await Promise.all([
      supabase.from("menus").select("semana, dia, jornada, platillo, descripcion, calorias").eq("estado", "publicado"),
      supabase.from("reservas").select("fecha, asistio").gte("fecha", hace30d),
      supabase.from("avisos").select("titulo, texto").eq("estado", "publicado").order("created_at", { ascending: false }),
      supabase.from("sedes").select("nombre"),
    ]);

    const menuTexto = menuEnTexto(menusRes.data && !menusRes.error ? menusRes.data : []);

    // 2. Totales de reservas por fecha (ultimos 30 dias nomas)
    const reservas = reservasRes.data;
    const errReservas = reservasRes.error;

    let reservasTexto = "(Aún no hay reservas registradas)";
    if (!errReservas && reservas && reservas.length > 0) {
      // contamos las reservas de cada fecha
      const porFecha = {};
      for (const r of reservas) {
        if (!porFecha[r.fecha]) porFecha[r.fecha] = { total: 0, asistieron: 0 };
        porFecha[r.fecha].total += 1;
        if (r.asistio) porFecha[r.fecha].asistieron += 1;
      }
      reservasTexto = Object.entries(porFecha)
        .map(([fecha, info]) => `- ${fecha}: ${info.total} reservadas (${info.asistieron} asistieron)`)
        .join("\n");
    }

    // 3. Reporte de desperdicio
    let total = 0;
    let asistieron = 0;
    if (!errReservas && reservas) {
      for (const r of reservas) {
        total += 1;
        if (r.asistio) asistieron += 1;
      }
    }
    const desperdicio = total - asistieron;
    let porcentaje = 0;
    if (total > 0) porcentaje = Math.round((desperdicio / total) * 100);
    const reporteTexto =
      total === 0
        ? "No hay reservas todavía."
        : `Total reservadas: ${total}. Asistieron: ${asistieron}. Sin asistir: ${desperdicio} (${porcentaje}% de desperdicio).`;

    // 4. Avisos publicados (ya cargados en paralelo)
    let avisosTexto = "(No hay avisos publicados)";
    if (!avisosRes.error && avisosRes.data && avisosRes.data.length > 0) {
      avisosTexto = avisosRes.data
        .map((a) => `- ${a.titulo}: ${a.texto}`)
        .join("\n");
    }

    // 5. Metricas del programa (para respuestas mas completas)
    const conteo = async (tabla) => {
      const { count, error } = await supabase
        .from(tabla)
        .select("*", { count: "exact", head: true });
      return error ? 0 : count;
    };
    const [estudiantes, instituciones, minutas] = await Promise.all([
      conteo("beneficiarios"),
      conteo("instituciones"),
      conteo("reservas"),
    ]);
    const metricasTexto = [
      `- Estudiantes beneficiarios: ${estudiantes}`,
      `- Instituciones educativas cubiertas: ${instituciones}`,
      `- Minutas reservadas: ${minutas}`,
    ].join("\n");

    // 6. Sedes del programa (ya cargadas en paralelo)
    const sedesTexto =
      !sedesRes.error && sedesRes.data && sedesRes.data.length > 0
        ? sedesRes.data.map((s) => s.nombre).join(", ")
        : "No hay sedes registradas aun";

    const contexto = {
      fechaHoy: fechaDeHoy(),
      semanaActual: semanaDelMesEnColombia(),
      diaActual: diaDeHoy(),
      menu: menuTexto,
      reservas: reservasTexto,
      reporte: reporteTexto,
      avisos: avisosTexto,
      metricas: metricasTexto,
      sedes: sedesTexto,
    };

    // 7. Historial de la conversacion (si el navegador lo envia) para
    //    que el bot recuerde el contexto y personalice la respuesta.
    //    Gemini exige que la conversacion empiece con rol "user" y que
    //    los roles se alternen (user/model/user/...). El historial que
    //    manda el frontend incluye el saludo del bot, asi que quitamos
    //    los "model" del inicio y unimos los mensajes seguidos del mismo
    //    rol para no romper la secuencia.
    function alternarRoles(lista) {
      const turnos = [];
      for (const m of lista) {
        const ultimo = turnos[turnos.length - 1];
        if (ultimo && ultimo.role === m.role) {
          ultimo.parts[0].text += "\n" + m.texto;
        } else {
          turnos.push({ role: m.role, parts: [{ text: m.texto }] });
        }
      }
      while (turnos.length > 0 && turnos[0].role !== "user") {
        turnos.shift();
      }
      return turnos;
    }

    const historialValido = Array.isArray(historial)
      ? alternarRoles(
          historial
            .filter((h) => h && typeof h.texto === "string" && h.texto.trim() !== "")
            .slice(-10)
            .map((h) => ({
              role: h.rol === "usuario" ? "user" : "model",
              texto: h.texto,
            }))
        )
      : [];

    // 8. Llamamos a la API de Gemini (Google).
    //    La clave va por header (x-goog-api-key), no en la URL,
    //    para que no quede expuesta en los logs del servidor.
    //    Timeout de 30s para que no cuelgue la peticion si Gemini
    //    tarda demasiado (evita bloquear conexiones bajo carga).
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 30_000);
    let respuesta;
    try {
      respuesta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: controlador.signal,
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: construirPromptSistema(contexto) }],
            },
            contents: [
              ...historialValido,
              {
                role: "user",
                parts: [{ text: mensaje }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          }),
        }
      );
      const datos = await respuesta.json();

      if (!respuesta.ok) {
        console.error("Gemini error:", JSON.stringify(datos));
        return res.status(502).json({ error: "Error del servicio de IA" });
      }

      // 9. Extraemos el texto de la respuesta de Gemini
      const texto =
        datos?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text)
          .join("") || "No pude generar una respuesta.";

      // Persistimos la respuesta junto a la pregunta guardada antes.
      await guardarMensaje(sesion_id, "bot", texto);

      res.json({ respuesta: texto });
    } finally {
      clearTimeout(temporizador);
    }
  } catch (err) {
    console.error("Chatbot error:", err);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "El servicio de IA tardó demasiado. Intenta de nuevo." });
    }
    res.status(500).json({ error: "Error interno del chatbot" });
  }
});

export default router;
