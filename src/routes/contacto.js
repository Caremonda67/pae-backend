// Guarda los mensajes que llegan por el formulario de contacto.
// El admin (o coordinador) los lee, los marca como leidos y puede
// responderle a un estudiante registrado: ese estudiante ve su
// mensaje y la respuesta cuando entra con su sesion.

import { Router } from "express";
import { getSupabase } from "../config/supabase.js";
import { requiereRol, requiereSesion } from "../config/auth.js";
import { enviarEmail, correoConfigurado } from "../config/email.js";
import { limiteFormularios } from "../config/rateLimit.js";
import { subirImagen } from "../config/almacenamiento.js";

const router = Router();

// GET /api/contacto
// lista los mensajes recibidos (solo para el panel de administrador)
router.get("/", requiereRol("admin", "coordinador"), async (_req, res) => {
  const { data, error } = await getSupabase()
    .from("contactos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/contacto/mios
// Mensajes de un estudiante registrado: los suyos + la respuesta que
// le haya dado el admin. Solo necesita una sesion valida; devuelve
// los mensajes cuyo documento coincide con el usuario de la sesion.
router.get("/mios", requiereSesion, async (req, res) => {
  const { data, error } = await getSupabase()
    .from("contactos")
    .select("*")
    .eq("documento", req.usuario.sub)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/contacto
// Recibe el formulario de contacto
// Cuerpo esperado: { nombre, correo, mensaje, documento?, imagenBase64?, imagenNombre? }
router.post("/", limiteFormularios, async (req, res) => {
  const { nombre, correo, mensaje, documento, imagenBase64, imagenNombre } = req.body || {};

  if (!nombre || !correo || !mensaje) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  // El correo debe tener un formato minimo valido
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo).trim())) {
    return res.status(400).json({ error: "Correo no válido" });
  }

  const fila = {
    nombre: String(nombre).trim(),
    correo: String(correo).trim(),
    mensaje: String(mensaje).trim(),
    // Si el remitente es un estudiante registrado, su documento
    // vincula el mensaje para que luego vea la respuesta del admin.
    documento: documento ? String(documento).trim() : null,
  };

  // Si el estudiante adjunta una foto, la subimos primero
  if (imagenBase64) {
    try {
      fila.imagen = await subirImagen(imagenBase64, imagenNombre || "foto.png", "contacto");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const { data, error } = await getSupabase()
    .from("contactos")
    .insert([fila])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Avisamos al administrador por email si esta configurado
  if (correoConfigurado() && process.env.ADMIN_EMAIL) {
    await enviarEmail(
      process.env.ADMIN_EMAIL,
      `PAE · Mensaje de ${nombre}`,
      `Nuevo mensaje del formulario de contacto:\n\nDe: ${nombre} <${correo}>\n\n${mensaje}`,
      `<h2>Nuevo mensaje de contacto</h2><p><strong>De:</strong> ${nombre} (${correo})</p><p>${mensaje}</p>`
    );
  }

  res.status(201).json(data);
});

// PUT /api/contacto/:id
// Marca un mensaje como leido (o no leido). Solo admin/coordinador.
// Cuerpo: { leido: true }
router.put("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { leido } = req.body || {};
  if (typeof leido !== "boolean") {
    return res.status(400).json({ error: "Falta el campo leido (true/false)" });
  }

  const { data, error } = await getSupabase()
    .from("contactos")
    .update({ leido })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/contacto/:id/respuesta
// El admin/coordinador responde un mensaje. Si el mensaje era de un
// estudiante registrado (tiene documento), el estudiante verá esta
// respuesta al entrar con su sesion. Responder tambien marca el
// mensaje como leido.
// Cuerpo: { respuesta: "texto" }
router.put("/:id/respuesta", requiereRol("admin", "coordinador"), async (req, res) => {
  const { respuesta } = req.body || {};
  if (!respuesta || !String(respuesta).trim()) {
    return res.status(400).json({ error: "Escribe una respuesta" });
  }

  const { data, error } = await getSupabase()
    .from("contactos")
    .update({
      respuesta: String(respuesta).trim(),
      respuesta_at: new Date().toISOString(),
      leido: true,
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Chat estudiante-admin: el primer mensaje vive en "contactos.mensaje"
// y la conversacion completa en "chat_mensajes".

// Arma el hilo: mensaje original + respuestas del admin (incluye la
// respuesta vieja del campo "respuesta" para no perder historial).
function armarHilo(contacto, filas) {
  const hilo = [
    {
      id: `original-${contacto.id}`,
      remitente: "estudiante",
      texto: contacto.mensaje,
      imagen: contacto.imagen || null,
      created_at: contacto.created_at,
    },
  ];

  if (filas.length === 0 && contacto.respuesta) {
    hilo.push({
      id: `legacy-${contacto.id}`,
      remitente: "admin",
      texto: contacto.respuesta,
      imagen: null,
      created_at: contacto.respuesta_at,
    });
  }

  for (const fila of filas) {
    hilo.push({
      id: fila.id,
      remitente: fila.remitente,
      texto: fila.texto,
      imagen: fila.imagen || null,
      created_at: fila.created_at,
    });
  }

  return hilo;
}

// Valida y limpia el texto de un mensaje de chat
function textoValido(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio || limpio.length > 2000) return "";
  return limpio;
}

// GET /api/contacto/:id/mensajes
// Hilo completo de la conversacion (para el panel del admin)
router.get("/:id/mensajes", requiereRol("admin", "coordinador"), async (req, res) => {
  const { data: contacto, error: errContacto } = await getSupabase()
    .from("contactos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (errContacto) return res.status(500).json({ error: errContacto.message });
  if (!contacto) return res.status(404).json({ error: "Mensaje no encontrado" });

  const { data: filas, error } = await getSupabase()
    .from("chat_mensajes")
    .select("*")
    .eq("contacto_id", contacto.id)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(armarHilo(contacto, filas || []));
});

// POST /api/contacto/:id/mensajes
// El admin/coordinador manda otro mensaje al hilo (se puede varias
// veces, no hay limite). Cuerpo: { texto?, imagenBase64?, imagenNombre? }
router.post("/:id/mensajes", requiereRol("admin", "coordinador"), async (req, res) => {
  const { texto: textoEnviado, imagenBase64, imagenNombre } = req.body || {};
  const texto = textoValido(textoEnviado);
  if (!texto && !imagenBase64) {
    return res.status(400).json({ error: "Escribe un mensaje o adjunta una imagen" });
  }

  let imagen = null;
  if (imagenBase64) {
    try {
      imagen = await subirImagen(imagenBase64, imagenNombre || "foto.png");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const fila = { contacto_id: req.params.id, remitente: "admin", texto, imagen };
  const { data, error } = await getSupabase()
    .from("chat_mensajes")
    .insert([fila])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/contacto/:id/mensajes/estudiante
// El estudiante dueño del mensaje ve su conversacion completa
router.get("/:id/mensajes/estudiante", requiereSesion, async (req, res) => {
  const { data: contacto, error: errContacto } = await getSupabase()
    .from("contactos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (errContacto) return res.status(500).json({ error: errContacto.message });
  if (!contacto) return res.status(404).json({ error: "Mensaje no encontrado" });

  if (!contacto.documento || contacto.documento !== req.usuario.sub) {
    return res.status(403).json({ error: "No es tu mensaje" });
  }

  const { data: filas, error } = await getSupabase()
    .from("chat_mensajes")
    .select("*")
    .eq("contacto_id", contacto.id)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(armarHilo(contacto, filas || []));
});

// POST /api/contacto/:id/mensajes/estudiante
// El estudiante responde al admin dentro de la conversacion.
// Cuerpo: { texto, imagenBase64?, imagenNombre? }
router.post("/:id/mensajes/estudiante", requiereSesion, async (req, res) => {
  const { texto: textoEnviado, imagenBase64, imagenNombre } = req.body || {};
  const texto = textoValido(textoEnviado);
  if (!texto && !imagenBase64) {
    return res.status(400).json({ error: "Escribe un mensaje o adjunta una imagen" });
  }

  const { data: contacto, error: errContacto } = await getSupabase()
    .from("contactos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (errContacto) return res.status(500).json({ error: errContacto.message });
  if (!contacto) return res.status(404).json({ error: "Mensaje no encontrado" });

  if (!contacto.documento || contacto.documento !== req.usuario.sub) {
    return res.status(403).json({ error: "No es tu mensaje" });
  }

  let imagen = null;
  if (imagenBase64) {
    try {
      imagen = await subirImagen(imagenBase64, imagenNombre || "foto.png");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const fila = { contacto_id: contacto.id, remitente: "estudiante", texto, imagen };
  const { data, error } = await getSupabase()
    .from("chat_mensajes")
    .insert([fila])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Al responder, el mensaje vuelve a estar sin leer para el admin
  await getSupabase()
    .from("contactos")
    .update({ leido: false })
    .eq("id", contacto.id);

  res.status(201).json(data);
});

// DELETE /api/contacto/:id
// Borra la conversacion completa (mensaje original + chat_mensajes).
// Al ser compartida, tambien desaparece del lado del estudiante.
router.delete("/:id", requiereRol("admin", "coordinador"), async (req, res) => {
  const { error } = await getSupabase()
    .from("contactos")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// DELETE /api/contacto/:id/estudiante
// El estudiante borra su conversacion. Como es compartida, tambien
// desaparece del panel del admin.
router.delete("/:id/estudiante", requiereSesion, async (req, res) => {
  const { data: contacto, error: errContacto } = await getSupabase()
    .from("contactos")
    .select("id, documento")
    .eq("id", req.params.id)
    .maybeSingle();
  if (errContacto) return res.status(500).json({ error: errContacto.message });
  if (!contacto) return res.status(404).json({ error: "Mensaje no encontrado" });

  if (!contacto.documento || contacto.documento !== req.usuario.sub) {
    return res.status(403).json({ error: "No es tu mensaje" });
  }

  const { error } = await getSupabase()
    .from("contactos")
    .delete()
    .eq("id", contacto.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
