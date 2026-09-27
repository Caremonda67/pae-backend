// rutas de incidentes / alergias
// el profesor reporta un incidente o una alergia de un estudiante de
// su grupo y el reporte queda a la vista del coordinador (y del admin),
// que puede marcarlo como resuelto. Cada profesor solo ve sus reportes.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";

const router = Router();

// Fecha de hoy en YYYY-MM-DD (zona del servidor, Colombia UTC-5)
function hoyColombia() {
  const ahora = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, "0")}-${String(ahora.getUTCDate()).padStart(2, "0")}`;
}

// Valida que una fecha tenga formato YYYY-MM-DD y sea real
function fechaValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [año, mes, dia] = fecha.split("-").map(Number);
  const f = new Date(año, mes - 1, dia);
  return f.getFullYear() === año && f.getMonth() === mes - 1 && f.getDate() === dia;
}

// Lee el grupo del profesor en sesion (sede, turno, grado) desde su cuenta
async function grupoDelProfesor(usuario) {
  const { data, error } = await getSupabase()
    .from("usuarios")
    .select("sede, turno, grado, nombre")
    .eq("usuario", usuario)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// GET /api/incidentes/estudiantes
// Para el profesor: los beneficiarios de su grupo (sede + turno + grado),
// para que pueda elegir al estudiante del reporte sin escribirlo a mano.
router.get("/estudiantes", requiereRol("profesor"), async (req, res) => {
  let cuenta;
  try {
    cuenta = await grupoDelProfesor(req.usuario.sub);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!cuenta?.sede || !cuenta?.turno || !cuenta?.grado) {
    return res.status(400).json({
      error: "Tu cuenta no tiene un grupo asignado (sede, turno y grado). Pide al administrador que lo configure.",
    });
  }

  // Un estudiante con turno "Ambas jornadas" pertenece al grupo del
  // profesor en cualquier jornada; si el profesor cubre ambas jornadas,
  // ve a todos los beneficiarios de su sede y grado.
  const { data, error } = await getSupabase()
    .from("beneficiarios")
    .select("documento, nombre, sede, turno, grado")
    .eq("sede", cuenta.sede)
    .eq("grado", cuenta.grado)
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const estudiantes = (data || []).filter(
    (b) =>
      cuenta.turno === "Ambas jornadas" ||
      b.turno === cuenta.turno ||
      b.turno === "Ambas jornadas"
  );

  res.json({
    grupo: { sede: cuenta.sede, turno: cuenta.turno, grado: cuenta.grado },
    estudiantes,
  });
});

// GET /api/incidentes?resuelto=true|false
// Coordinador y admin: todos los reportes (opcional filtrar por estado).
// Profesor: solo los que el mismo registro.
router.get("/", requiereRol("profesor", "admin", "coordinador"), async (req, res) => {
  let query = getSupabase()
    .from("incidentes")
    .select("*");

  if (req.usuario.rol === "profesor") {
    query = query.eq("reportado_por", req.usuario.sub);
  }

  if (req.query.resuelto === "true" || req.query.resuelto === "false") {
    query = query.eq("resuelto", req.query.resuelto === "true");
  }

  const { data, error } = await query
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/incidentes
// Reporta un incidente o alergia de un estudiante registrado.
// Cuerpo: { tipo: "Incidente"|"Alergia", documento, descripcion, fecha?, imagen? }
router.post("/", requiereRol("profesor", "admin", "coordinador"), async (req, res) => {
  const { tipo, documento, descripcion, fecha, imagen } = req.body || {};

  const tipoLimpio = tipo ? String(tipo).trim() : "";
  if (tipoLimpio !== "Incidente" && tipoLimpio !== "Alergia") {
    return res.status(400).json({ error: "El tipo debe ser Incidente o Alergia" });
  }
  if (!documento || !String(documento).trim()) {
    return res.status(400).json({ error: "Selecciona el estudiante" });
  }
  if (!descripcion || !String(descripcion).trim()) {
    return res.status(400).json({ error: "Escribe qué ocurrió" });
  }

  const fechaFinal = fecha || hoyColombia();
  if (!fechaValida(fechaFinal)) {
    return res.status(400).json({ error: "Fecha no válida" });
  }

  // El estudiante debe existir en el registro de beneficiarios
  const { data: ben, error: errBen } = await getSupabase()
    .from("beneficiarios")
    .select("documento, nombre, sede, turno, grado")
    .eq("documento", String(documento).trim())
    .maybeSingle();

  if (errBen) return res.status(500).json({ error: errBen.message });
  if (!ben) return res.status(404).json({ error: "Ese documento no está registrado como beneficiario" });

  const { data, error } = await getSupabase()
    .from("incidentes")
    .insert([
      {
        tipo: tipoLimpio,
        estudiante: ben.nombre,
        documento: ben.documento,
        sede: ben.sede,
        grado: ben.grado,
        descripcion: String(descripcion).trim(),
        fecha: fechaFinal,
        imagen: typeof imagen === "string" && imagen.trim() ? imagen.trim() : null,
        reportado_por: req.usuario.sub,
        resuelto: false,
      },
    ])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/incidentes/:id
// El profesor edita los datos de SUS reportes (tipo, estudiante,
// descripcion, fecha y foto). El coordinador o el admin, en cambio,
// marca el reporte como resuelto (o lo reabre).
router.put("/:id", requiereRol("profesor", "admin", "coordinador"), async (req, res) => {
  const { data: existente, error: errExistente } = await getSupabase()
    .from("incidentes")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errExistente) return res.status(500).json({ error: errExistente.message });
  if (!existente) return res.status(404).json({ error: "Reporte no encontrado" });

  // --- Profesor: edita su propio reporte --------------------------
  if (req.usuario.rol === "profesor") {
    if (existente.reportado_por !== req.usuario.sub) {
      return res.status(403).json({ error: "Solo puedes editar tus propios reportes" });
    }

    const { tipo, documento, descripcion, fecha, imagen } = req.body || {};

    const tipoLimpio = tipo ? String(tipo).trim() : "";
    if (tipoLimpio !== "Incidente" && tipoLimpio !== "Alergia") {
      return res.status(400).json({ error: "El tipo debe ser Incidente o Alergia" });
    }
    if (!documento || !String(documento).trim()) {
      return res.status(400).json({ error: "Selecciona el estudiante" });
    }
    if (!descripcion || !String(descripcion).trim()) {
      return res.status(400).json({ error: "Escribe qué ocurrió" });
    }

    const fechaFinal = fecha || existente.fecha;
    if (!fechaValida(fechaFinal)) {
      return res.status(400).json({ error: "Fecha no válida" });
    }

    // Revalidamos el estudiante por si cambió el documento
    const { data: ben } = await getSupabase()
      .from("beneficiarios")
      .select("documento, nombre, sede, grado")
      .eq("documento", String(documento).trim())
      .maybeSingle();
    if (!ben) {
      return res.status(404).json({ error: "Ese documento no está registrado como beneficiario" });
    }

    const cambios = {
      tipo: tipoLimpio,
      estudiante: ben.nombre,
      documento: ben.documento,
      sede: ben.sede,
      grado: ben.grado,
      descripcion: String(descripcion).trim(),
      fecha: fechaFinal,
      imagen: typeof imagen === "string" && imagen.trim() ? imagen.trim() : null,
    };

    const { data, error } = await getSupabase()
      .from("incidentes")
      .update(cambios)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // --- Coordinador / admin: cambiar el estado resuelto -------------
  const { resuelto } = req.body || {};
  if (typeof resuelto !== "boolean") {
    return res.status(400).json({ error: "El campo resuelto debe ser verdadero o falso" });
  }

  const cambios = { resuelto };
  if (resuelto) {
    cambios.resuelto_por = req.usuario.sub;
    cambios.resuelto_at = new Date().toISOString();
  } else {
    cambios.resuelto_por = null;
    cambios.resuelto_at = null;
  }

  const { data, error } = await getSupabase()
    .from("incidentes")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/incidentes/:id
// El profesor borra sus propios reportes; coordinador o admin cualquiera.
router.delete("/:id", requiereRol("profesor", "admin", "coordinador"), async (req, res) => {
  const { data: existente, error: errExistente } = await getSupabase()
    .from("incidentes")
    .select("id, reportado_por")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errExistente) return res.status(500).json({ error: errExistente.message });
  if (!existente) return res.status(404).json({ error: "Reporte no encontrado" });

  if (req.usuario.rol === "profesor" && existente.reportado_por !== req.usuario.sub) {
    return res.status(403).json({ error: "Solo puedes borrar tus propios reportes" });
  }

  const { error } = await getSupabase()
    .from("incidentes")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
