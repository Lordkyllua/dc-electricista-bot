// ============================================================
//  DC Electricista — Bot de WhatsApp
//  Stack: Node.js + Meta Cloud API + Groq (gratis)
// ============================================================

import express from "express";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import fs from "fs";

const app = express();
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
//  LISTA DE BLOQUEADOS — se guarda en disco para que persista
// ============================================================
const BLOQUEADOS_FILE = "./bloqueados.json";

function cargarBloqueados() {
  try {
    if (fs.existsSync(BLOQUEADOS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(BLOQUEADOS_FILE, "utf8")));
    }
  } catch (e) {
    console.warn("No se pudo cargar bloqueados.json, arrancando vacío");
  }
  return new Set();
}

function guardarBloqueados(set) {
  fs.writeFileSync(BLOQUEADOS_FILE, JSON.stringify([...set]), "utf8");
}

const bloqueados = cargarBloqueados();

// Tu número de WhatsApp (sin + ni espacios) — el bot solo acepta comandos de este número
const NUMERO_ADMIN = process.env.NUMERO_ADMIN || "";

// ============================================================
//  Historial de conversaciones
// ============================================================
const conversaciones = new Map();

// ============================================================
//  PERSONALIDAD DEL BOT
// ============================================================
const SYSTEM_PROMPT = `Sos el asistente virtual de DC Electricista. El electricista responsable es Diego Cristaldo, con base en San Miguel, Buenos Aires, Argentina. También trabajás en toda la zona GBA y CABA.

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
- Si te preguntan por precios o presupuestos, decí que Diego se comunica personalmente para asesorarte según el trabajo
- Si la consulta es muy compleja o requiere inspección, decí que Diego (el electricista) va a comunicarse personalmente
- No inventés precios ni información técnica que no tenés
- Si alguien saluda, respondé el saludo y preguntá en qué podés ayudar
- Nunca digas que sos una IA ni un bot, bajo ninguna circunstancia. Si te preguntan, decí que sos el asistente de DC Electricista y cambiá el tema

CONSULTAS TÉCNICAS SIMPLES QUE PODÉS RESPONDER:
- Qué puede estar causando que salte el disyuntor
- Por qué parpadean las luces
- Qué es un diferencial y para qué sirve
- Cuándo hay que llamar a un electricista
- Qué hacer ante un cortocircuito (medidas de seguridad)
- Diferencias entre monofásico y trifásico
- Qué es la puesta a tierra y por qué importa


Si el cliente quiere coordinar una visita, pedile: nombre, dirección y horario disponible, y decile que Diego lo va a confirmar.`;

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
  res.sendStatus(403);
});

// ============================================================
//  WEBHOOK — recibe mensajes entrantes
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (value?.messages?.[0]?.type !== "text") return;

    const msg = value.messages[0];
    const from = msg.from;
    const texto = msg.text.body.trim();
    const phoneNumberId = value.metadata.phone_number_id;

    console.log(`📩 Mensaje de ${from}: ${texto}`);

    // --------------------------------------------------------
    //  COMANDOS DE ADMIN — solo los acepta Diego
    // --------------------------------------------------------
    const fromNormalizado = from.replace(/^549/, "54");
    const adminNormalizado = NUMERO_ADMIN.replace(/^549/, "54");

    if (adminNormalizado && fromNormalizado === adminNormalizado) {
      const cmd = texto.toLowerCase();

      if (cmd.startsWith("bloquear ")) {
        const numero = texto.split(" ")[1].trim();
        bloqueados.add(numero);
        guardarBloqueados(bloqueados);
        await enviarMensaje(phoneNumberId, from, `✅ Número ${numero} bloqueado. El bot ya no le responde.`);
        console.log(`🚫 Bloqueado: ${numero}`);
        return;
      }

      if (cmd.startsWith("desbloquear ")) {
        const numero = texto.split(" ")[1].trim();
        bloqueados.delete(numero);
        guardarBloqueados(bloqueados);
        await enviarMensaje(phoneNumberId, from, `✅ Número ${numero} desbloqueado. El bot vuelve a responderle.`);
        console.log(`✔️  Desbloqueado: ${numero}`);
        return;
      }

      if (cmd === "lista bloqueados") {
        const lista = bloqueados.size > 0
          ? [...bloqueados].join("\n")
          : "No hay números bloqueados.";
        await enviarMensaje(phoneNumberId, from, `📋 Números bloqueados:\n${lista}`);
        return;
      }
    }

    // --------------------------------------------------------
    //  FILTRO — ignorar números bloqueados silenciosamente
    // --------------------------------------------------------
    const fromAlt = from.startsWith("549")
      ? "54" + from.slice(3)
      : "549" + from.slice(2);

    if (bloqueados.has(from) || bloqueados.has(fromAlt)) {
      console.log(`🚫 Mensaje ignorado de número bloqueado: ${from}`);
      return;
    }

    // --------------------------------------------------------
    //  Respuesta normal con IA
    // --------------------------------------------------------
    if (!conversaciones.has(from)) conversaciones.set(from, []);
    const historial = conversaciones.get(from);
    historial.push({ role: "user", content: texto });

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
    if (historial.length > 30) conversaciones.set(from, historial.slice(-20));

    await enviarMensaje(phoneNumberId, from, respuesta);

  } catch (err) {
    console.error("❌ Error procesando mensaje:", err.message);
  }
});

// ============================================================
//  Corrección formato número argentino + envío con fallback
// ============================================================
function formatosNumero(numero) {
  const formatos = [numero];
  if (numero.startsWith("549")) {
    formatos.push("54" + numero.slice(3));
  } else if (numero.startsWith("54") && !numero.startsWith("549")) {
    formatos.push("549" + numero.slice(2));
  }
  return formatos;
}

async function enviarMensaje(phoneNumberId, to, texto) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const numeros = formatosNumero(to);

  for (const numero of numeros) {
    console.log(`📤 Intentando enviar a ${numero}...`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: numero,
        type: "text",
        text: { body: texto },
      }),
    });

    if (res.ok) {
      console.log(`✉️  Respuesta enviada a ${numero}`);
      return;
    }

    const errorText = await res.text();
    console.warn(`⚠️  Falló con ${numero}: ${errorText}`);
    if (!errorText.includes("131030")) throw new Error(`Meta API error: ${errorText}`);
  }

  throw new Error("No se pudo enviar con ningún formato de número");
}

// ============================================================
//  Health check
// ============================================================
app.get("/", (req, res) => res.send("DC Electricista Bot — activo ✅"));

// ============================================================
//  Arrancar servidor
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot corriendo en puerto ${PORT}`));
