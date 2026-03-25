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
//  PERSISTENCIA
// ============================================================
const BLOQUEADOS_FILE = "./bloqueados.json";
const CONOCIMIENTO_FILE = "./conocimiento.json";

function cargarJSON(archivo, defecto) {
  try {
    if (fs.existsSync(archivo)) return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch (e) { console.warn(`No se pudo cargar ${archivo}`); }
  return defecto;
}

function guardarJSON(archivo, data) {
  fs.writeFileSync(archivo, JSON.stringify(data, null, 2), "utf8");
}

const bloqueados = new Set(cargarJSON(BLOQUEADOS_FILE, []));
let conocimiento = cargarJSON(CONOCIMIENTO_FILE, []);

const NUMERO_ADMIN = process.env.NUMERO_ADMIN || "";
const conversaciones = new Map();

// ============================================================
//  HORARIO DE ATENCIÓN (zona horaria Argentina UTC-3)
// ============================================================
function estaEnHorario() {
  const ahora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const dia = ahora.getDay(); // 0=dom, 1=lun ... 6=sab
  const hora = ahora.getHours();
  const minutos = ahora.getMinutes();
  const horaDecimal = hora + minutos / 60;

  const esLunesAViernes = dia >= 1 && dia <= 5;
  const esSabado = dia === 6;

  if (esLunesAViernes && horaDecimal >= 8 && horaDecimal < 18) return "abierto";
  if (esSabado && horaDecimal >= 8 && horaDecimal < 13) return "abierto";
  if (esSabado && horaDecimal >= 13) return "urgencias";
  if (dia === 0) return "urgencias"; // domingo
  return "cerrado"; // fuera de horario en día hábil
}

const MENSAJE_FUERA_HORARIO = `¡Hola! 👋 Gracias por contactar a *DC Electricista*.

🕐 Nuestro horario de atención es:
• Lunes a viernes: 8 a 18hs
• Sábados: 8 a 13hs

En este momento estamos fuera de horario. Te respondemos en el próximo turno disponible. 🙌

— Asistente DC Electricista ⚡`;

const MENSAJE_URGENCIAS = `¡Hola! 👋 Gracias por contactar a *DC Electricista*.

⚡ Fuera del horario habitual, solo atendemos *urgencias eléctricas*.

Si tu situación es urgente, describila y Diego se va a comunicar a la brevedad.

— Asistente DC Electricista ⚡`;

// ============================================================
//  PROMPT BASE
// ============================================================
const PROMPT_BASE = `Sos el asistente virtual de DC Electricista. El electricista responsable es Diego Cristaldo, con base en San Miguel, Buenos Aires, Argentina. También trabajás en toda la zona GBA y CABA.

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

HORARIO DE ATENCIÓN:
- Lunes a viernes: 8 a 18hs
- Sábados: 8 a 13hs
- Fuera de ese horario: solo urgencias

CÓMO RESPONDÉS:
- Siempre en español rioplatense, tono amigable y profesional
- Usá emojis en tus respuestas para que sean más amigables y dinámicas, pero sin exagerar
- Respuestas cortas y directas (esto es WhatsApp, no un email)
- Si te preguntan por precios o presupuestos, decí que Diego se comunica personalmente para asesorarte según el trabajo
- Si la consulta es muy compleja o requiere inspección, decí que Diego va a comunicarse personalmente
- No inventés precios ni información técnica que no tenés
- Si alguien saluda, respondé con algo como "¡Hola! 👋 Bienvenido a DC Electricista. ¿En qué te puedo ayudar?"
- Nunca digas que sos una IA ni un bot. Si te preguntan, decí que sos el asistente de DC Electricista y cambiá el tema
- Siempre terminá tus mensajes con la firma: — Asistente DC Electricista ⚡

CONSULTAS TÉCNICAS SIMPLES QUE PODÉS RESPONDER:
- Qué puede estar causando que salte el disyuntor
- Por qué parpadean las luces
- Qué es un diferencial y para qué sirve
- Cuándo hay que llamar a un electricista
- Qué hacer ante un cortocircuito (medidas de seguridad)
- Diferencias entre monofásico y trifásico
- Qué es la puesta a tierra y por qué importa

Si el cliente quiere coordinar una visita, pedile: nombre, dirección y horario disponible, y decile que Diego lo va a confirmar. Cuando tengas esos datos completos, avisale al cliente que Diego va a confirmar pronto.`;

function buildPrompt() {
  if (conocimiento.length === 0) return PROMPT_BASE;
  const extra = conocimiento.map((k, i) => `${i + 1}. ${k}`).join("\n");
  return `${PROMPT_BASE}\n\nINFORMACIÓN ADICIONAL:\n${extra}`;
}

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
//  WEBHOOK — recibe mensajes
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
    //  COMANDOS DE ADMIN
    // --------------------------------------------------------
    const fromNorm = from.replace(/^549/, "54");
    const adminNorm = NUMERO_ADMIN.replace(/^549/, "54");

    if (adminNorm && fromNorm === adminNorm) {
      const cmd = texto.toLowerCase();

      if (cmd.startsWith("bloquear ")) {
        const numero = texto.split(" ")[1].trim();
        bloqueados.add(numero);
        guardarJSON(BLOQUEADOS_FILE, [...bloqueados]);
        await enviarMensaje(phoneNumberId, from, `🚫 Listo. El bot ya no responde a ${numero}.`);
        return;
      }
      if (cmd.startsWith("desbloquear ")) {
        const numero = texto.split(" ")[1].trim();
        bloqueados.delete(numero);
        guardarJSON(BLOQUEADOS_FILE, [...bloqueados]);
        await enviarMensaje(phoneNumberId, from, `✅ Listo. El bot vuelve a responder a ${numero}.`);
        return;
      }
      if (cmd === "lista bloqueados") {
        const lista = bloqueados.size > 0 ? [...bloqueados].join("\n") : "No hay números bloqueados.";
        await enviarMensaje(phoneNumberId, from, `📋 Números bloqueados:\n${lista}`);
        return;
      }
      if (cmd.startsWith("aprender ")) {
        const info = texto.slice(9).trim();
        conocimiento.push(info);
        guardarJSON(CONOCIMIENTO_FILE, conocimiento);
        await enviarMensaje(phoneNumberId, from, `🧠 Aprendido:\n"${info}"`);
        return;
      }
      if (cmd === "que sabes") {
        const lista = conocimiento.length > 0
          ? conocimiento.map((k, i) => `${i + 1}. ${k}`).join("\n")
          : "Todavía no aprendí nada extra.";
        await enviarMensaje(phoneNumberId, from, `🧠 Lo que sé:\n\n${lista}`);
        return;
      }
      if (cmd.startsWith("olvidar ")) {
        const info = texto.slice(8).trim();
        const antes = conocimiento.length;
        conocimiento = conocimiento.filter(k => !k.toLowerCase().includes(info.toLowerCase()));
        guardarJSON(CONOCIMIENTO_FILE, conocimiento);
        const borrados = antes - conocimiento.length;
        await enviarMensaje(phoneNumberId, from, borrados > 0
          ? `🗑️ Borré ${borrados} item(s) que contenían "${info}".`
          : `⚠️ No encontré nada con "${info}".`
        );
        return;
      }
      if (cmd === "ayuda" || cmd === "comandos") {
        await enviarMensaje(phoneNumberId, from,
`📋 *Comandos disponibles:*

🚫 *Bloqueos:*
bloquear 549XXXXXXXX
desbloquear 549XXXXXXXX
lista bloqueados

🧠 *Aprendizaje:*
aprender [información]
que sabes
olvidar [texto]

❓ *Ayuda:*
ayuda`);
        return;
      }
    }

    // --------------------------------------------------------
    //  FILTRO — ignorar bloqueados
    // --------------------------------------------------------
    const fromAlt = from.startsWith("549") ? "54" + from.slice(3) : "549" + from.slice(2);
    if (bloqueados.has(from) || bloqueados.has(fromAlt)) {
      console.log(`🚫 Ignorado (bloqueado): ${from}`);
      return;
    }

    // --------------------------------------------------------
    //  HORARIO — respuesta automática fuera de horario
    // --------------------------------------------------------
    const estado = estaEnHorario();

    if (estado === "cerrado") {
      await enviarMensaje(phoneNumberId, from, MENSAJE_FUERA_HORARIO);
      console.log(`🕐 Fuera de horario, mensaje automático enviado a ${from}`);
      return;
    }

    if (estado === "urgencias") {
      // En modo urgencias deja pasar pero con prompt especial de urgencias
      // Solo responde si el mensaje parece una urgencia, sino manda el mensaje de urgencias
      const esUrgencia = /quema|fuego|corto|chispa|explosi|luz|sin luz|cortocircuito|urgente|urgencia|peligro/i.test(texto);
      if (!esUrgencia) {
        await enviarMensaje(phoneNumberId, from, MENSAJE_URGENCIAS);
        return;
      }
    }

    // --------------------------------------------------------
    //  Respuesta con IA
    // --------------------------------------------------------
    if (!conversaciones.has(from)) conversaciones.set(from, []);
    const historial = conversaciones.get(from);
    historial.push({ role: "user", content: texto });

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 400,
      messages: [
        { role: "system", content: buildPrompt() },
        ...historial.slice(-10),
      ],
    });

    const respuesta = response.choices[0].message.content;
    historial.push({ role: "assistant", content: respuesta });
    if (historial.length > 30) conversaciones.set(from, historial.slice(-20));

    // --------------------------------------------------------
    //  NOTIFICACIÓN A DIEGO cuando alguien agenda visita
    // --------------------------------------------------------
    const quiereVisita = /nombre|direcci[oó]n|horario|visita|coordinar|agenda|cuando pueden|cu[aá]ndo/i.test(texto);
    const tieneNombre = /me llamo|soy |mi nombre/i.test(texto);
    const tieneDireccion = /calle|avenida|barrio|entre |altura |n[uú]mero|\d{3,}/i.test(texto);

    if (tieneNombre && tieneDireccion && adminNorm && NUMERO_ADMIN) {
      const aviso =
`📋 *Nueva solicitud de visita*

👤 Cliente: ${from}
💬 Mensaje: "${texto}"

Revisar y confirmar turno.`;
      try {
        await enviarMensaje(phoneNumberId, NUMERO_ADMIN, aviso);
        console.log(`🔔 Notificación de visita enviada a Diego`);
      } catch (e) {
        console.warn("No se pudo notificar a Diego:", e.message);
      }
    }

    await enviarMensaje(phoneNumberId, from, respuesta);

  } catch (err) {
    console.error("❌ Error procesando mensaje:", err.message);
  }
});

// ============================================================
//  Envío con fallback formato argentino
// ============================================================
function formatosNumero(numero) {
  const formatos = [numero];
  if (numero.startsWith("549")) formatos.push("54" + numero.slice(3));
  else if (numero.startsWith("54") && !numero.startsWith("549")) formatos.push("549" + numero.slice(2));
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

    if (res.ok) { console.log(`✉️  Enviado a ${numero}`); return; }

    const errorText = await res.text();
    console.warn(`⚠️  Falló con ${numero}: ${errorText}`);
    if (!errorText.includes("131030")) throw new Error(`Meta API error: ${errorText}`);
  }
  throw new Error("No se pudo enviar con ningún formato de número");
}

// ============================================================
//  Health check + servidor
// ============================================================
app.get("/", (req, res) => res.send("DC Electricista Bot — activo ✅"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot corriendo en puerto ${PORT}`));
