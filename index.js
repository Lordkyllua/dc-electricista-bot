// ============================================================
//  DC Electricista — Bot de WhatsApp
//  Stack: Node.js + Meta Cloud API + Groq (gratis)
// ============================================================

import express from "express";
import fetch from "node-fetch";
import Groq from "groq-sdk";

const app = express();
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Historial de conversaciones en memoria
const conversaciones = new Map();

// ============================================================
//  PERSONALIDAD DEL BOT — editá esto a gusto
// ============================================================
const SYSTEM_PROMPT = `Sos el asistente virtual de DC Electricista, empresa de electricidad residencial de Lord, ubicada en San Miguel, Buenos Aires, Argentina. También trabajás en toda la zona GBA y CABA.

SERVICIOS QUE OFRECEMOS:
- Instalaciones eléctricas residenciales
- Reparaciones y mantenimiento eléctrico
- Porteros eléctricos (instalación y reparación)
- Instalación de aire acondicionado
- Diagnóstico y reparación de problemas eléctricos

ZONA DE COBERTURA:
- San Miguel (base de operaciones)
- Gran Buenos Aires (GBA) completo
- Ciudad Autónoma de Buenos Aires (CABA)

CÓMO RESPONDÉS:
- Siempre en español rioplatense, tono amigable y profesional
- Respuestas cortas y directas (esto es WhatsApp, no un email)
- Si te preguntan por un precio exacto, explicá que depende de la visita técnica pero podés dar rangos orientativos
- Si la consulta es muy compleja o requiere inspección, decí que Lord (el electricista) va a comunicarse personalmente
- No inventés precios ni información técnica que no tenés
- Si alguien saluda, respondé el saludo y preguntá en qué podés ayudar
- Nunca digas que sos una IA a menos que te lo pregunten directamente

CONSULTAS TÉCNICAS SIMPLES QUE PODÉS RESPONDER:
- Qué puede estar causando que salte el disyuntor
- Por qué parpadean las luces
- Qué es un diferencial y para qué sirve
- Cuándo hay que llamar a un electricista
- Qué hacer ante un cortocircuito (medidas de seguridad)
- Diferencias entre monofásico y trifásico
- Qué es la puesta a tierra y por qué importa

PRECIOS ORIENTATIVOS (rangos, siempre aclarar que son aproximados y sujetos a inspección):
- Visita técnica básica: desde $15.000
- Cambio de toma corriente: desde $8.000
- Instalación de llave térmica: desde $12.000
- Portero eléctrico simple: desde $35.000
- Instalación de split: desde $25.000 (sin equipo)

Si el cliente quiere coordinar una visita, pedile: nombre, dirección y horario disponible, y decile que Lord lo va a confirmar.`;

// ============================================================
//  WEBHOOK — verificación de Meta
// ============================================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    return res.status(200).send(challenge);
  }
  console.warn("⚠️  Verificación fallida");
  res.sendStatus(403);
});

// ============================================================
//  WEBHOOK — recibe mensajes entrantes
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Meta necesita 200 rápido

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Solo procesamos mensajes de texto
    if (value?.messages?.[0]?.type !== "text") return;

    const msg = value.messages[0];
    const from = msg.from;
    const texto = msg.text.body;
    const phoneNumberId = value.metadata.phone_number_id;

    console.log(`📩 Mensaje de ${from}: ${texto}`);

    // Construir historial de conversación
    if (!conversaciones.has(from)) {
      conversaciones.set(from, []);
    }
    const historial = conversaciones.get(from);
    historial.push({ role: "user", content: texto });

    // Llamada a Groq
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...historial.slice(-10),
      ],
    });

    const respuesta = response.choices[0].message.content;
    historial.push({ role: "assistant", content: respuesta });

    // Limpiar historial si es muy largo
    if (historial.length > 30) {
      conversaciones.set(from, historial.slice(-20));
    }

    // Enviar respuesta por WhatsApp
    await enviarMensaje(phoneNumberId, from, respuesta);
    console.log(`✉️  Respuesta enviada a ${from}`);
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err.message);
  }
});

// ============================================================
//  Función para enviar mensajes via Meta API
// ============================================================
async function enviarMensaje(phoneNumberId, to, texto) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Meta API error: ${error}`);
  }
}

// ============================================================
//  Health check para Render
// ============================================================
app.get("/", (req, res) => {
  res.send("DC Electricista Bot — activo ✅");
});

// ============================================================
//  Arrancar servidor
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot corriendo en puerto ${PORT}`);
});
