// rutas de las sedes (puntos de atencion del PAE)
// la lista alimenta la reserva, el registro de beneficiarios y el
// panel admin. El admin puede agregar, renombrar y quitar sedes.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";
import { auditar } from "../config/auditoria.js";

const router = Router();

// GET /api/sedes
// Lista todas las sedes (publicas, se usan en la reserva y la Home)
router.get("/", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("sedes")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/sedes
// Registra una sede nueva (solo admin)
// Cuerpo esperado: { nombre }
router.post("/", requiereRol("admin"), async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre de la sede" });
  }

  const { data, error } = await getSupabase()
    .from("sedes")
    .insert([{ nombre: nombre.trim() }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "sedes:crear", `"${nombre.trim()}"`);
  res.status(201).json(data);
});

// PUT /api/sedes/:id
// Renombra una sede (solo admin). Tambien actualiza el nombre en los
// beneficiarios y reservas que la usaban, para no dejar datos viejos.
// Cuerpo esperado: { nombre }
router.put("/:id", requiereRol("admin"), async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre de la sede" });
  }
  const nuevo = nombre.trim();

  const { data: sede, error: errSede } = await getSupabase()
    .from("sedes")
    .select("nombre")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errSede) return res.status(500).json({ error: errSede.message });
  if (!sede) return res.status(404).json({ error: "Sede no encontrada" });

  const viejo = sede.nombre;
  const { data, error } = await getSupabase()
    .from("sedes")
    .update({ nombre: nuevo })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Actualizamos los registros que usaban el nombre anterior
  await getSupabase().from("beneficiarios").update({ sede: nuevo }).eq("sede", viejo);
  await getSupabase().from("reservas").update({ sede: nuevo }).eq("sede", viejo);
  await getSupabase().from("sobrantes").update({ sede: nuevo }).eq("sede", viejo);

  auditar(req, "sedes:renombrar", `"${viejo}" → "${nuevo}"`);
  res.json(data);
});

// DELETE /api/sedes/:id
// Quita una sede (solo admin). No se borra si todavia tiene
// beneficiarios registrados para no dejar estudiantes sin sede.
router.delete("/:id", requiereRol("admin"), async (req, res) => {
  const { data: sede, error: errSede } = await getSupabase()
    .from("sedes")
    .select("nombre")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errSede) return res.status(500).json({ error: errSede.message });
  if (!sede) return res.status(404).json({ error: "Sede no encontrada" });

  const { count, error: errBen } = await getSupabase()
    .from("beneficiarios")
    .select("*", { count: "exact", head: true })
    .eq("sede", sede.nombre);

  if (errBen) return res.status(500).json({ error: errBen.message });
  if (count > 0) {
    return res.status(400).json({
      error: `No se puede borrar la sede: tiene ${count} beneficiario(s) registrado(s). Renómbrala o reasigna esos estudiantes primero.`,
    });
  }

  const { error } = await getSupabase()
    .from("sedes")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "sedes:borrar", `"${sede.nombre}"`);
  res.status(204).end();
});

export default router;
