// rutas de colaboradores del PAE
// la lista alimenta la metrica real de la Home y el panel admin
// permite agregar y quitar colaboradores.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";

const router = Router();

// GET /api/colaboradores
// Lista todos los colaboradores (publicos)
router.get("/", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("colaboradores")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/colaboradores
// Registra un colaborador nuevo (solo admin)
// Cuerpo esperado: { nombre, rol }
router.post("/", requiereRol("admin", "coordinador"), async (req, res) => {
  const { nombre, rol } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del colaborador" });
  }

  const { data, error } = await getSupabase()
    .from("colaboradores")
    .insert([{ nombre: nombre.trim(), rol: rol || null }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/colaboradores/:id
// Quita un colaborador (solo admin)
router.delete("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { error } = await getSupabase()
    .from("colaboradores")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
