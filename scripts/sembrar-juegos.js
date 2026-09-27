import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(import.meta.dirname, "../.env") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sembrar() {
  console.log("Sembrando juegos educativos demo...");

  const juegosDemo = [
    {
      titulo: "Atrapa la Comida Saludable",
      descripcion: "¡Ayuda a recolectar frutas y verduras frescas para el menú escolar evitando los ultraprocesados!",
      instrucciones: "Usa el ratón, las teclas de flechas o toca la pantalla para moverte. ¡Atrapa la mayor cantidad de frutas antes de que termine el tiempo!",
      categoria: "Nutrición y Salud",
      tipo: "scratch",
      url_recurso: "https://scratch.mit.edu/projects/10128407/embed",
      portada_url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=60",
      autor_documento: "1111548041",
      autor_nombre: "Luisa Fernanda Angulo",
      autor_grado: "11-1",
      estado: "aprobado",
      vistas: 42,
    },
    {
      titulo: "Misión Cero Desperdicio: Clasifica y Salva",
      descripcion: "Aprende a separar y aprovechar los alimentos para no generar desperdicios en el comedor escolar.",
      instrucciones: "Haz clic y clasifica cada alimento en su destino óptimo: consumo, banco de alimentos o compostaje.",
      categoria: "Cero Desperdicio",
      tipo: "scratch",
      url_recurso: "https://scratch.mit.edu/projects/21448881/embed",
      portada_url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&auto=format&fit=crop&q=60",
      autor_documento: "admin",
      autor_nombre: "Equipo Pedagógico PAE",
      autor_grado: "Docente",
      estado: "aprobado",
      vistas: 89,
    },
    {
      titulo: "Super Frutas de Colombia",
      descripcion: "Trivia interactiva para descubrir las vitaminas y beneficios de las frutas típicas de nuestra región.",
      instrucciones: "Responde correctamente a las preguntas de selección múltiple antes de que termine el contador.",
      categoria: "Trivia y Preguntas",
      tipo: "scratch",
      url_recurso: "https://scratch.mit.edu/projects/13511874/embed",
      portada_url: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=600&auto=format&fit=crop&q=60",
      autor_documento: "1111548041",
      autor_nombre: "Luisa Fernanda Angulo",
      autor_grado: "11-1",
      estado: "pendiente",
      vistas: 0,
    },
  ];

  for (const j of juegosDemo) {
    const { data: existente } = await supabase
      .from("juegos")
      .select("id")
      .eq("titulo", j.titulo)
      .maybeSingle();

    if (!existente) {
      const { error } = await supabase.from("juegos").insert(j);
      if (error) {
        console.error(`Error al insertar ${j.titulo}:`, error.message);
      } else {
        console.log(`✅ Creado: ${j.titulo} (${j.estado})`);
      }
    } else {
      console.log(`ℹ️ Ya existía: ${j.titulo}`);
    }
  }

  console.log("¡Siembra de juegos completada con éxito!");
}

sembrar().catch(console.error);
