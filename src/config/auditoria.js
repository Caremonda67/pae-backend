// Traza de acciones del panel (tabla auditoria). Fallar al auditar
// nunca rompe la accion principal, por eso el try/catch silencioso.
import { getSupabase } from "./supabase.js";

// Etiquetas legibles para los nombres de campo que pueden aparecer en
// el detalle de una accion (el admin no debe ver "clave_hash" ni "id 13").
const ETIQUETA_CAMPO = {
  activo: "estado activo",
  alergias: "alergias",
  clave_hash: "contraseña/PIN",
  cupos_sede: "cupos por sede",
  documento: "documento",
  grado: "grado",
  hora_limite_reserva: "hora límite de reserva",
  nombre: "nombre",
  preferencias: "preferencia de menú",
  rol: "rol",
  sede: "sede",
  turno: "turno",
  usuario: "usuario",
};

// Convierte una lista de campos ("clave_hash", "nombre", ...) en su
// version legible para guardarla en el detalle de la auditoria.
export function etiquetasDe(campos) {
  return (campos || []).map((campo) => ETIQUETA_CAMPO[campo] || String(campo));
}

// Detalle legible de un cambio de configuracion: la hora limite como
// "hora límite de reserva: 08:00" y los cupos como "Sede A → 40".
export function detallesSettings(filas) {
  return (filas || [])
    .map((f) => {
      if (f.clave === "hora_limite_reserva") {
        return `hora límite de reserva: ${f.valor || "sin límite"}`;
      }
      if (f.clave === "cupos_sede") {
        let cupos = {};
        try {
          cupos = JSON.parse(f.valor || "{}");
        } catch {
          cupos = {};
        }
        const partes = Object.entries(cupos).map(([sede, cupo]) => `${sede} → ${cupo}`);
        return partes.length ? `cupos por sede: ${partes.join(", ")}` : "cupos por sede: sin cupos";
      }
      return `${ETIQUETA_CAMPO[f.clave] || f.clave}=${f.valor}`;
    })
    .join(" | ");
}

// Detalle de un cambio de edicion con los valores antes y despues, por
// ejemplo "rol: cocina → profesor" o "nombre: A → B". Para activo usa
// "activo → inactivo" y para la clave solo indica que fue actualizada.
export function detalleCambios(cambios, antes) {
  return Object.entries(cambios || {})
    .map(([campo, nuevo]) => {
      const etiqueta = ETIQUETA_CAMPO[campo] || String(campo);
      const legible = (v) => (v === null || v === undefined ? "sin valor" : String(v));
      if (campo === "clave_hash") return `${etiqueta}: actualizada`;
      if (campo === "activo") {
        const estado = (v) => (v ? "activo" : "inactivo");
        return `${etiqueta}: ${estado(antes?.[campo])} → ${estado(nuevo)}`;
      }
      const viejo = antes?.[campo];
      return viejo === undefined || viejo === null
        ? `${etiqueta}: ${legible(nuevo)}`
        : `${etiqueta}: ${legible(viejo)} → ${legible(nuevo)}`;
    })
    .join(", ");
}

export async function registrarAuditoria({ usuario, rol, accion, detalle }) {
  try {
    await getSupabase().from("auditoria").insert([
      {
        usuario: usuario || null,
        rol: rol || null,
        accion: accion || "accion",
        detalle: detalle || null,
      },
    ]);
  } catch {
    // la tabla puede no existir aun; no debe tumbar la accion
  }
}

// Atajo: usa el usuario y rol que dejo requiereRol en req.
export function auditar(req, accion, detalle) {
  return registrarAuditoria({
    usuario: req.usuario?.sub || null,
    rol: req.usuario?.rol || null,
    accion,
    detalle,
  });
}
