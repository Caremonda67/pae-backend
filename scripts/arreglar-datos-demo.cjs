// Arregla datos demo para que las vistas publicas (Home, Reportes,
// Estadisticas, Noticias, Galeria) se vean creibles en la sustentacion:
//  1. Corrige tildes en los titulos/textos de los avisos publicados.
//  2. Marca como borrador el aviso de broma ("Arce es hetero").
//  3. Sembra asistencia (reservas.asistio = true) en ~80% de las
//     reservas de fechas anteriores a hoy (el reporte y las estadisticas
//     contarian antes un "100% sin asistir" que se veia roto).
//  4. Agrega fotos a la galeria usando las mismas imagenes publicas de
//     los platos del menu, para que la pagina Galeria no se vea vacia.
//
// Es idempotente: si se corre varias veces no duplica galeria ni vuelve
// a tocar algo ya arreglado.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function corregirAvisos() {
  const avisos = [
    {
      id: 1,
      titulo: "Suspensión del servicio",
      texto: "Viernes no habrá servicio por jornada pedagógica. Las minutas se reprogramarán.",
    },
    {
      id: 2,
      titulo: "Reserva de minutas en línea",
      texto: "Ya puedes reservar tu comida desde la aplicación para evitar el desperdicio.",
    },
    {
      id: 3,
      titulo: "Actualización de datos",
      texto: "Mantén actualizada la información de los estudiantes para el programa.",
    },
  ];
  for (const a of avisos) {
    const { error } = await supabase.from("avisos").update({ titulo: a.titulo, texto: a.texto }).eq("id", a.id);
    if (error) console.log("AVISO " + a.id + " error:", error.message);
  }

  // El aviso "Arce es hetero" es una broma personal: lo ocultamos del
  // publico (borrador) para que no se vea en Home/Noticias.
  const { data: broma, error: errBroma } = await supabase
    .from("avisos")
    .select("id")
    .eq("titulo", "Arce")
    .eq("texto", "Arce es hetero")
    .maybeSingle();
  if (errBroma) console.log("AVISO broma error:", errBroma.message);
  if (broma) {
    const { error } = await supabase.from("avisos").update({ estado: "borrador" }).eq("id", broma.id);
    if (error) console.log("AVISO broma update error:", error.message);
    else console.log("Aviso de broma pasado a borrador (id " + broma.id + ")");
  }
  console.log("Avisos corregidos.");
}

async function sembrarAsistenciaReservas() {
  const hoy = hoyLocal();
  const { data, error } = await supabase
    .from("reservas")
    .select("id, fecha, asistio")
    .lt("fecha", hoy);
  if (error) return console.log("Reservas error:", error.message);

  // Marcamos ~80% (id % 5 !== 0) de las reservas pasadas como asistidas.
  // Las de hoy no se tocan: las marca el personal en el panel.
  const porMarcar = (data || []).filter((r) => !r.asistio && r.id % 5 !== 0).map((r) => r.id);
  if (porMarcar.length === 0) {
    console.log("Reservas pasadas ya sembradas.");
    return;
  }
  for (let i = 0; i < porMarcar.length; i += 80) {
    const lote = porMarcar.slice(i, i + 80);
    const { error: errUpd } = await supabase.from("reservas").update({ asistio: true }).in("id", lote);
    if (errUpd) console.log("Update reservas error:", errUpd.message);
  }
  console.log(`${porMarcar.length} reservas pasadas marcadas como asistidas.`);
}

async function sembrarGaleria() {
  const imagenes = [
    { titulo: "Almuerzo del PAE", imagen: "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=400" },
    { titulo: "Sopa de verduras con pan", imagen: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400" },
    { titulo: "Sancocho de gallina", imagen: "https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=400" },
    { titulo: "Avena con frutas", imagen: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400" },
  ];

  const { data: existentes, error: errEx } = await supabase.from("galeria").select("imagen");
  if (errEx) return console.log("Galeria existente error:", errEx.message);
  const ya = new Set((existentes || []).map((g) => g.imagen));

  const faltantes = imagenes.filter((f) => !ya.has(f.imagen));
  if (faltantes.length === 0) {
    console.log("Galeria ya sembrada.");
    return;
  }
  const { error } = await supabase.from("galeria").insert(faltantes);
  if (error) return console.log("Galeria insert error:", error.message);
  console.log(`${faltantes.length} fotos agregadas a la galeria.`);
}

(async () => {
  await corregirAvisos();
  await sembrarAsistenciaReservas();
  await sembrarGaleria();
  console.log("Listo.");
})();