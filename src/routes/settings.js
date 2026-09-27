// rutas de la configuracion del sistema (tabla settings)
// la administra el admin desde el panel: hora limite de reserva y
// cupo maximo de reservas por sede. Son valores globales que antes
// habria que cambiar en el codigo; ahora se cambian desde el panel.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { invalidarSettings } from "../config/settings.js";
import { requiereRol } from "../config/auth.js";
import { auditar, detallesSettings } from "../config/auditoria.js";

const router = Router();

// GET /api/settings
// Devuelve la configuracion actual, por ejemplo:
// { hora_limite_reserva: "08:00", cupos_sede: { "Sede A": 50 } }
router.get("/", async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("settings")
    .select("clave, valor");

  if (error) return res.status(500).json({ error: error.message });

  const config = {};
  for (const fila of data || []) config[fila.clave] = fila.valor;

  // El cupo llega como JSON; lo devolvemos ya parseado para el panel
  let cupos = {};
  try {
    cupos = JSON.parse(config.cupos_sede || "{}") || {};
  } catch {
    cupos = {};
  }

  res.json({
    hora_limite_reserva: config.hora_limite_reserva || null,
    cupos_sede: cupos,
  });
});

// PUT /api/settings
// Actualiza la configuracion (solo admin).
// Cuerpo (pueden llegar uno o ambos): 
//   { hora_limite_reserva: "08:00" | null, cupos_sede: { "Sede A": 50 } }
// Pasar null en hora_limite_reserva la desactiva (sin limite).
// Pasar {} en cupos_sede quita todos los cupos.
router.put("/", requiereRol("admin"), async (req, res) => {
  const { hora_limite_reserva, cupos_sede } = req.body || {};

  const filas = [];

  if (hora_limite_reserva !== undefined) {
    if (hora_limite_reserva === null || hora_limite_reserva === "") {
      filas.push({ clave: "hora_limite_reserva", valor: null });
    } else {
      const valor = String(hora_limite_reserva).trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) {
        return res
          .status(400)
          .json({ error: "La hora límite debe tener formato HH:MM (ej: 08:00)" });
      }
      filas.push({ clave: "hora_limite_reserva", valor });
    }
  }

  if (cupos_sede !== undefined) {
    if (cupos_sede === null || typeof cupos_sede !== "object" || Array.isArray(cupos_sede)) {
      return res
        .status(400)
        .json({ error: "Los cupos deben ser un objeto con la sede y su cupo" });
    }
    // Solo numeros enteros positivos (o 0 para "sin cupo")
    const limpio = {};
    for (const [sede, cupo] of Object.entries(cupos_sede)) {
      const numero = Number(cupo);
      if (!Number.isInteger(numero) || numero < 0) {
        return res
          .status(400)
          .json({ error: `El cupo de "${sede}" debe ser un número entero (0 o más)` });
      }
      limpio[sede] = numero;
    }
    filas.push({ clave: "cupos_sede", valor: JSON.stringify(limpio) });
  }

  if (filas.length === 0) {
    return res.status(400).json({ error: "No hay nada que actualizar" });
  }

  // Guardamos cada clave con upsert (crea o actualiza)
  const supabase = getSupabase();
  for (const fila of filas) {
    const { error } = await supabase
      .from("settings")
      .upsert(fila, { onConflict: "clave" });
    if (error) return res.status(500).json({ error: error.message });
  }

  auditar(req, "configuracion:actualizar", detallesSettings(filas));
  invalidarSettings();
  res.json({ ok: true });
});

export default router;
