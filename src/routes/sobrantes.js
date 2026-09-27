// rutas de los sobrantes
// el personal de cocina registra cuantas porciones (y su peso en
// kilogramos) sobraron de cada jornada y sede al final del dia. Esos
// datos alimentan el reporte de sobrantes. Lo guarda cocina/admin y
// lo puede consultar tambien el coordinador.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol } from "../config/auth.js";
import { auditar } from "../config/auditoria.js";

const router = Router();
const TURNOS = ["Almuerzo", "Refrigerio"];

// Valida que una fecha sea real y no sea futura: no tiene sentido
// reportar sobrantes de un dia que aun no llega.
function validarFechaSobrantes(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return "La fecha debe tener el formato año-mes-día (ej: 2026-08-10).";
  }

  const [año, mes, dia] = fecha.split("-").map(Number);
  const fechaObj = new Date(año, mes - 1, dia);
  if (
    fechaObj.getFullYear() !== año ||
    fechaObj.getMonth() !== mes - 1 ||
    fechaObj.getDate() !== dia
  ) {
    return "Esa fecha no existe.";
  }

  const hoyTexto = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (fecha > hoyTexto) {
    return "No se puede reportar sobrantes de una fecha futura.";
  }

  return null;
}

// GET /api/sobrantes
// Lista los sobrantes registrados (admin, cocina, coordinador).
// Filtros opcionales:
// - ?fecha=YYYY-MM-DD (un día puntual, lo usa el panel de cocina)
// - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (rango para el reporte)
// Sin filtros devuelve todo, de la fecha más reciente a la más antigua.
router.get("/", requiereRol("admin", "cocina", "coordinador"), async (req, res) => {
  const { fecha, desde, hasta } = req.query;

  let consulta = getSupabase()
    .from("sobrantes")
    .select("*")
    .order("fecha", { ascending: false })
    .order("sede", { ascending: true })
    .order("turno", { ascending: true });

  if (fecha) consulta = consulta.eq("fecha", fecha);
  if (desde) consulta = consulta.gte("fecha", desde);
  if (hasta) consulta = consulta.lte("fecha", hasta);

  const { data, error } = await consulta;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/sobrantes
// Crea o actualiza el sobrante de una fecha + sede + jornada.
// Cuerpo: { fecha, sede, turno, porciones, peso_kg }
// Solo cocina y admin lo guardan.
router.post("/", requiereRol("admin", "cocina"), async (req, res) => {
  const { fecha, sede, turno } = req.body || {};
  let { porciones, peso_kg } = req.body || {};

  const errorFecha = validarFechaSobrantes(fecha);
  if (errorFecha) return res.status(400).json({ error: errorFecha });

  if (!TURNOS.includes(turno)) {
    return res.status(400).json({ error: "Turno no válido" });
  }

  if (!sede || !sede.trim()) {
    return res.status(400).json({ error: "Falta la sede" });
  }

  // La sede debe existir en la tabla de sedes (evita nombres inventados)
  const { data: sedes, error: errSedes } = await getSupabase()
    .from("sedes")
    .select("nombre");
  if (errSedes) return res.status(500).json({ error: errSedes.message });
  if (!sedes.map((s) => s.nombre).includes(sede)) {
    return res.status(400).json({ error: "Sede no válida" });
  }

  // Porciones: entero 0 o mas (vacio se guarda como null)
  if (porciones !== undefined && porciones !== null && porciones !== "") {
    porciones = Number(porciones);
    if (!Number.isInteger(porciones) || porciones < 0) {
      return res
        .status(400)
        .json({ error: "Las porciones deben ser un número entero (0 o más)" });
    }
  } else {
    porciones = null;
  }

  // Peso: numero 0 o mas en kilogramos (vacio se guarda como null)
  if (peso_kg !== undefined && peso_kg !== null && peso_kg !== "") {
    peso_kg = Number(peso_kg);
    if (Number.isNaN(peso_kg) || peso_kg < 0) {
      return res
        .status(400)
        .json({ error: "El peso debe ser un número (0 o más)" });
    }
  } else {
    peso_kg = null;
  }

  const fila = {
    fecha,
    sede,
    turno,
    porciones,
    peso_kg,
    creado_por: req.usuario?.nombre || req.usuario?.sub || null,
  };

  const { data, error } = await getSupabase()
    .from("sobrantes")
    .upsert(fila, { onConflict: "fecha,sede,turno" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "sobrantes:guardar", `${fecha} | ${sede} | ${turno} | porciones ${porciones ?? "-"} | ${peso_kg ?? "-"} kg`);
  res.json(data);
});

// DELETE /api/sobrantes?fecha=YYYY-MM-DD&sede=Nombre
// Borra todos los registros de sobrantes de una sede en una fecha
// (las dos jornadas). Lo usa el panel de reportes. Solo cocina y admin.
router.delete("/", requiereRol("admin", "cocina"), async (req, res) => {
  const { fecha, sede } = req.query;
  if (!fecha || !sede) {
    return res.status(400).json({ error: "Faltan la fecha y la sede" });
  }

  const { data, error } = await getSupabase()
    .from("sobrantes")
    .delete()
    .eq("fecha", fecha)
    .eq("sede", sede)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  auditar(req, "sobrantes:borrar", `${fecha} | ${sede} | ${data?.length || 0} registro(s)`);
  res.json({ eliminados: data?.length || 0 });
});

export default router;
