// rutas de auditoria
// registro de las acciones del panel. Solo el admin lo consulta.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";

const router = Router();

// GET /api/auditoria
// Ultimas acciones registradas. Filtros opcionales:
//   ?accion=beneficiarios:crear   (por tipo de accion)
//   ?usuario=juan                 (por quien la hizo)
//   ?limite=50                    (cuantas, por defecto 100, max 500)
router.get("/", requiereRol("admin"), async (req, res) => {
  const { accion, usuario } = req.query;
  const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));

  let consulta = getSupabase()
    .from("auditoria")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limite);

  if (accion) consulta = consulta.eq("accion", accion);
  if (usuario) consulta = consulta.ilike("usuario", `%${usuario}%`);

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
