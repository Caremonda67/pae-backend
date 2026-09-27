// Rutas del Arcade PAE (videojuegos educativos comunitarios)
// Permite que estudiantes registrados envíen juegos educativos (Scratch o HTML)
// que son moderados por el coordinador/administrador antes de publicarse.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";
import { auditar } from "../config/auditoria.js";

const router = Router();

const CATEGORIAS_VALIDAS = [
  "Nutrición y Salud",
  "Cero Desperdicio",
  "Trivia y Preguntas",
  "Arcade y Acción",
  "Puzzles y Lógica",
];

// Helper para normalizar enlaces de Scratch a modo embed seguro
function normalizarRecursoJuego(tipo, url) {
  if (!url) return "";
  const limpia = String(url).trim();
  if (tipo === "scratch") {
    // Si viene como URL de scratch: https://scratch.mit.edu/projects/123456789...
    const match = limpia.match(/scratch\.mit\.edu\/projects\/(\d+)/i) || limpia.match(/turbowarp\.org\/(\d+)/i);
    if (match) {
      return `https://scratch.mit.edu/projects/${match[1]}/embed`;
    }
    // Si pasaron solo el ID numérico
    if (/^\d+$/.test(limpia)) {
      return `https://scratch.mit.edu/projects/${limpia}/embed`;
    }
  }
  return limpia;
}

const DISPOSITIVOS_VALIDOS = ["pc", "movil", "ambos"];

// Registra una entrada en el historial de versiones del juego (juegos_versiones)
async function registrarVersion(supabase, juego) {
  const juegoId = Number(juego.id) || juego.id;
  const version = juego.version || "1.0";

  const { data: existente } = await supabase
    .from("juegos_versiones")
    .select("id")
    .eq("juego_id", juegoId)
    .eq("version", version)
    .maybeSingle();

  if (existente) return { data: existente, error: null };

  const { data, error } = await supabase
    .from("juegos_versiones")
    .insert({
      juego_id: juegoId,
      version,
      novedades: juego.novedades || null,
      url_recurso: juego.url_recurso || null,
      portada_url: juego.portada_url || null,
      dispositivo: juego.dispositivo || "ambos",
      creada_en: juego.actualizado_en || new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  return { data, error };
}

// GET /api/juegos
// Lista pública de juegos aprobados con soporte de filtros
router.get("/", async (req, res) => {
  const { categoria, q, orden, dispositivo } = req.query;

  let consulta = getSupabase()
    .from("juegos")
    .select("*")
    .eq("estado", "aprobado");

  if (categoria && categoria !== "Todas") {
    consulta = consulta.eq("categoria", categoria);
  }

  // filtro por dispositivo: un juego "ambos" sirve para pc y movil
  if (dispositivo === "pc") {
    consulta = consulta.in("dispositivo", ["pc", "ambos"]);
  } else if (dispositivo === "movil") {
    consulta = consulta.in("dispositivo", ["movil", "ambos"]);
  } else if (dispositivo === "ambos") {
    consulta = consulta.eq("dispositivo", "ambos");
  }

  if (orden === "populares") {
    consulta = consulta.order("vistas", { ascending: false }).order("created_at", { ascending: false });
  } else {
    consulta = consulta.order("created_at", { ascending: false });
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });

  let resultados = data || [];
  if (q && String(q).trim()) {
    const termino = String(q).toLowerCase().trim();
    resultados = resultados.filter(
      (j) =>
        (j.titulo && j.titulo.toLowerCase().includes(termino)) ||
        (j.descripcion && j.descripcion.toLowerCase().includes(termino)) ||
        (j.autor_nombre && j.autor_nombre.toLowerCase().includes(termino))
    );
  }

  res.json(resultados);
});

// GET /api/juegos/mios
// Permite consultar creaciones propias (estudiantes y personal administrativo)
router.get("/mios", requiereRol("estudiante", "admin", "coordinador"), async (req, res) => {
  const documento = String(req.usuario.sub || "").trim();
  if (!documento) return res.status(401).json({ error: "Sesión inválida." });

  const esPersonalPAE = req.usuario.rol === "admin" || req.usuario.rol === "coordinador";
  let consulta = getSupabase()
    .from("juegos")
    .select("*")
    .order("created_at", { ascending: false });

  if (esPersonalPAE) {
    consulta = consulta.or(`autor_documento.eq.${documento},autor_nombre.eq.Equipo Pedagógico PAE`);
  } else {
    consulta = consulta.eq("autor_documento", documento);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/juegos/:id
// Detalle de un juego aprobado específico
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await getSupabase()
    .from("juegos")
    .select("*")
    .eq("id", id)
    .eq("estado", "aprobado")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Juego no encontrado" });

  res.json(data);
});

const DEBOUNCE_JUGADAS_MS = 15000;
const CADUCIDAD_JUGADAS_MS = 60000;
const MAX_REGISTROS_MEMORIA = 2000;

// Registro en memoria de reproducciones recientes por IP para evitar spam o bucles de conteo
const jugadasRecientes = new Map();

// POST /api/juegos/:id/jugar
// Incrementa el contador de reproducciones de forma controlada
router.post("/:id/jugar", async (req, res) => {
  const { id } = req.params;
  const ipCliente = req.ip || req.headers["x-forwarded-for"] || "ip_local";
  const clave = `${ipCliente}_${id}`;
  const ahora = Date.now();
  const ultimaVez = jugadasRecientes.get(clave);

  if (ultimaVez && ahora - ultimaVez < DEBOUNCE_JUGADAS_MS) {
    return res.json({ ok: true, mensaje: "Partida ya contabilizada recientemente", repetido: true });
  }
  jugadasRecientes.set(clave, ahora);

  if (jugadasRecientes.size > MAX_REGISTROS_MEMORIA) {
    for (const [k, timestamp] of jugadasRecientes.entries()) {
      if (ahora - timestamp > CADUCIDAD_JUGADAS_MS) jugadasRecientes.delete(k);
    }
  }

  const supabase = getSupabase();

  const { data: juego, error: errBusq } = await supabase
    .from("juegos")
    .select("vistas")
    .eq("id", id)
    .maybeSingle();

  if (errBusq || !juego) {
    return res.status(404).json({ error: "Juego no encontrado" });
  }

  const nuevasVistas = (juego.vistas || 0) + 1;
  const { error: errAct } = await supabase
    .from("juegos")
    .update({ vistas: nuevasVistas })
    .eq("id", id);

  if (errAct) return res.status(500).json({ error: errAct.message });
  res.json({ ok: true, vistas: nuevasVistas });
});

// GET /api/juegos/:id/versiones
// Historial de versiones de un juego publicado (más reciente primero)
router.get("/:id/versiones", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await getSupabase()
    .from("juegos_versiones")
    .select("*")
    .eq("juego_id", id)
    .order("creada_en", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/juegos
// Estudiantes registrados (y admin/coordinador) envían sus juegos
router.post("/", requiereRol("estudiante", "admin", "coordinador"), async (req, res) => {
  const {
    titulo,
    descripcion,
    instrucciones,
    categoria,
    tipo = "scratch",
    url_recurso,
    portada_url,
    dispositivo = "ambos",
  } = req.body || {};

  if (!titulo || String(titulo).trim().length < 3) {
    return res.status(400).json({ error: "El título debe tener al menos 3 caracteres." });
  }

  if (!url_recurso || !String(url_recurso).trim()) {
    return res.status(400).json({ error: "Debes proporcionar el enlace o archivo del juego." });
  }

  const catFinal = CATEGORIAS_VALIDAS.includes(categoria) ? categoria : "Nutrición y Salud";
  const urlFinal = normalizarRecursoJuego(tipo, url_recurso);
  const dispositivoFinal = DISPOSITIVOS_VALIDOS.includes(dispositivo) ? dispositivo : "ambos";

  const esPersonalPAE = req.usuario.rol === "admin" || req.usuario.rol === "coordinador";
  const autor_documento = String(req.usuario.sub || "").trim();
  const autor_nombre = esPersonalPAE
    ? "Equipo Pedagógico PAE"
    : String(req.usuario.nombre || "Estudiante").trim();

  let autor_grado = esPersonalPAE ? "Equipo PAE" : null;
  if (!esPersonalPAE) {
    const { data: beneficiario } = await getSupabase()
      .from("beneficiarios")
      .select("grado")
      .eq("documento", autor_documento)
      .maybeSingle();
    if (beneficiario?.grado) {
      autor_grado = String(beneficiario.grado).trim().slice(0, 20);
    }
  }

  const estado = esPersonalPAE ? "aprobado" : "pendiente";

  const nuevoJuego = {
    titulo: String(titulo).trim().slice(0, 100),
    descripcion: descripcion ? String(descripcion).trim().slice(0, 500) : null,
    instrucciones: instrucciones ? String(instrucciones).trim().slice(0, 500) : null,
    categoria: catFinal,
    tipo,
    url_recurso: urlFinal,
    portada_url: portada_url || null,
    dispositivo: dispositivoFinal,
    autor_documento,
    autor_nombre,
    autor_grado,
    estado,
    vistas: 0,
  };

  const { data, error } = await getSupabase()
    .from("juegos")
    .insert(nuevoJuego)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (esPersonalPAE) {
    await registrarVersion(getSupabase(), data);
    auditar(req, "juego:crear_directo", `Juego publicado directamente: "${data.titulo}"`);
  }

  res.status(201).json(data);
});

// POST /api/juegos/:id/actualizar
// Propuesta o publicación de una nueva versión del juego
router.post("/:id/actualizar", requiereRol("estudiante", "admin", "coordinador"), async (req, res) => {
  const { id } = req.params;
  const { tipo, url_recurso, portada_url, dispositivo, version, novedades } = req.body || {};

  const supabase = getSupabase();

  const { data: juego, error: errJuego } = await supabase
    .from("juegos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (errJuego) return res.status(500).json({ error: errJuego.message });
  if (!juego) return res.status(404).json({ error: "Juego no encontrado." });

  const esPersonalPAE = req.usuario.rol === "admin" || req.usuario.rol === "coordinador";
  const documentoUsuario = String(req.usuario.sub || "");
  const esDuenio = String(juego.autor_documento || "") === documentoUsuario;
  const esJuegoInstitucional = juego.autor_nombre === "Equipo Pedagógico PAE";

  if (!esDuenio && !(esPersonalPAE && esJuegoInstitucional)) {
    return res.status(403).json({ error: "Solo el autor o la coordinación pueden actualizar este juego." });
  }

  if (juego.estado !== "aprobado") {
    return res.status(400).json({ error: "El juego debe estar publicado para solicitar una actualización." });
  }

  const pendienteActual = juego.actualizacion_pendiente;
  if (pendienteActual && pendienteActual.estado === "pendiente") {
    return res.status(409).json({ error: "Ya tienes una actualización en revisión; espera la respuesta." });
  }

  const novedadesFinal = novedades ? String(novedades).trim().slice(0, 800) : "";
  if (!novedadesFinal) {
    return res.status(400).json({ error: "Describe qué cambia en esta versión (novedades)." });
  }

  const tipoFinal = ["scratch", "html_archivo", "zip"].includes(tipo) ? tipo : juego.tipo;
  const urlFinal = url_recurso ? normalizarRecursoJuego(tipoFinal, url_recurso) : juego.url_recurso;
  const dispositivoFinal = DISPOSITIVOS_VALIDOS.includes(dispositivo) ? dispositivo : juego.dispositivo;
  const versionFinal = version ? String(version).trim().slice(0, 20) : juego.version || "1.0";

  // Administradores aplican los cambios directamente sin requerir moderación externa
  if (req.usuario.rol === "admin") {
    const { data: juegoActualizado, error: errAct } = await supabase
      .from("juegos")
      .update({
        tipo: tipoFinal,
        url_recurso: urlFinal,
        portada_url: portada_url || juego.portada_url,
        dispositivo: dispositivoFinal,
        version: versionFinal,
        novedades: novedadesFinal,
        actualizado_en: new Date().toISOString(),
        actualizacion_pendiente: null,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (errAct) return res.status(500).json({ error: errAct.message });
    await registrarVersion(supabase, juegoActualizado);
    auditar(req, "juego:actualizar_directo", `Actualización v${versionFinal} de "${juegoActualizado.titulo}" aplicada`);
    return res.json(juegoActualizado);
  }

  const propuesta = {
    estado: "pendiente",
    tipo: tipoFinal,
    url_recurso: urlFinal,
    portada_url: portada_url || juego.portada_url,
    dispositivo: dispositivoFinal,
    version: versionFinal,
    novedades: novedadesFinal,
    solicitado_en: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("juegos")
    .update({ actualizacion_pendiente: propuesta })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Juego no encontrado." });

  res.json(data);
});

// GET /api/juegos/admin/actualizaciones
// Administrativo: juegos que tienen una actualización propuesta por su autor
router.get("/admin/actualizaciones", requiereRol("admin", "coordinador"), async (req, res) => {
  const { data, error } = await getSupabase()
    .from("juegos")
    .select("*")
    .not("actualizacion_pendiente", "is", null)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // solo las propuestas aún en revisión (las rechazadas se dejan visibles al autor)
  const pendientes = (data || []).filter(
    (j) => j.actualizacion_pendiente && j.actualizacion_pendiente.estado === "pendiente"
  );
  res.json(pendientes);
});

// POST /api/juegos/:id/revisar-actualizacion
// Admin/coordinador decide sobre la actualización propuesta por el autor.
//   decisión: "aprobar" -> aplica los cambios al juego y marca actualizado_en
//   decisión: "rechazar" -> guarda el motivo para que el autor lo vea
router.post("/:id/revisar-actualizacion", requiereRol("admin", "coordinador"), async (req, res) => {
  const { id } = req.params;
  const { decision, motivo } = req.body || {};

  const supabase = getSupabase();

  const { data: juego, error: errJuego } = await supabase
    .from("juegos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (errJuego) return res.status(500).json({ error: errJuego.message });
  if (!juego) return res.status(404).json({ error: "Juego no encontrado." });

  const propuesta = juego.actualizacion_pendiente;
  if (!propuesta || propuesta.estado !== "pendiente") {
    return res.status(400).json({ error: "No hay una actualización pendiente para este juego." });
  }

  const decisor = String(req.usuario.nombre || req.usuario.sub || "Admin");

  if (decision === "aprobar") {
    // se aplican los datos de la propuesta y se marca la fecha de la actualización
    const { data, error } = await supabase
      .from("juegos")
      .update({
        tipo: propuesta.tipo || juego.tipo,
        url_recurso: propuesta.url_recurso,
        portada_url: propuesta.portada_url,
        dispositivo: propuesta.dispositivo || "ambos",
        version: propuesta.version,
        novedades: propuesta.novedades,
        actualizado_en: new Date().toISOString(),
        actualizacion_pendiente: null,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Juego no encontrado." });

    // se registra en el historial la versión que queda publicada
    await registrarVersion(supabase, {
      id,
      version: propuesta.version,
      novedades: propuesta.novedades,
      url_recurso: propuesta.url_recurso,
      portada_url: propuesta.portada_url,
      dispositivo: propuesta.dispositivo || "ambos",
      actualizado_en: new Date().toISOString(),
    });

    auditar(req, "juego:actualizacion_aprobada", `Actualización v${propuesta.version} de "${data.titulo}" aprobada`);
    return res.json(data);
  }

  if (decision === "rechazar") {
    const motivoFinal = motivo ? String(motivo).trim().slice(0, 500) : "La actualización no cumple con las pautas del PAE";
    const { data, error } = await supabase
      .from("juegos")
      .update({
        actualizacion_pendiente: {
          ...propuesta,
          estado: "rechazado",
          motivo: motivoFinal,
          decidido_en: new Date().toISOString(),
          decidido_por: decisor,
        },
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Juego no encontrado." });

    auditar(req, "juego:actualizacion_rechazada", `Actualización de "${data.titulo}" rechazada: ${motivoFinal}`);
    return res.json(data);
  }

  return res.status(400).json({ error: "La decisión debe ser 'aprobar' o 'rechazar'." });
});

// GET /api/juegos/admin/todos
// Panel administrativo: lista todos los juegos para moderación
router.get("/admin/todos", requiereRol("admin", "coordinador"), async (req, res) => {
  const { estado } = req.query;

  let consulta = getSupabase()
    .from("juegos")
    .select("*")
    .order("created_at", { ascending: false });

  if (estado && ["pendiente", "aprobado", "rechazado"].includes(estado)) {
    consulta = consulta.eq("estado", estado);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH /api/juegos/:id/estado
// Moderación: coordinadores y administradores aprueban o rechazan
router.patch("/:id/estado", requiereRol("admin", "coordinador"), async (req, res) => {
  const { id } = req.params;
  const { estado, motivo_rechazo } = req.body || {};

  if (!["aprobado", "rechazado", "pendiente"].includes(estado)) {
    return res.status(400).json({ error: "Estado no válido." });
  }

  const actualizacion = {
    estado,
    motivo_rechazo: estado === "rechazado" ? (motivo_rechazo || "No cumple con las pautas del PAE") : null,
  };

  const { data, error } = await getSupabase()
    .from("juegos")
    .update(actualizacion)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Juego no encontrado." });

  // al aprobar por primera vez se registra la versión inicial en el historial
  if (estado === "aprobado") {
    await registrarVersion(getSupabase(), data);
  }

  auditar(req, `juego:${estado}`, `Juego "${data.titulo}" marcado como ${estado}`);
  res.json(data);
});

// DELETE /api/juegos/:id
// Solo administradores pueden eliminar un juego
router.delete("/:id", requiereRol("admin"), async (req, res) => {
  const { id } = req.params;

  const { data: juego, error: errBusq } = await getSupabase()
    .from("juegos")
    .select("titulo")
    .eq("id", id)
    .maybeSingle();

  if (errBusq || !juego) {
    return res.status(404).json({ error: "Juego no encontrado." });
  }

  const { error } = await getSupabase().from("juegos").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });

  auditar(req, "juego:eliminar", `Juego eliminado: "${juego.titulo}"`);
  res.json({ ok: true });
});

export default router;
