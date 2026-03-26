// ============================================================
//  DC Electricista — Bot de WhatsApp
//  Stack: Node.js + Meta Cloud API + Groq (gratis)
//  Versión: 2.0 — Revisada y mejorada
// ============================================================

import express from "express";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import fs from "fs";

const app = express();
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
//  CONFIGURACIÓN
// ============================================================
const NUMERO_ADMIN  = process.env.NUMERO_ADMIN  || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const VERIFY_TOKEN  = process.env.VERIFY_TOKEN  || "";

// ============================================================
//  PERSISTENCIA EN DISCO
// ============================================================
const BLOQUEADOS_FILE   = "./bloqueados.json";
const CONOCIMIENTO_FILE = "./conocimiento.json";
const URGENCIAS_FILE    = "./urgencias.json";

function cargarJSON(archivo, defecto) {
  try {
    if (fs.existsSync(archivo)) return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch (e) { console.warn(`No se pudo cargar ${archivo}`); }
  return defecto;
}

function guardarJSON(archivo, data) {
  try { fs.writeFileSync(archivo, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error(`Error guardando ${archivo}:`, e.message); }
}

const bloqueados       = new Set(cargarJSON(BLOQUEADOS_FILE, []));
let   conocimiento     = cargarJSON(CONOCIMIENTO_FILE, []);
const urgenciasActivas = new Set(cargarJSON(URGENCIAS_FILE, []));
const conversaciones   = new Map();

// ============================================================
//  HORARIO — Argentina UTC-3
// ============================================================
function estadoHorario() {
  const ahora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const dia   = ahora.getDay();
  const hora  = ahora.getHours() + ahora.getMinutes() / 60;

  if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 18) return "abierto";
  if (dia === 6             && hora >= 8 && hora < 13) return "abierto";
  return "cerrado";
}

// ============================================================
//  MENSAJES FIJOS
// ============================================================
const MSG_FUERA_HORARIO = `¡Hola! 👋 Gracias por contactar a *DC Electricista*.

🕐 Nuestro horario de atención es:
• Lunes a viernes: 8 a 18hs
• Sábados: 8 a 13hs

En este momento estamos fuera de horario. Solo atendemos *urgencias eléctricas* 🔌

Si tenés una urgencia (sin luz, cortocircuito, chispa, peligro eléctrico), escribinos y Diego te atiende a la brevedad. ⚡

Si no es urgente, te respondemos en el próximo horario disponible. 🙌

— Asistente DC Electricista ⚡`;

const MSG_URGENCIA_RECIBIDA = `⚡ *Urgencia recibida — DC Electricista*

Entendemos que es urgente y lo estamos tomando con prioridad. 🙏

Diego fue notificado y se va a comunicar con vos a la brevedad.

Para que pueda ir preparado, contanos:
• ¿Qué está pasando exactamente?
• ¿Cuál es tu dirección?

— Asistente DC Electricista ⚡`;

// ============================================================
//  DETECCIÓN DE URGENCIAS
// ============================================================
const REGEX_URGENCIA = /quema|fuego|corto|chispa|explosi|sin luz|cortocircuito|peligro|urgente|urgencia|necesito a diego|hablar con diego|quiero hablar|llamame|llam[aá]me|no tenemos luz|quedamos sin luz|se fue la luz|no hay luz|devuelvan la luz|electrocuc|humo|olor a quemado/i;

// ============================================================
//  PROMPTS
// ============================================================
const PROMPT_BASE = `Sos el asistente virtual de DC Electricista. El electricista responsable es Diego Cristaldo, con base en San Miguel, Buenos Aires, Argentina. También trabajás en toda la zona GBA y CABA.

SERVICIOS:
- Instalaciones eléctricas residenciales
- Reparaciones y mantenimiento eléctrico
- Porteros eléctricos (instalación y reparación)
- Instalación de aire acondicionado (split)
- Diagnóstico y reparación de problemas eléctricos

ZONA DE COBERTURA:
- San Miguel (base de operaciones)
- Gran Buenos Aires (GBA) completo
- Ciudad Autónoma de Buenos Aires (CABA)

HORARIO DE ATENCIÓN:
- Lunes a viernes: 8 a 18hs
- Sábados: 8 a 13hs
- Fuera de ese horario: solo urgencias eléctricas

REGLAS DE RESPUESTA:
- Español rioplatense, tono amigable y profesional
- Usá emojis para que las respuestas sean cálidas, pero sin exagerar
- Mensajes cortos y directos — esto es WhatsApp, no un email
- Al saludar siempre mencioná DC Electricista: "¡Hola! 👋 Bienvenido a DC Electricista. ¿En qué te puedo ayudar?"
- Nunca menciones precios ni presupuestos — decí que Diego se comunica personalmente para asesorar
- Si el cliente pide hablar con Diego: "¡Por supuesto! 😊 Diego se va a comunicar con vos en breve. ¿Querés dejarle algún mensaje?"
- Si la consulta requiere inspección: "🙌 Entendido. Diego se va a comunicar con vos en breve."
- Si no sabés responder algo con certeza: "Diego te va a responder personalmente. ¡Gracias por tu paciencia! 🙏"
- Nunca digas que sos una IA ni un bot
- Siempre terminá con la firma: — Asistente DC Electricista ⚡

CONSULTAS TÉCNICAS QUE PODÉS RESPONDER:
- Por qué salta el disyuntor o el diferencial
- Por qué parpadean las luces
- Qué es un diferencial y para qué sirve
- Qué hacer ante un cortocircuito (medidas de seguridad básicas)
- Diferencias entre monofásico y trifásico
- Qué es la puesta a tierra y por qué importa
- Cuándo es necesario llamar a un electricista

Si el cliente quiere coordinar una visita, pedile nombre, dirección y horario disponible. Cuando los tengas todos, confirmale que Diego lo va a contactar para confirmar.`;

const PROMPT_URGENCIA = `${PROMPT_BASE}

MODO URGENCIA ACTIVA — REGLAS ESPECIALES:
- El cliente tiene una emergencia eléctrica y ya fue notificado Diego
- Respondé naturalmente según la conversación — no repitas preguntas ya respondidas
- Si ya tenés problema y dirección, confirmale que Diego fue notificado y se contacta pronto
- Si pregunta cuánto tarda Diego: "Diego se va a comunicar a la brevedad, gracias por tu paciencia. 🙏"
- Si no podés responder algo con certeza, no inventes — derivá a Diego
- Sé empático, muy breve y tranquilizador
- Siempre terminá con la firma`;

function buildPrompt(urgencia = false) {
  const base = urgencia ? PROMPT_URGENCIA : PROMPT_BASE;
  if (conocimiento.length === 0) return base;
  const extra = conocimiento.map((k, i) => `${i + 1}. ${k}`).join("\n");
  return `${base}\n\nINFORMACIÓN ADICIONAL SOBRE DC ELECTRICISTA:\n${extra}`;
}

// ============================================================
//  UTILIDADES DE NÚMEROS
// ============================================================
function variantes(numero) {
  if (numero.startsWith("549")) return [numero, "54" + numero.slice(3)];
  if (numero.startsWith("54"))  return [numero, "549" + numero.slice(2)];
  return [numero];
}

function esAdmin(from)            { return NUMERO_ADMIN && variantes(from).some(v => variantes(NUMERO_ADMIN).includes(v)); }
function estaBloqueado(from)      { return variantes(from).some(v => bloqueados.has(v)); }
function tieneUrgencia(from)      { return variantes(from).some(v => urgenciasActivas.has(v)); }
function activarUrgencia(from)    { variantes(from).forEach(v => urgenciasActivas.add(v)); guardarJSON(URGENCIAS_FILE, [...urgenciasActivas]); }

// ============================================================
//  ENVÍO DE MENSAJES
// ============================================================
async function enviarMensaje(phoneId, to, texto) {
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

  for (const numero of variantes(to)) {
    console.log(`📤 → ${numero}`);
    const res  = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "text", text: { body: texto } }),
    });
    const data = await res.json();

    if (res.ok)                      { console.log(`✉️  OK → ${numero}`); return; }
    if (data?.error?.code === 190)   { console.error("🔑 TOKEN EXPIRADO — Renovar en Meta for Developers"); throw new Error("TOKEN_EXPIRADO"); }
    if (data?.error?.code === 131030){ console.warn(`⚠️  No autorizado: ${numero}`); continue; }

    throw new Error(`Meta ${data?.error?.code}: ${data?.error?.message}`);
  }
  throw new Error("No se pudo enviar con ningún formato de número");
}

async function notificarDiego(phoneId, mensaje) {
  if (!NUMERO_ADMIN) return;
  try { await enviarMensaje(phoneId, NUMERO_ADMIN, mensaje); console.log("🔔 Diego notificado"); }
  catch (e) { console.warn("No se pudo notificar a Diego:", e.message); }
}

// ============================================================
//  IA — Groq con fallback
// ============================================================
async function consultarIA(mensajes, urgencia = false) {
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: urgencia ? 300 : 400,
      temperature: 0.7,
      messages: [{ role: "system", content: buildPrompt(urgencia) }, ...mensajes],
    });
    return res.choices[0].message.content;
  } catch (e) {
    console.error("❌ Error Groq:", e.message);
    return "Gracias por tu mensaje. Diego se va a comunicar con vos a la brevedad. 🙏\n\n— Asistente DC Electricista ⚡";
  }
}

// ============================================================
//  WEBHOOK — Verificación
// ============================================================
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ============================================================
//  WEBHOOK — Mensajes
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];
    if (!msg || msg.type !== "text") return;

    const from    = msg.from;
    const texto   = msg.text.body.trim();
    const phoneId = value.metadata.phone_number_id;

    console.log(`📩 [${from}]: ${texto}`);

    // 1 — ADMIN
    if (esAdmin(from)) {
      const cmd = texto.toLowerCase().trim();

      if (cmd.startsWith("bloquear ")) {
        const n = texto.slice(9).trim();
        bloqueados.add(n); guardarJSON(BLOQUEADOS_FILE, [...bloqueados]);
        await enviarMensaje(phoneId, from, `🚫 Bloqueado: ${n}`); return;
      }
      if (cmd.startsWith("desbloquear ")) {
        const n = texto.slice(12).trim();
        bloqueados.delete(n); guardarJSON(BLOQUEADOS_FILE, [...bloqueados]);
        await enviarMensaje(phoneId, from, `✅ Desbloqueado: ${n}`); return;
      }
      if (cmd === "lista bloqueados") {
        await enviarMensaje(phoneId, from, bloqueados.size > 0
          ? `📋 *Bloqueados (${bloqueados.size}):*\n${[...bloqueados].join("\n")}`
          : "No hay números bloqueados."); return;
      }
      if (cmd.startsWith("aprender ")) {
        const info = texto.slice(9).trim();
        if (!info) { await enviarMensaje(phoneId, from, "⚠️ Falta la información.\nEjemplo:\naprender Aceptamos transferencia bancaria"); return; }
        conocimiento.push(info); guardarJSON(CONOCIMIENTO_FILE, conocimiento);
        await enviarMensaje(phoneId, from, `🧠 Aprendido (${conocimiento.length} total):\n"${info}"`); return;
      }
      if (cmd === "que sabes") {
        await enviarMensaje(phoneId, from, conocimiento.length > 0
          ? `🧠 *Lo que sé (${conocimiento.length} items):*\n\n${conocimiento.map((k,i)=>`${i+1}. ${k}`).join("\n")}`
          : "Todavía no aprendí nada extra.\n\nUsá: aprender [información]"); return;
      }
      if (cmd.startsWith("olvidar ")) {
        const buscar = texto.slice(8).trim().toLowerCase();
        const antes = conocimiento.length;
        conocimiento = conocimiento.filter(k => !k.toLowerCase().includes(buscar));
        guardarJSON(CONOCIMIENTO_FILE, conocimiento);
        const borrados = antes - conocimiento.length;
        await enviarMensaje(phoneId, from, borrados > 0
          ? `🗑️ Borré ${borrados} item(s) con "${buscar}".`
          : `⚠️ No encontré nada con "${buscar}".`); return;
      }
      if (cmd === "ayuda" || cmd === "comandos") {
        await enviarMensaje(phoneId, from,
`📋 *Comandos disponibles:*

🚫 *Bloqueos:*
bloquear [número]
desbloquear [número]
lista bloqueados

🧠 *Aprendizaje:*
aprender [información]
que sabes
olvidar [texto]

❓ *Ayuda:*
ayuda`); return;
      }
    }

    // 2 — BLOQUEADOS
    if (estaBloqueado(from)) { console.log(`🚫 Bloqueado: ${from}`); return; }

    // 3 — HORARIO Y URGENCIAS
    const fueraHorario  = estadoHorario() !== "abierto";
    const esUrg         = REGEX_URGENCIA.test(texto);
    const urgActiva     = tieneUrgencia(from);

    if (fueraHorario && (esUrg || urgActiva)) {
      if (!urgActiva) activarUrgencia(from);

      const hist         = conversaciones.get(from) || [];
      const esPrimero    = hist.length === 0;

      // Notificar a Diego la primera vez
      if (esPrimero) {
        await notificarDiego(phoneId,
`⚠️ *URGENCIA FUERA DE HORARIO*

👤 Cliente: ${from}
💬 "${texto}"

Requiere atención inmediata.`);
      }

      // Notificar si da dirección
      if (!esPrimero && /calle |avenida |barrio |entre |vivo en |quedo en |mi domicilio|\bN°|\bNro\b/i.test(texto)) {
        await notificarDiego(phoneId, `📍 *Dirección recibida*\n👤 ${from}\n📌 "${texto}"`);
      }

      // Primer mensaje: respuesta fija
      if (esPrimero) {
        hist.push({ role: "user", content: texto }, { role: "assistant", content: MSG_URGENCIA_RECIBIDA });
        conversaciones.set(from, hist);
        await enviarMensaje(phoneId, from, MSG_URGENCIA_RECIBIDA);
        console.log(`🚨 Urgencia: ${from}`);
        return;
      }

      // Siguientes: IA con contexto de urgencia
      hist.push({ role: "user", content: texto });
      const respuesta = await consultarIA(hist.slice(-8), true);
      hist.push({ role: "assistant", content: respuesta });
      conversaciones.set(from, hist);
      await enviarMensaje(phoneId, from, respuesta);
      return;
    }

    // 4 — FUERA DE HORARIO SIN URGENCIA
    if (fueraHorario) {
      await enviarMensaje(phoneId, from, MSG_FUERA_HORARIO);
      console.log(`🕐 Fuera de horario → ${from}`);
      return;
    }

    // 5 — HORARIO NORMAL CON IA
    if (!conversaciones.has(from)) conversaciones.set(from, []);
    const hist = conversaciones.get(from);
    hist.push({ role: "user", content: texto });

    const respuesta = await consultarIA(hist.slice(-10));
    hist.push({ role: "assistant", content: respuesta });
    if (hist.length > 30) conversaciones.set(from, hist.slice(-20));

    // Notificar si da datos completos de visita
    const tieneNombre    = /me llamo |soy |mi nombre es /i.test(texto);
    const tieneDireccion = /calle |avenida |barrio |entre |vivo en |quedo en |mi domicilio/i.test(texto);
    if (tieneNombre && tieneDireccion) {
      await notificarDiego(phoneId,
`📋 *Solicitud de visita*

👤 ${from}
💬 "${texto}"

Revisar y confirmar turno.`);
    }

    await enviarMensaje(phoneId, from, respuesta);

  } catch (err) {
    if (err.message === "TOKEN_EXPIRADO") return;
    console.error("❌ Error:", err.message);
  }
});

// ============================================================
//  Health check con estado del sistema
// ============================================================
app.get("/", (req, res) => {
  const hora = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  res.send([
    "DC Electricista Bot — activo ✅",
    `Hora Argentina: ${hora}`,
    `Horario: ${estadoHorario()}`,
    `Bloqueados: ${bloqueados.size}`,
    `Urgencias activas: ${urgenciasActivas.size}`,
    `Conocimiento extra: ${conocimiento.length} items`,
  ].join("\n"));
});

// ============================================================
//  Servidor
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 DC Electricista Bot — puerto ${PORT}`);
  console.log(`📍 Horario: ${estadoHorario()}`);
  console.log(`🚫 Bloqueados: ${bloqueados.size} | 🚨 Urgencias: ${urgenciasActivas.size} | 🧠 Conocimiento: ${conocimiento.length}`);
});
