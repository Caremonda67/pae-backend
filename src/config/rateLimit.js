// Limites de peticiones por IP para los endpoints publicos.
import rateLimit from "express-rate-limit";

// Login: 30 intentos / 10 min por IP (varias maquinas del colegio comparten IP).
export const limiteLogin = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesion. Espera 10 minutos." },
});

// Chat: 15 mensajes / 5 min por IP (cada mensaje gasta cuota de Gemini).
export const limiteChat = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes al chat. Espera unos minutos e intenta de nuevo." },
});

// Formularios publicos (contacto y reservas): 30 peticiones / 10 min por IP.
export const limiteFormularios = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Espera unos minutos e intenta de nuevo." },
});
