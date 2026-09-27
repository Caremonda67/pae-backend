// Envio de correos con Resend (por HTTP, que Render gratis no bloquea).
// Sin RESEND_API_KEY o RESEND_FROM las funciones devuelven false.

export async function enviarEmail(destinatario, asunto, texto, html) {
  try {
    if (!destinatario) return false;

    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM,
      to: destinatario,
      subject: asunto,
      text: texto,
      html: html || undefined,
    });

    if (error) {
      console.error("Resend rechazo el email:", error.message);
      return false;
    }

    console.log("Email enviado a", destinatario);
    return true;
  } catch (err) {
    console.error("No se pudo enviar el email:", err.message);
    return false;
  }
}

// ¿Esta configurado el envio? (sin key ni remitente no hay nada que hacer)
export function correoConfigurado() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}
