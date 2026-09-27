// Claves/PIN con scrypt de Node (sin dependencias externas).
// El hash se guarda como "sal:hash".
import crypto from "node:crypto";

const LONGITUD = 64;

export function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(clave), sal, LONGITUD).toString("hex");
  return `${sal}:${hash}`;
}

// Compara en tiempo constante para no filtrar cuanto del hash coincide.
export function verificarClave(clave, almacenado) {
  if (typeof almacenado !== "string" || !almacenado.includes(":")) return false;
  const [sal, hash] = almacenado.split(":");
  const derivada = crypto.scryptSync(String(clave), sal, LONGITUD);
  const esperada = Buffer.from(hash, "hex");
  return (
    derivada.length === esperada.length && crypto.timingSafeEqual(derivada, esperada)
  );
}
