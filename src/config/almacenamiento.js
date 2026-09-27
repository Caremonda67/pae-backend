// Subida de imagenes a Supabase Storage. El frontend la manda en
// base64; aqui se valida el tamano y la extension, se guarda en el
// bucket "imagenes" y se devuelve la URL publica. Rutas como
// archivos.js y contacto.js la reutilizan para no duplicar la logica.
import { getSupabase } from "./supabase.js";

// Error de validacion del pedido: la ruta responde 400, no 500.
export class ErrorValidacion extends Error {}

// Sube una imagen (base64) con validacion de tamano (5 MB) y de
// extension (lista blanca de imagenes comunes). "prefijo" organiza la
// ruta dentro del bucket (pae/, contacto/, etc.). Devuelve la URL.
// Lanza ErrorValidacion si el pedido no es una imagen valida y un
// Error generico si falla la subida a Supabase.
export async function subirImagen(base64, nombre, prefijo = "pae") {
  // El base64 viene como "data:image/png;base64,XXXX" o solo "XXXX"
  const coincide = String(base64).match(/^data:(image\/\w+);base64,(.+)$/s);
  const mime = coincide ? coincide[1] : "image/png";
  const datos = coincide ? coincide[2] : String(base64);

  // Tamano maximo razonable (5 MB) para evitar abusos
  const bytes = Buffer.from(datos, "base64");
  if (bytes.length > 5 * 1024 * 1024) {
    throw new ErrorValidacion("La imagen supera los 5 MB");
  }

  // Nombre unico: fecha + numero aleatorio + extension.
  // La extension se valida contra una lista blanca (imagenes comunes):
  // rechaza nombres raros, rutas y caracteres problematicos del upload.
  const extension = (String(nombre).match(/\.([a-z0-9]{1,5})$/i)?.[1] || "png").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
    throw new ErrorValidacion("Formato de imagen no permitido");
  }
  const ruta = `${prefijo}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await getSupabase()
    .storage.from("imagenes")
    .upload(ruta, bytes, { contentType: mime });

  if (error) {
    console.error(`Error al subir imagen (${prefijo}):`, error.message);
    throw new Error("No se pudo subir la imagen");
  }

  const { data: urlPublica } = getSupabase()
    .storage.from("imagenes")
    .getPublicUrl(ruta);

  return urlPublica.publicUrl;
}

// Sube el archivo HTML de un videojuego del Arcade al bucket publico
// "juegos". Valida extension .html y tamano (2 MB). El juego se reproduce
// en el iframe del Reproductor desde esta URL publica.
export async function subirArchivoJuego(base64, nombre) {
  const coincide = String(base64).match(/^data:(text\/html);base64,(.+)$/s);
  const datos = coincide ? coincide[2] : String(base64);
  const mime = coincide ? coincide[1] : "text/html";
  const bytes = Buffer.from(datos, "base64");

  if (bytes.length <= 0) {
    throw new ErrorValidacion("El archivo está vacío");
  }
  if (bytes.length > 2 * 1024 * 1024) {
    throw new ErrorValidacion("El archivo HTML supera los 2 MB");
  }

  const nombreLimpio = String(nombre).trim().toLowerCase();
  if (!/\.html?$/.test(nombreLimpio)) {
    throw new ErrorValidacion("El archivo del juego debe ser .html");
  }

  const ruta = `juegos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`;

  const { error } = await getSupabase()
    .storage.from("juegos")
    .upload(ruta, bytes, { contentType: mime, upsert: false });

  if (error) {
    console.error("Error al subir juego HTML:", error.message);
    throw new Error("No se pudo subir el juego");
  }

  const { data: urlPublica } = getSupabase()
    .storage.from("juegos")
    .getPublicUrl(ruta);

  return urlPublica.publicUrl;
}