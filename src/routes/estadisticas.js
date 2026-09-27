// Estadisticas del mes: resumen (reservas/servidas/desperdicio),
// servidas por dia de semana, por sede y turno, y ranking de platos
// segun las valoraciones en estrellas.
import { Router } from "express";
import { getSupabase } from "../config/supabase.js";

const router = Router();

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Devuelve el nombre del dia de la semana en español para una
// fecha "YYYY-MM-DD" (la fecha es solo texto, sin zona horaria)
function diaEnEspanol(fechaTexto) {
  const [año, mes, dia] = fechaTexto.split("-").map(Number);
  const fecha = new Date(año, mes - 1, dia);
  return DIAS_ES[fecha.getDay()];
}

// GET /api/estadisticas?mes=2026-08
// Si no se manda mes, usa el mes actual
router.get("/", async (req, res) => {
  const hoy = new Date();
  const hoyLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const mes = req.query.mes || hoyLocal;

  // El mes debe tener formato YYYY-MM y ser un mes real (1-12).
  // Si no, rechazamos la peticion en vez de romper con un 500.
  const coincidencia = String(mes).match(/^(\d{4})-(\d{2})$/);
  if (!coincidencia) {
    return res.status(400).json({ error: "El mes debe tener formato año-mes (ej: 2026-08)" });
  }
  const añoNum = Number(coincidencia[1]);
  const mesNum = Number(coincidencia[2]);
  if (mesNum < 1 || mesNum > 12) {
    return res.status(400).json({ error: "El mes debe estar entre 01 y 12" });
  }

  // Rango del mes: inicio y principio del siguiente mes
  const inicio = `${mes}-01`;
  const siguiente = new Date(añoNum, mesNum, 1);
  const fin = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, "0")}-01`;

  try {
    const supabase = getSupabase();

    // 1. Reservas del mes
    const { data: reservas, error: errRes } = await supabase
      .from("reservas")
      .select("fecha, asistio, sede, turno")
      .gte("fecha", inicio)
      .lt("fecha", fin);

    if (errRes) return res.status(500).json({ error: errRes.message });

    // Resumen general del mes
    let total = 0;
    let servidas = 0;
    const porDiaSemana = {};
    const porSede = {};
    const porTurno = {};

    for (const r of reservas) {
      total += 1;
      if (r.asistio) servidas += 1;

      const dia = diaEnEspanol(r.fecha);
      if (!porDiaSemana[dia]) porDiaSemana[dia] = { reservas: 0, servidas: 0 };
      porDiaSemana[dia].reservas += 1;
      if (r.asistio) porDiaSemana[dia].servidas += 1;

      const sede = r.sede || "Sin sede";
      if (!porSede[sede]) porSede[sede] = { reservas: 0, servidas: 0 };
      porSede[sede].reservas += 1;
      if (r.asistio) porSede[sede].servidas += 1;

      const turno = r.turno || "Sin turno";
      if (!porTurno[turno]) porTurno[turno] = { reservas: 0, servidas: 0 };
      porTurno[turno].reservas += 1;
      if (r.asistio) porTurno[turno].servidas += 1;
    }

    const desperdicio = total - servidas;
    const porcentaje = total > 0 ? Math.round((desperdicio / total) * 100) : 0;

    // 2. Valoraciones de platos para el ranking: primero cargamos
    //    los menus, y luego solo las valoraciones que referencian
    //    esos menus (antes cargaba todas las valoraciones y todos
    //    los menus de la historia).
    const { data: menus, error: errMen } = await supabase
      .from("menus")
      .select("id, semana, dia, jornada, platillo, imagen");

    let valoraciones = [];
    let errVal = null;
    if (!errMen && menus && menus.length > 0) {
      const menuIds = menus.map((m) => m.id);
      const resVal = await supabase
        .from("valoraciones")
        .select("menu_id, puntos")
        .in("menu_id", menuIds);
      valoraciones = resVal.data || [];
      errVal = resVal.error;
    }

    if (errVal || errMen) {
      return res.status(500).json({ error: (errVal || errMen).message });
    }

    // Promedio y votos por plato
    const acumulado = {};
    for (const v of valoraciones) {
      if (!acumulado[v.menu_id]) acumulado[v.menu_id] = { suma: 0, votos: 0 };
      acumulado[v.menu_id].suma += v.puntos;
      acumulado[v.menu_id].votos += 1;
    }

    const ranking = menus
      .map((m) => {
        const datos = acumulado[m.id];
        const votos = datos ? datos.votos : 0;
        const promedio = votos > 0 ? Math.round((datos.suma / votos) * 10) / 10 : null;
        return {
          id: m.id,
          semana: m.semana,
          dia: m.dia,
          platillo: m.platillo,
          imagen: m.imagen || null,
          jornada: m.jornada || null,
          valoracion: promedio,
          votos,
        };
      })
      .sort((a, b) => (b.valoracion ?? -1) - (a.valoracion ?? -1));

    const favorito = ranking.find((r) => r.valoracion !== null) || null;
    const conVotos = ranking.filter((r) => r.valoracion !== null);
    const menosGustado = conVotos.length > 0 ? conVotos[conVotos.length - 1] : null;

    res.json({
      mes,
      totalReservas: total,
      minutasServidas: servidas,
      minutasDesperdiciadas: desperdicio,
      porcentajeDesperdicio: porcentaje,
      porDiaSemana,
      porSede,
      porTurno,
      ranking,
      platoFavorito: favorito,
      platoMenosGustado: menosGustado,
    });
  } catch (err) {
    console.error("Estadisticas error:", err);
    res.status(500).json({ error: "Error interno de estadísticas" });
  }
});

export default router;
