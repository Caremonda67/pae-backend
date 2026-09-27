// Subida de archivos a Supabase Storage (imagenes y videojuegos del
// Arcade). El frontend los manda en base64; la validacion y el guardado
// viven en config/almacenamiento.js.
import { Router } from "express";
import { requiereRol } from "../config/auth.js";
import { getSupabase } from "../config/supabase.js";
import { subirImagen, subirArchivoJuego, ErrorValidacion } from "../config/almacenamiento.js";

const router = Router();

// POST /api/archivos/subir
// Cuerpo esperado: { base64: "data:image/png;base64,....", nombre: "foto.png" }
// Devuelve: { url: "https://....supabase.co/storage/v1/object/public/imagenes/...." }
router.post("/subir", requiereRol("admin", "cocina", "coordinador", "profesor", "estudiante"), async (req, res) => {
  const { base64, nombre } = req.body || {};

  if (!base64 || !nombre) {
    return res.status(400).json({ error: "Faltan la imagen o el nombre" });
  }

  try {
    const url = await subirImagen(base64, nombre, "pae");
    res.status(201).json({ url });
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Subida de imagen:", err);
    res.status(500).json({ error: "Error interno al subir la imagen" });
  }
});

// GET /api/archivos/servir-juego?url=...
// Supabase sirve los .html publicos como text/plain (anti-XSS), lo que
// haria que el iframe del Reproductor los mostrara como texto. Esta ruta
// lee el archivo del bucket "juegos" con la service role key y lo sirve
// con Content-Type text/html. Solo acepta URLs de NUESTRO bucket "juegos".
const SUPA_PROYECTO = "aeortsskfobulpzcjdpu.supabase.co";
const PREFIJO_JUEGOS = "/storage/v1/object/public/juegos/";

router.get("/servir-juego", async (req, res) => {
  const { url } = req.query || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Falta el parámetro url" });
  }

  // Validación estricta: solo archivos del bucket "juegos" de nuestro proyecto
  let destino;
  try {
    destino = new URL(url);
  } catch {
    return res.status(400).json({ error: "URL inválida" });
  }
  if (destino.hostname !== SUPA_PROYECTO) {
    return res.status(400).json({ error: "Origen no permitido" });
  }
  if (!destino.pathname.startsWith(PREFIJO_JUEGOS)) {
    return res.status(400).json({ error: "Solo se permiten archivos del bucket de juegos" });
  }
  const ruta = destino.pathname.slice(PREFIJO_JUEGOS.length);
  if (!ruta || !/^[A-Za-z0-9/_.-]+$/.test(ruta)) {
    return res.status(400).json({ error: "Ruta inválida" });
  }

  try {
    const { data, error } = await getSupabase()
      .storage.from("juegos")
      .download(ruta);
    if (error || !data) {
      console.error("No se pudo descargar el juego:", error?.message);
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    // El iframe del Reproductor vive en el frontend (otro origen); helmet
    // pondría X-Frame-Options: SAMEORIGIN y bloquearía la carga del juego.
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (err) {
    console.error("Error sirviendo el juego:", err);
    res.status(500).json({ error: "Error al servir el juego" });
  }
});

// POST /api/archivos/subir-juego
// Sube el archivo HTML de un videojuego del Arcade.
// Cuerpo esperado: { base64: "data:text/html;base64,....", nombre: "juego.html" }
// Devuelve: { url: "https://....supabase.co/storage/v1/object/public/juegos/...." }
router.post("/subir-juego", requiereRol("estudiante", "admin", "coordinador"), async (req, res) => {
  const { base64, nombre } = req.body || {};

  if (!base64 || !nombre) {
    return res.status(400).json({ error: "Faltan el archivo o el nombre" });
  }

  try {
    const url = await subirArchivoJuego(base64, nombre);
    res.status(201).json({ url });
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Subida de juego:", err);
    res.status(500).json({ error: "Error interno al subir el juego" });
  }
});

export default router;