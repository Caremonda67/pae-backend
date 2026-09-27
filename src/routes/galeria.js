// rutas de la galeria
// el administrador publica fotos propias del programa (eventos,
// equipo, novedades) con un titulo. La Home las muestra junto con
// las fotos de los platos del menu y los avisos.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";

const router = Router();

// GET /api/galeria
// Lista las fotos de la galeria (publicas)
router.get("/", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("galeria")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/galeria
// Guarda una foto nueva (solo admin)
// Cuerpo esperado: { titulo, imagen, descripcion }
router.post("/", requiereRol("admin", "coordinador"), async (req, res) => {
  const { titulo, imagen, descripcion } = req.body;

  if (!titulo || !imagen) {
    return res.status(400).json({ error: "Faltan el título o la imagen" });
  }

  const { data, error } = await getSupabase()
    .from("galeria")
    .insert([{ titulo, imagen, descripcion: descripcion || null }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/galeria/:id
// Borra una foto (solo admin)
router.delete("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { error } = await getSupabase()
    .from("galeria")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
