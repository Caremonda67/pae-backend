// Backend: monta la API que usa el frontend. Los datos viven en Supabase.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Importamos las rutas de la aplicacion
import reservasRouter from "./routes/reservas.js";
import menusRouter from "./routes/menus.js";
import contactoRouter from "./routes/contacto.js";
import chatRouter from "./routes/chat.js";
import avisosRouter from "./routes/avisos.js";
import adminRouter from "./routes/admin.js";
import loginRouter from "./routes/login.js";
import usuariosRouter from "./routes/usuarios.js";
import beneficiariosRouter from "./routes/beneficiarios.js";
import notificacionesRouter from "./routes/notificaciones.js";
import archivosRouter from "./routes/archivos.js";
import estadisticasRouter from "./routes/estadisticas.js";
import galeriaRouter from "./routes/galeria.js";
import metricasRouter from "./routes/metricas.js";
import institucionesRouter from "./routes/instituciones.js";
import sedesRouter from "./routes/sedes.js";
import sobrantesRouter from "./routes/sobrantes.js";
import asistenciaRouter from "./routes/asistencia.js";
import incidentesRouter from "./routes/incidentes.js";
import settingsRouter from "./routes/settings.js";
import turnosRouter from "./routes/turnos.js";
import auditoriaRouter from "./routes/auditoria.js";
import juegosRouter from "./routes/juegos.js";
import colaboradoresRouter from "./routes/colaboradores.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Detras del proxy de Render, la IP real del cliente viene en X-Forwarded-For.
// Sin esto, req.ip es siempre la IP del proxy y el rate limit por IP no funciona.
app.set("trust proxy", 1);

// Middlewares
// 1. cors: permite que el frontend (en otro puerto/dominio) haga peticiones
// Debe ser el primer middleware para que todas las respuestas incluyan cabeceras CORS.
app.use(cors({
  origin: (process.env.FRONTEND_URL || "").replace(/\/+$/, "") || true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
}));

// helmet: headers de seguridad por defecto (XSS, sniffing, frameguard...).
//   contentSecurityPolicy se apaga: este backend solo responde JSON (no
//   sirve HTML), asi que la CSP no le protejeria nada. La CSP del sitio se
//   debe definir en el deploy del frontend (SPA servido por Vercel/Render),
//   no aqui.
//   crossOriginResourcePolicy se apaga para que las imagenes de
//   Supabase Storage se puedan cargar desde el navegador.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Rate limit global: 200 peticiones cada minuto por IP. Protege
// todas las rutas que no tienen su propio limite.
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Intenta de nuevo en un minuto." },
}));

app.use(express.json({ limit: "8mb" }));

// Ruta de salud: sirve para verificar que el servidor esta vivo
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", servicio: "PAE API", fecha: new Date().toISOString() });
});

// Montamos las rutas bajo /api
app.use("/api/reservas", reservasRouter);
app.use("/api/menus", menusRouter);
app.use("/api/contacto", contactoRouter);
app.use("/api/chat", chatRouter);
app.use("/api/avisos", avisosRouter);
app.use("/api/admin", adminRouter);
app.use("/api/login", loginRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/beneficiarios", beneficiariosRouter);
app.use("/api/notificaciones", notificacionesRouter);
app.use("/api/archivos", archivosRouter);
app.use("/api/estadisticas", estadisticasRouter);
app.use("/api/galeria", galeriaRouter);
app.use("/api/metricas", metricasRouter);
app.use("/api/instituciones", institucionesRouter);
app.use("/api/sedes", sedesRouter);
app.use("/api/sobrantes", sobrantesRouter);
app.use("/api/asistencia", asistenciaRouter);
app.use("/api/incidentes", incidentesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/turnos", turnosRouter);
app.use("/api/auditoria", auditoriaRouter);
app.use("/api/juegos", juegosRouter);
app.use("/api/colaboradores", colaboradoresRouter);

// Middleware para rutas no encontradas (error 404)
app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// Manejador global de errores: si alguna ruta falla, respondemos un
// 500 limpio y el servidor sigue vivo. Sin esto, un error no capturado
// dentro de una ruta async derriba todo el proceso.
app.use((err, _req, res, _next) => {
  console.error("Error no controlado:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Red de seguridad del proceso: registramos los rechazos de promesas
// y excepciones que se escapen, sin dejar de atender peticiones.
process.on("unhandledRejection", (razon) => {
  console.error("Promesa rechazada sin capturar:", razon);
});
process.on("uncaughtException", (err) => {
  console.error("Excepcion no capturada:", err);
});

// Arrancamos el servidor
app.listen(PORT, () => {
  console.log(`PAE API corriendo en http://localhost:${PORT}`);
});
