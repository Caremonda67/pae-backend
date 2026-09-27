// rutas de asistencia del profesor
// cada profesor tiene un grupo asignado (sede + turno + grado) que
// guarda el administrador en su cuenta. Aca el profesor ve SOLO los
// reservados de su grupo para la fecha elegida y marca quien asistio.

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

// GET /api/asistencia/grupo?fecha=YYYY-MM-DD
// Devuelve el grupo del profesor (sede + turno + grado) y los reservados
// de ese grupo para la fecha, en orden por grado y nombre de estudiante.
router.get("/grupo", requiereRol("profesor"), async (req, res) => {
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

  const fecha = req.query.fecha || hoyColombia();
  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: "Fecha no válida" });
  }

  // Las reservas guardan siempre una jornada puntual, así que si el
  // profesor cubre "Ambas jornadas" no filtramos por turno.
  let query = getSupabase()
    .from("reservas")
    .select("id, estudiante, documento, grado, turno, asistio")
    .eq("fecha", fecha)
    .eq("sede", cuenta.sede)
    .eq("grado", cuenta.grado);
  if (cuenta.turno !== "Ambas jornadas") {
    query = query.eq("turno", cuenta.turno);
  }
  const { data, error } = await query
    .order("grado", { ascending: true })
    .order("estudiante", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    fecha,
    grupo: {
      sede: cuenta.sede,
      turno: cuenta.turno,
      grado: cuenta.grado,
    },
    reservas: data,
  });
});

// PUT /api/asistencia/:id
// Marca si un estudiante del grupo asistio (o no). Cuerpo: { asistio }
// Valida que la reserva pertenezca al grupo del profesor en sesion,
// asi un profesor no puede marcar estudiantes de otro grupo.
router.put("/:id", requiereRol("profesor"), async (req, res) => {
  const { asistio } = req.body || {};
  if (typeof asistio !== "boolean") {
    return res.status(400).json({ error: "El campo asistio debe ser verdadero o falso" });
  }

  let cuenta;
  try {
    cuenta = await grupoDelProfesor(req.usuario.sub);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!cuenta?.sede || !cuenta?.turno || !cuenta?.grado) {
    return res.status(400).json({ error: "Tu cuenta no tiene un grupo asignado." });
  }

  const { data: reserva, error: errReserva } = await getSupabase()
    .from("reservas")
    .select("id, sede, turno, grado")
    .eq("id", req.params.id)
    .maybeSingle();

  if (errReserva) return res.status(500).json({ error: errReserva.message });
  if (!reserva) return res.status(404).json({ error: "Reserva no encontrada" });

  // El profesor con "Ambas jornadas" puede marcar reservas de cualquier
  // turno de su sede y grado.
  const turnoCoincide =
    cuenta.turno === "Ambas jornadas" || reserva.turno === cuenta.turno;

  if (
    reserva.sede !== cuenta.sede ||
    !turnoCoincide ||
    reserva.grado !== cuenta.grado
  ) {
    return res.status(403).json({ error: "Esa reserva no es de tu grupo" });
  }

  const { data, error } = await getSupabase()
    .from("reservas")
    .update({ asistio })
    .eq("id", reserva.id)
    .select("id, estudiante, documento, grado, turno, asistio")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
