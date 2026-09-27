// rutas de los turnos de cocina
// el coordinador (o el admin) asigna que personal de cocina cubre
// cada fecha y en que sede, para tener claro quien responde cada dia.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";
import { auditar } from "../config/auditoria.js";

const router = Router();

// GET /api/turnos
// Lista los turnos de cocina. Filtro opcional: ?fecha=YYYY-MM-DD
// Ordenados por fecha y sede para ver la semana de un vistazo.
router.get("/", requiereRol("admin", "coordinador"), async (req, res) => {
  let consulta = getSupabase()
    .from("turnos_cocina")
    .select("*")
    .order("fecha", { ascending: true })
    .order("sede", { ascending: true });

  if (req.query.fecha) {
    consulta = consulta.eq("fecha", req.query.fecha);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/turnos/usuario?usuario=...
// Turnos asignados a un usuario de cocina concreto (para su vista)
router.get("/usuario", requiereRol("admin", "coordinador", "cocina"), async (req, res) => {
  const { usuario } = req.query;
  if (!usuario) {
    return res.status(400).json({ error: "Falta el usuario" });
  }

  const { data, error } = await getSupabase()
    .from("turnos_cocina")
    .select("*")
    .eq("usuario", usuario)
    .order("fecha", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/turnos
// Asigna un turno. Si el usuario ya tiene un turno esa fecha, se
// actualiza la sede en vez de crear un duplicado.
// Cuerpo: { fecha: "2026-08-14", usuario: "maria", sede: "Sede A" }
router.post("/", requiereRol("admin", "coordinador"), async (req, res) => {
  const { fecha, usuario, sede } = req.body;

  if (!fecha || !usuario || !sede) {
    return res.status(400).json({ error: "Faltan fecha, usuario o sede" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Fecha no válida" });
  }

  // Si el usuario ya tiene turno esa fecha, lo actualizamos
  const { data: existente } = await getSupabase()
    .from("turnos_cocina")
    .select("id")
    .eq("fecha", fecha)
    .eq("usuario", usuario)
    .maybeSingle();

  if (existente) {
    const { data, error } = await getSupabase()
      .from("turnos_cocina")
      .update({ sede })
      .eq("id", existente.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    auditar(req, "turnos:asignar", `${fecha} | ${usuario} | ${sede}`);
    return res.json(data);
  }

  const { data, error } = await getSupabase()
    .from("turnos_cocina")
    .insert([{ fecha, usuario, sede, creado_por: req.usuario?.sub || null }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "turnos:asignar", `${fecha} | ${usuario} | ${sede}`);
  res.status(201).json(data);
});

// DELETE /api/turnos/:id
// Quita un turno asignado
router.delete("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { data: turno } = await getSupabase()
    .from("turnos_cocina")
    .select("fecha, usuario, sede")
    .eq("id", req.params.id)
    .maybeSingle();

  const { error } = await getSupabase()
    .from("turnos_cocina")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  auditar(
    req,
    "turnos:quitar",
    turno ? `${turno.fecha} | ${turno.usuario} | ${turno.sede}` : `registro interno ${req.params.id}`
  );
  res.status(204).end();
});

export default router;
