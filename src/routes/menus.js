// rutas del menu del PAE y valoraciones de platos
// el menu rota por semana del mes (1-4) y cada dia tiene una comida
// diferente por jornada (Almuerzo y Refrigerio). Los estudiantes
// puntuan los platos (1 a 5 estrellas) y esa retroalimentacion le
// sirve a la cocina para mejorar el menu.
//
// La web (Home, pagina de Menu) solo muestra los platos PUBLICADOS.
// Los borradores los ve el panel (admin/cocina/coordinador) y sirven
// para planear la semana sin que los estudiantes la vean todavia.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol, verificarToken } from "../config/auth.js";

const router = Router();

// Semana del mes (1-4): dias 1-7 son semana 1, 8-14 semana 2, etc.
function semanaDelMes(fecha) {
  return Math.min(4, Math.ceil(fecha.getDate() / 7));
}

// Dia de la semana en espanol (Lunes..Viernes). Los fines de semana
// se devuelve "Lunes" (no hay servicio), asi la Home muestra el del lunes.
function diaEnEspanol(fecha) {
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const nombre = dias[fecha.getDay()];
  if (nombre === "Domingo" || nombre === "Sábado") return "Lunes";
  return nombre;
}

// Quita las tildes de un nombre de dia: "Miércoles" -> "Miercoles".
// En la base los dias se guardan sin tilde, asi la comparacion con
// Supabase (exacta) siempre encuentra el plato sin importar como lo
// escriba el usuario o el panel.
function sinTildes(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// GET /api/menus
// Lista los menus PUBLICADOS con su valoracion promedio. Se puede
// filtrar por semana (?semana=2) o por semana y dia (?semana=2&dia=Lunes).
// Si se pasa ?documento=YYYY..., se marcan los platos que ese estudiante
// guardo como favoritos y se devuelven las etiquetas "popular", "favorito"
// y "recomendado" (calculadas desde las valoraciones y los favoritos).
router.get("/", async (req, res) => {
  let consulta = getSupabase()
    .from("menus")
    .select("*")
    .eq("estado", "publicado")
    .order("semana", { ascending: true })
    .order("dia", { ascending: true })
    .order("jornada", { ascending: true });

  if (req.query.semana) {
    const semana = Number(req.query.semana);
    if (!Number.isInteger(semana) || semana < 1) {
      return res.status(400).json({ error: "Semana no válida" });
    }
    consulta = consulta.eq("semana", semana);
  }
  if (req.query.dia) {
    consulta = consulta.eq("dia", req.query.dia);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });

  // Leemos las valoraciones guardadas y calculamos el promedio
  const { data: valoraciones, error: errVal } = await getSupabase()
    .from("valoraciones")
    .select("menu_id, puntos");

  let promedioPorMenu = {};
  let conteoPorMenu = {};
  if (!errVal && valoraciones) {
    const sumaPorMenu = {};
    for (const v of valoraciones) {
      if (!sumaPorMenu[v.menu_id]) sumaPorMenu[v.menu_id] = 0;
      if (!conteoPorMenu[v.menu_id]) conteoPorMenu[v.menu_id] = 0;
      sumaPorMenu[v.menu_id] += v.puntos;
      conteoPorMenu[v.menu_id] += 1;
    }
    promedioPorMenu = Object.fromEntries(
      Object.entries(sumaPorMenu).map(([id, suma]) => [
        id,
        Math.round((suma / conteoPorMenu[id]) * 10) / 10,
      ])
    );
  }

  // Favoritos del estudiante (si viene ?documento= y el token coincide):
  // los favoritos son datos personales y no se exponen a cualquiera que
  // adivine un documento. Sin token valido, la bandera se deja en false.
  let favoritosDelDoc = new Set();
  if (req.query.documento) {
    const doc = String(req.query.documento).trim();
    const docLimpio = doc.replace(/[\s.\-]/g, "");
    let tokenOk = false;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      try {
        const t = verificarToken(auth.slice(7));
        if (t && String(t.sub).replace(/[\s.\-]/g, "") === docLimpio) tokenOk = true;
      } catch (_e) {}
    }
    if (tokenOk) {
      const { data: favs } = await getSupabase()
        .from("favoritos")
        .select("menu_id")
        .or(`documento.eq.${docLimpio},documento.eq.${doc}`);
      if (favs) favoritosDelDoc = new Set(favs.map((f) => f.menu_id));
    }
  }

  // Maximos de votos para decidir que plato es "popular"
  let maxVotos = 0;
  for (const id of Object.keys(conteoPorMenu)) {
    maxVotos = Math.max(maxVotos, conteoPorMenu[id]);
  }

  // Adjuntamos el promedio, la cantidad de votos y las etiquetas
  const menusConValoracion = data.map((menu) => {
    const votos = conteoPorMenu[menu.id] || 0;
    const valoracion = promedioPorMenu[menu.id] || null;
    const popular =
      votos > 0 && maxVotos > 0 && votos >= Math.max(2, Math.round(maxVotos * 0.6));
    return {
      ...menu,
      valoracion,
      votos,
      popular,
      recomendado: votos > 0 && valoracion !== null && valoracion >= 4,
      favorito: req.query.documento ? favoritosDelDoc.has(menu.id) : false,
    };
  });

  res.json(menusConValoracion);
});

// GET /api/menus/favoritos?documento=...
// Lista los platos que un estudiante marco como favoritos, para que
// puede consultarlos desde "Mis reservas" / Home.
// Devuelve: [{ id, menu_id, platillo, semana, dia, jornada, created_at }]
router.get("/favoritos", async (req, res) => {
  const { documento } = req.query;
  if (!documento) {
    return res.status(400).json({ error: "Falta el documento" });
  }
  const doc = String(documento).trim();

  // Los favoritos son personales: solo los ve el dueno de la sesion.
  const auth = req.headers.authorization;
  try {
    const t = verificarToken(auth && auth.startsWith("Bearer ") ? auth.slice(7) : "");
    if (!t || String(t.sub || "").trim() !== doc) {
      return res.status(403).json({ error: "No autenticado para ese documento" });
    }
  } catch (_e) {
    return res.status(403).json({ error: "No autenticado para ese documento" });
  }

  const { data, error } = await getSupabase()
    .from("favoritos")
    .select("id, menu_id, created_at")
    .eq("documento", String(documento).trim())
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Rellenar el nombre del plato desde la tabla de menus
  const platos = [];
  for (const fav of data || []) {
    const { data: menu } = await getSupabase()
      .from("menus")
      .select("id, platillo, semana, dia, jornada")
      .eq("id", fav.menu_id)
      .maybeSingle();
    if (menu) platos.push({ ...fav, ...menu });
  }

  res.json(platos);
});

// PUT /api/menus/:id/favorito
// Marca o desmarca un plato como favorito del estudiante.
// Cuerpo: { documento: "..." , activo: true|false }
// Devuelve: { ok: true, favorito: true|false }
router.put("/:id/favorito", async (req, res) => {
  const { documento, activo } = req.body || {};
  if (!documento) {
    return res.status(400).json({ error: "Falta el documento" });
  }
  const docLimpio = String(documento).replace(/[\s.\-]/g, "");
  const deseaActivo = activo !== false;

  // Solo el dueno de la sesion puede marcar sus propios favoritos
  const auth = req.headers.authorization;
  try {
    const t = verificarToken(auth && auth.startsWith("Bearer ") ? auth.slice(7) : "");
    if (!t || String(t.sub || "").replace(/[\s.\-]/g, "") !== docLimpio) {
      return res.status(403).json({ error: "No autenticado para ese documento" });
    }
  } catch (_e) {
    return res.status(403).json({ error: "No autenticado para ese documento" });
  }

  // El documento debe estar registrado como beneficiario
  const { data: beneficiario } = await getSupabase()
    .from("beneficiarios")
    .select("id")
    .or(`documento.eq.${docLimpio},documento.eq.${String(documento).trim()}`)
    .maybeSingle();
  if (!beneficiario) {
    return res.status(400).json({ error: "Documento no registrado" });
  }

  const { data: plato } = await getSupabase()
    .from("menus")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!plato) {
    return res.status(404).json({ error: "Plato no encontrado" });
  }

  // Ver si ya esta marcado
  const { data: existente } = await getSupabase()
    .from("favoritos")
    .select("id")
    .or(`documento.eq.${docLimpio},documento.eq.${String(documento).trim()}`)
    .eq("menu_id", req.params.id)
    .maybeSingle();

  if (deseaActivo && !existente) {
    const { error } = await getSupabase()
      .from("favoritos")
      .insert([{ documento: docLimpio, menu_id: Number(req.params.id) }]);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, favorito: true });
  }

  if (!deseaActivo && existente) {
    const { error } = await getSupabase()
      .from("favoritos")
      .delete()
      .eq("id", existente.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, favorito: false });
  }

  // Si ya estaba en el estado pedido, devolvemos ese estado: la respuesta
  // debe reflejar lo que quedó (activo -> true, desactivo -> false), no
  // inferirlo del estado previo.
  res.json({ ok: true, favorito: Boolean(deseaActivo) });
});

// GET /api/menus/todos
// Todos los menus, incluidos los borradores (para el panel: admin,
// cocina y coordinador).
router.get("/todos", requiereRol("admin", "cocina", "coordinador"), async (req, res) => {
  let consulta = getSupabase()
    .from("menus")
    .select("*")
    .order("semana", { ascending: true })
    .order("dia", { ascending: true })
    .order("jornada", { ascending: true });

  if (req.query.semana) {
    const semana = Number(req.query.semana);
    if (!Number.isInteger(semana) || semana < 1) {
      return res.status(400).json({ error: "Semana no válida" });
    }
    consulta = consulta.eq("semana", semana);
  }
  if (req.query.dia) {
    consulta = consulta.eq("dia", req.query.dia);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/menus/hoy
// La comida del dia actual (zona horaria de Colombia): todas las
// jornadas de HOY de la semana del mes vigente. La usa la Home.
// Tambien acepta ?fecha=YYYY-MM-DD para consultar un dia concreto
// (lo usa el panel de cocina). Si se pasa ?documento=YYYY..., cada
// plato incluye "esFavorito" para que la web avise "hoy toca tu favorito".
// Devuelve:
// { semana, dia, platos: [{ jornada, platillo, ... }] }
router.get("/hoy", async (req, res) => {
  let colombia;
  if (req.query.fecha) {
    const [año, mes, dia] = String(req.query.fecha).split("-").map(Number);
    if (!año || !mes || !dia) {
      return res.status(400).json({ error: "Fecha no válida" });
    }
    colombia = new Date(año, mes - 1, dia, 12, 0, 0);
  } else {
    const ahora = new Date();
    // Hora de Colombia (UTC-5) para no fallar cerca de la medianoche
    colombia = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  }
  const semana = semanaDelMes(colombia);
  const dia = diaEnEspanol(colombia);

  const { data, error } = await getSupabase()
    .from("menus")
    .select("*")
    .eq("semana", semana)
    .eq("dia", sinTildes(dia))
    .eq("estado", "publicado")
    .order("jornada", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Si viene el documento y el token coincide, marcamos cuales de los
  // platos de hoy son sus favoritos (aviso "hoy toca tu favorito").
  if (req.query.documento) {
    const doc = String(req.query.documento).trim();
    let tokenOk = false;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      try {
        const t = verificarToken(auth.slice(7));
        if (t && String(t.sub).trim() === doc) tokenOk = true;
      } catch (_e) {}
    }
    if (tokenOk) {
      const { data: favs } = await getSupabase()
        .from("favoritos")
        .select("menu_id")
        .eq("documento", doc);
      const favIds = new Set((favs || []).map((f) => f.menu_id));
      data.forEach((plato) => {
        plato.esFavorito = favIds.has(plato.id);
      });
    }
  }

  res.json({ semana, dia, platos: data });
});

// POST /api/menus
// Crea una comida del menu (solo admin o cocina).
// Cuerpo: { semana, dia, jornada, platillo, descripcion?, calorias?, imagen?, estado?, variante? }
// Si estado es "borrador" no se ve en la web hasta publicarlo.
// variante: "Estandar" | "Celiaco" | "Vegetariano" | "Vegano" (opcional).
router.post("/", requiereRol("admin", "cocina"), async (req, res) => {
  const { semana, dia, jornada, platillo, descripcion, calorias, imagen, variante } = req.body;
  const estado = req.body.estado === "borrador" ? "borrador" : "publicado";

  if (!dia || !platillo || !jornada) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  const semanaNum = Math.min(4, Math.max(1, Number(semana) || 1));

  const { data, error } = await getSupabase()
    .from("menus")
    .insert([{
      semana: semanaNum,
      dia: sinTildes(dia),
      jornada,
      platillo,
      descripcion,
      calorias: calorias || null,
      imagen: imagen || null,
      estado,
      variante: variante || "Estandar",
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/menus/:id
// Edita un plato o cambia su estado (publicar / pasar a borrador).
// Solo admin o cocina.
router.put("/:id", requiereRol("admin", "cocina"), async (req, res) => {
  const { semana, dia, jornada, platillo, descripcion, calorias, imagen, variante } = req.body;
  const { estado } = req.body;

  const cambios = {};
  if (semana !== undefined) cambios.semana = Math.min(4, Math.max(1, Number(semana) || 1));
  if (dia !== undefined) cambios.dia = sinTildes(dia);
  if (jornada !== undefined) cambios.jornada = jornada;
  if (platillo !== undefined) cambios.platillo = platillo;
  if (descripcion !== undefined) cambios.descripcion = descripcion;
  if (calorias !== undefined) cambios.calorias = calorias;
  if (imagen !== undefined) cambios.imagen = imagen;
  if (variante !== undefined) {
    const variantesValidas = ["Estandar", "Celiaco", "Vegetariano", "Vegano"];
    if (!variantesValidas.includes(variante)) {
      return res.status(400).json({ error: "Variante no válida" });
    }
    cambios.variante = variante;
  }
  if (estado !== undefined) {
    if (!["borrador", "publicado"].includes(estado)) {
      return res.status(400).json({ error: "Estado inválido" });
    }
    cambios.estado = estado;
  }

  if (Object.keys(cambios).length === 0) {
    return res.status(400).json({ error: "No hay nada que actualizar" });
  }

  const { error } = await getSupabase()
    .from("menus")
    .update(cambios)
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// DELETE /api/menus/:id
// Elimina un plato del menu (solo admin o cocina)
router.delete("/:id", requiereRol("admin", "cocina"), async (req, res) => {
  const { error } = await getSupabase()
    .from("menus")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// POST /api/menus/:id/valorar
// Guarda la valoracion de un plato (1 a 5)
// Cuerpo esperado: { puntos: 4, documento: "1234567890" }
// El documento es obligatorio (solo beneficiarios votan) y un mismo
// documento no puede votar el mismo plato dos veces.
router.post("/:id/valorar", async (req, res) => {
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId)) {
    return res.status(404).json({ error: "Plato no encontrado" });
  }
  const { puntos, documento } = req.body || {};

  const puntosNum = Number(puntos);
  if (!Number.isInteger(puntosNum) || puntosNum < 1 || puntosNum > 5) {
    return res
      .status(400)
      .json({ error: "La valoración debe ser un número entre 1 y 5" });
  }

  // El documento es obligatorio: los votos anonimos inflan las estrellas
  if (!documento) {
    return res
      .status(400)
      .json({ error: "Debes ingresar tu documento para valorar" });
  }

  // Solo el estudiante dueno del documento puede votar: se exige su token
  // (documento + PIN) y que coincida con el documento del voto. Sin esto,
  // cualquiera manipula los ratings con el documento de otro beneficiario.
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ")
    ? cabecera.slice("Bearer ".length)
    : "";
  const payload = verificarToken(token);
  if (!payload) {
    return res.status(401).json({
      error: "Debes ingresar con tu documento y PIN para calificar platos.",
    });
  }
  if (
    String(payload.sub).replace(/[\s.\-]/g, "") !==
    String(documento).replace(/[\s.\-]/g, "")
  ) {
    return res
      .status(403)
      .json({ error: "El token no coincide con el documento" });
  }

  // El documento debe estar registrado (solo beneficiarios votan)
  const { data: beneficiario } = await getSupabase()
    .from("beneficiarios")
    .select("id")
    .eq("documento", String(documento).trim())
    .maybeSingle();

  if (!beneficiario) {
    return res.status(400).json({ error: "Documento no registrado" });
  }

  // El plato debe existir (si no, 404, no un error de base de datos)
  const { data: plato } = await getSupabase()
    .from("menus")
    .select("id")
    .eq("id", menuId)
    .maybeSingle();

  if (!plato) {
    return res.status(404).json({ error: "Plato no encontrado" });
  }

  // Evitar votos repetidos del mismo documento en el mismo plato
  const { data: yaVoto } = await getSupabase()
    .from("valoraciones")
    .select("id")
    .eq("menu_id", menuId)
    .eq("documento", String(documento).trim())
    .maybeSingle();

  if (yaVoto) {
    // Si ya voto, actualizamos su puntaje en vez de crear otro
    const { data, error } = await getSupabase()
      .from("valoraciones")
      .update({ puntos: puntosNum })
      .eq("id", yaVoto.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await getSupabase()
    .from("valoraciones")
    .insert([{ menu_id: menuId, puntos: puntosNum, documento: String(documento).trim() }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
