// rutas de instituciones educativas
// la lista alimenta la metrica real de la Home y el panel admin
// permite agregar y quitar instituciones.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";

const router = Router();

// GET /api/instituciones
// Lista todas las instituciones (publicas)
router.get("/", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("instituciones")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/instituciones
// Registra una institucion nueva (solo admin)
// Cuerpo esperado: { nombre }
router.post("/", requiereRol("admin", "coordinador"), async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre de la institución" });
  }

  const { data, error } = await getSupabase()
    .from("instituciones")
    .insert([{ nombre: nombre.trim() }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/instituciones/:id
// Quita una institucion (solo admin)
router.delete("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { error } = await getSupabase()
    .from("instituciones")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
