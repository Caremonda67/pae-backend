// Firma de tokens (HMAC) para el panel y los estudiantes (documento/PIN).
import crypto from "node:crypto";

// Clave del login de admin, en el .env. Con ella vacia, ese login se bloquea.
const ADMIN_CLAVE = process.env.ADMIN_CLAVE || null;

// Secreto de firma: ADMIN_SECRET si esta, si no la clave del admin, si no uno al azar.
const SECRETO =
  process.env.ADMIN_SECRET || ADMIN_CLAVE || crypto.randomBytes(32).toString("hex");

// Validez del token: 12 horas (una jornada escolar)
const EXPIRACION_MS = 12 * 60 * 60 * 1000;

export const ROLES = ["admin", "cocina", "profesor", "coordinador", "estudiante"];

// ¿Esta configurada la clave del panel?
export function adminConfigurado() {
  return Boolean(ADMIN_CLAVE);
}

// Genera un token firmado: <payload-base64url>.<firma>
// El payload lleva el rol para saber que puede hacer cada usuario.
export function firmarToken({ usuario, rol, nombre }) {
  const payload = {
    sub: usuario,
    rol,
    nombre,
    exp: Date.now() + EXPIRACION_MS,
  };
  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = crypto
    .createHmac("sha256", SECRETO)
    .update(base64)
    .digest("base64url");
  return `${base64}.${firma}`;
}

// Devuelve el payload si la firma y la expiracion son correctas.
export function verificarToken(token) {
  if (!token || typeof token !== "string") return null;

  const [base64, firma] = token.split(".");
  if (!base64 || !firma) return null;

  const esperada = crypto
    .createHmac("sha256", SECRETO)
    .update(base64)
    .digest("base64url");
  const firmoA = Buffer.from(esperada);
  const firmoB = Buffer.from(firma);
  const firmaValida =
    firmoA.length === firmoB.length && crypto.timingSafeEqual(firmoA, firmoB);
  if (!firmaValida) return null;

  try {
    const payload = JSON.parse(Buffer.from(base64, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Lee el payload del token del header Authorization: Bearer <token>
export function leerToken(req) {
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ")
    ? cabecera.slice("Bearer ".length)
    : "";
  return verificarToken(token);
}

// Exige sesion valida y un rol permitido; deja el usuario en req.
export function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    const payload = leerToken(req);
    if (!payload) {
      return res.status(401).json({ error: "No autorizado. Inicia sesion." });
    }
    if (!rolesPermitidos.includes(payload.rol)) {
      return res.status(403).json({
        error: "Tu rol no tiene permiso para esta accion.",
      });
    }
    req.usuario = payload;
    next();
  };
}

export const requiereAdmin = requiereRol("admin");

// Solo pide una sesion valida, sin exigir un rol concreto.
export const requiereSesion = requiereRol(...ROLES);
