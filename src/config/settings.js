// Configuracion del sistema (tabla settings); si esta vacia, valores por defecto.
import { getSupabase } from "./supabase.js";

// Cache de 60s; se invalida a mano con invalidarSettings().
let _cache = null;
let _cacheTs = 0;
const TTL_MS = 60_000;

export function invalidarSettings() {
  _cache = null;
}

export async function leerSettings() {
  if (_cache && Date.now() - _cacheTs < TTL_MS) return _cache;
  const { data, error } = await getSupabase()
    .from("settings")
    .select("clave, valor");

  if (error) {
    return { hora_limite_reserva: null, cupos_sede: {} };
  }

  const filas = {};
  for (const fila of data || []) filas[fila.clave] = fila.valor;

  let cupos = {};
  try {
    cupos = JSON.parse(filas.cupos_sede || "{}") || {};
  } catch {
    cupos = {};
  }

  _cache = {
    hora_limite_reserva: filas.hora_limite_reserva || null,
    cupos_sede: cupos,
  };
  _cacheTs = Date.now();
  return _cache;
}
