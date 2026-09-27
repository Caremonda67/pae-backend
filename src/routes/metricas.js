// rutas de metricas de la Home
// devuelve los conteos REALES de la base para la seccion de numeros:
// estudiantes beneficiarios, instituciones educativas y minutas reservadas.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";

const router = Router();

// GET /api/metricas
// Cuenta filas reales de cada tabla. Si alguna falla, esa metrica se
// muestra en 0 para que la Home nunca se caiga.
router.get("/", async (_req, res) => {
  const supabase = getSupabase();

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

  res.json({ estudiantes, instituciones, minutas });
});

export default router;
