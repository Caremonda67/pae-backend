// Cuentas del sistema (usuario + clave); para estudiantes el usuario es
// su documento. Solo el admin las gestiona: GET lista (nunca expone la
// clave real, solo el hash), POST, PUT (activa/desactiva/cambia clave) y DELETE.
import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol, ROLES } from "../config/auth.js";
import { hashClave } from "../config/password.js";
import { auditar, detalleCambios } from "../config/auditoria.js";

const router = Router();

// Turnos validos del servicio (mismos del panel de cocina)
const TURNOS = ["Almuerzo", "Refrigerio"];

// Valida que el grupo de un profesor (sede + turno + grado) este completo
function errorGrupoProfesor(cuenta) {
  const { rol, sede, turno, grado } = cuenta || {};
  if (rol === "profesor") {
    if (!sede || !String(sede).trim()) return "Un profesor necesita una sede asignada.";
    if (!turno || !TURNOS.includes(turno)) return "Un profesor necesita un turno válido (Almuerzo o Refrigerio).";
    if (!grado || !String(grado).trim()) return "Un profesor necesita un grado asignado.";
  }
  return null;
}

// GET /api/usuarios
// Lista las cuentas. Solo admin. Nunca se devuelve ninguna clave:
// si el admin quiere cambiarla, la edita y listo.
router.get("/", requiereRol("admin"), async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("usuarios")
    .select("id, nombre, usuario, rol, activo, sede, turno, grado, created_at")
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/usuarios/cocina
// Lista el personal de cocina activo (para asignar turnos). Lo usan el
// admin y el coordinador desde la pestana "Turnos".
router.get("/cocina", requiereRol("admin", "coordinador"), async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("usuarios")
    .select("id, usuario, nombre, rol, activo, sede")
    .eq("rol", "cocina")
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/usuarios
// Crea una cuenta. Cuerpo: { nombre, usuario, clave, rol, sede?, turno?, grado? }
// Para un estudiante, usuario = su documento y clave = su PIN.
// Para un profesor, sede + turno + grado son obligatorios (su grupo).
router.post("/", requiereRol("admin"), async (req, res) => {
  const { nombre, usuario, clave, rol, sede, turno, grado } = req.body || {};

  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: "Falta el nombre" });
  }
  if (!usuario || !String(usuario).trim()) {
    return res.status(400).json({ error: "Falta el usuario" });
  }
  if (!clave || String(clave).length < 4) {
    return res.status(400).json({ error: "La clave o PIN debe tener al menos 4 caracteres" });
  }
  if (!ROLES.includes(rol)) {
    return res.status(400).json({ error: `Rol invalido. Usa uno de: ${ROLES.join(", ")}` });
  }

  const errorGrupo = errorGrupoProfesor({ rol, sede, turno, grado });
  if (errorGrupo) return res.status(400).json({ error: errorGrupo });

  // El usuario no se debe repetir (documento de estudiante unico)
  const { data: existente, error: errExiste } = await getSupabase()
    .from("usuarios")
    .select("id")
    .eq("usuario", String(usuario).trim())
    .maybeSingle();

  if (errExiste) return res.status(500).json({ error: errExiste.message });
  if (existente) {
    return res.status(400).json({ error: "Ese usuario ya tiene cuenta" });
  }

  const { data, error } = await getSupabase()
    .from("usuarios")
    .insert([
      {
        nombre: String(nombre).trim(),
        usuario: String(usuario).trim(),
        clave_hash: hashClave(clave),
        rol,
        sede: rol === "profesor" ? String(sede).trim() : null,
        turno: rol === "profesor" ? turno : null,
        grado: rol === "profesor" ? String(grado).trim() : null,
      },
    ])
    .select("id, nombre, usuario, rol, activo, sede, turno, grado, created_at")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "usuarios:crear", `"${String(usuario).trim()}" (${rol})`);
  res.status(201).json(data);
});

// PUT /api/usuarios/:id
// Edita los datos de una cuenta (nombre, usuario, rol, grupo del
// profesor), la activa o desactiva, o cambia su clave/PIN. Solo admin.
// Cuerpo: { activo?, clave?, nombre?, usuario?, rol?, sede?, turno?, grado? }
router.put("/:id", requiereRol("admin"), async (req, res) => {
  const { activo, clave, nombre, usuario, rol, sede, turno, grado } = req.body || {};

  // Validamos cada campo antes de armar la actualizacion
  if (usuario !== undefined && !String(usuario).trim()) {
    return res.status(400).json({ error: "El usuario no puede quedar vacío" });
  }
  if (rol !== undefined && !ROLES.includes(rol)) {
    return res.status(400).json({ error: `Rol invalido. Usa uno de: ${ROLES.join(", ")}` });
  }
  if (clave !== undefined && String(clave).length < 4) {
    return res.status(400).json({ error: "La clave o PIN debe tener al menos 4 caracteres" });
  }
  if (rol !== undefined) {
    const errorGrupo = errorGrupoProfesor({ rol, sede, turno, grado });
    if (errorGrupo) return res.status(400).json({ error: errorGrupo });
  }

  const cambios = {};
  if (typeof activo === "boolean") cambios.activo = activo;
  if (nombre !== undefined && String(nombre).trim()) cambios.nombre = String(nombre).trim();
  if (usuario !== undefined) cambios.usuario = String(usuario).trim();
  if (rol !== undefined) cambios.rol = rol;
  if (clave !== undefined) {
    cambios.clave_hash = hashClave(clave);
  }
  // El grupo del profesor: solo se guarda cuando llega (para un profesor
  // son obligatorios; para otros roles se limpia). Si no se pasa el rol,
  // se usa el de la cuenta actual.
  const { data: cuentaActual } = await getSupabase()
    .from("usuarios")
    .select("id, nombre, usuario, rol, activo, sede, turno, grado")
    .eq("id", req.params.id)
    .maybeSingle();
  const esProfesor = (rol ?? cuentaActual?.rol) === "profesor";
  if (sede !== undefined) cambios.sede = esProfesor ? String(sede).trim() : null;
  if (turno !== undefined) cambios.turno = esProfesor ? turno : null;
  if (grado !== undefined) cambios.grado = esProfesor ? String(grado).trim() : null;

  if (Object.keys(cambios).length === 0) {
    return res.status(400).json({ error: "No hay nada que actualizar" });
  }

  // Si cambia el usuario, no se puede repetir con otra cuenta
  if (cambios.usuario) {
    const { data: existente, error: errExiste } = await getSupabase()
      .from("usuarios")
      .select("id")
      .neq("id", req.params.id)
      .eq("usuario", cambios.usuario)
      .maybeSingle();
    if (errExiste) return res.status(500).json({ error: errExiste.message });
    if (existente) {
      return res.status(400).json({ error: "Ese usuario ya tiene cuenta" });
    }
  }

  const { data, error } = await getSupabase()
    .from("usuarios")
    .update(cambios)
    .eq("id", req.params.id)
    .select("id, nombre, usuario, rol, activo, sede, turno, grado, created_at")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  const quien = cuentaActual?.nombre || cuentaActual?.usuario || "cuenta";
  auditar(
    req,
    "usuarios:editar",
    `"${quien}"${cuentaActual?.usuario ? ` (${cuentaActual.usuario})` : ""} | ${detalleCambios(cambios, cuentaActual)}`
  );
  res.json(data);
});

// DELETE /api/usuarios/:id
// Borra una cuenta. Solo admin.
router.delete("/:id", requiereRol("admin"), async (req, res) => {
  const { data: cuenta } = await getSupabase()
    .from("usuarios")
    .select("usuario, rol")
    .eq("id", req.params.id)
    .maybeSingle();

  const { error } = await getSupabase()
    .from("usuarios")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  const identita = cuenta?.usuario || "cuenta sin usuario";
  auditar(req, "usuarios:borrar", `"${identita}"${cuenta?.rol ? ` (${cuenta.rol})` : ""}`);
  res.status(204).end();
});

export default router;
