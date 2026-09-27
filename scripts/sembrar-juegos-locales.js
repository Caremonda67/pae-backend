import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(import.meta.dirname, "../.env") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sembrarJuegosLocales() {
  console.log("Sembrando los 3 juegos de prueba de 'Juegos prueba'...");

  const juegosLocales = [
    {
      titulo: "Super PAE Recicla 3D",
      descripcion: "¡Aventura en 3D con Three.js! Corre por el entorno escolar recolectando residuos reciclables y depositándolos en su lugar.",
      instrucciones: "Usa las teclas A / D o las flechas de dirección para moverte. Presiona la barra espaciadora para saltar y recolectar los objetos correctos.",
      categoria: "Arcade y Acción",
      tipo: "html_archivo",
      url_recurso: "/juegos-archivos/super-pae-3d.html",
      portada_url: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=60",
      autor_documento: "1111548041",
      autor_nombre: "Luisa Fernanda Angulo",
      autor_grado: "11-1",
      estado: "aprobado",
      vistas: 145,
    },
    {
      titulo: "Super PAE Recicla 2D",
      descripcion: "Juego clásico de plataformas y reflejos en Canvas 2D. Rescata los alimentos y clasifica los residuos antes de que termine el tiempo.",
      instrucciones: "Usa las flechas del teclado o los controles para mover al personaje y saltar entre las plataformas.",
      categoria: "Cero Desperdicio",
      tipo: "html_archivo",
      url_recurso: "/juegos-archivos/super-pae-2d.html",
      portada_url: "https://images.unsplash.com/photo-1579373903781-fd5c0c30c4cd?w=600&auto=format&fit=crop&q=60",
      autor_documento: "1111548041",
      autor_nombre: "Estudiantes Grado 11",
      autor_grado: "11-1",
      estado: "aprobado",
      vistas: 112,
    },
    {
      titulo: "ReciclaTech: Misión Residuos",
      descripcion: "¡Haz clic y atrapa los residuos correctos antes de que se agote el tiempo! Un reto interactivo de velocidad mental y reflejos.",
      instrucciones: "Toca o haz clic sobre los elementos reciclables para sumar puntos y evitar que el temporizador llegue a cero.",
      categoria: "Arcade y Acción",
      tipo: "html_archivo",
      url_recurso: "/juegos-archivos/reciclatech.html",
      portada_url: "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=600&auto=format&fit=crop&q=60",
      autor_documento: "1111548041",
      autor_nombre: "Grupo de Tecnología e Informática",
      autor_grado: "10-2",
      estado: "aprobado",
      vistas: 78,
    },
  ];

  for (const j of juegosLocales) {
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
        console.log(`✅ Creado e integrado: ${j.titulo}`);
      }
    } else {
      const { error } = await supabase.from("juegos").update(j).eq("id", existente.id);
      if (error) {
        console.error(`Error al actualizar ${j.titulo}:`, error.message);
      } else {
        console.log(`🔄 Actualizado con recurso local: ${j.titulo}`);
      }
    }
  }

  console.log("¡Los 3 juegos locales han sido cargados con éxito!");
}

sembrarJuegosLocales().catch(console.error);
