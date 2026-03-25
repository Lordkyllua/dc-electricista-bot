# 📋 Guía de instalación — DC Electricista Bot

## Qué necesitás antes de empezar
- Cuenta de Facebook/Meta (la que ya tenés)
- WhatsApp Business activo en tu número
- Email para crear cuentas en Railway y Anthropic
- GitHub (gratis) para subir el código

---

## PASO 1 — Crear app en Meta for Developers

1. Entrá a https://developers.facebook.com
2. Clic en **"Mis apps"** → **"Crear app"**
3. Tipo de app: **Business**
4. Nombre: `DC Electricista Bot` (o cualquier nombre)
5. En el panel de la app, buscá **"WhatsApp"** y clic en **Configurar**
6. Anotá el **Phone Number ID** y el **Token de acceso temporal**
   (están en la sección "API Setup")

---

## PASO 2 — Subir el código a GitHub

1. Creá cuenta en https://github.com (si no tenés)
2. Creá un repositorio nuevo llamado `dc-electricista-bot`
3. Subí todos los archivos de esta carpeta (menos el `.env`)
4. El `.gitignore` ya está configurado para ignorar el `.env`

---

## PASO 3 — Deploy en Railway

1. Entrá a https://railway.app
2. Clic en **"New Project"** → **"Deploy from GitHub repo"**
3. Conectá tu GitHub y elegí el repo `dc-electricista-bot`
4. Railway detecta automáticamente que es Node.js y lo instala

**Configurar variables de entorno en Railway:**
- Entrá a tu proyecto → pestaña **Variables**
- Agregá estas tres variables:

```
WHATSAPP_TOKEN    =  (el token de Meta del Paso 1)
VERIFY_TOKEN      =  dc_electricista_secret_2025
ANTHROPIC_API_KEY =  (tu clave de Anthropic — ver Paso 4)
```

5. Railway te da una URL pública tipo:
   `https://dc-electricista-bot-production.up.railway.app`
   **Anotala**, la vas a necesitar.

---

## PASO 4 — Obtener API Key de Anthropic

1. Entrá a https://console.anthropic.com
2. Creá una cuenta (gratis para empezar)
3. Cargá crédito mínimo (~$5 USD — dura meses con el volumen de un negocio chico)
4. Ir a **API Keys** → **Create Key**
5. Copiala y pegala en Railway como `ANTHROPIC_API_KEY`

---

## PASO 5 — Conectar el webhook en Meta

1. Volvé a https://developers.facebook.com → tu app → WhatsApp → Configuración
2. En la sección **Webhooks**, clic en **"Editar"**
3. Completá:
   - **URL de devolución de llamada**: `https://TU-URL.railway.app/webhook`
   - **Token de verificación**: `dc_electricista_secret_2025`
4. Clic en **Verificar y guardar**
   - Si aparece ✅ verde, está todo bien
   - Si falla, verificá que Railway esté corriendo (tarda ~2 min al inicio)
5. En **Campos de webhook**, suscribite a: `messages`

---

## PASO 6 — Probar el bot

1. En Meta for Developers → WhatsApp → API Setup
2. En **"To"**, poné tu número personal de WhatsApp (con código de país: 549XXXXXXXXXX)
3. Mandá un mensaje de prueba desde el panel
4. Deberías recibir una respuesta en tu WhatsApp

---

## PASO 7 — Conectar tu número real de WhatsApp Business

Este paso requiere verificación de Meta (puede tardar 1-2 días):

1. En Meta for Developers → tu app → Configuración → Básica
2. Completá la info de tu empresa
3. En WhatsApp → Números de teléfono → Agregar número
4. Meta te pide verificar el número por SMS o llamada
5. Una vez verificado, el bot responde desde tu número real

---

## Costos mensuales estimados para DC Electricista

| Servicio | Costo |
|----------|-------|
| Railway (hosting) | Gratis (hasta 500hs/mes) o $5 USD/mes ilimitado |
| Meta (conversaciones) | Gratis las primeras 1.000/mes |
| Anthropic (IA) | ~$1–3 USD/mes para volumen de pyme chica |
| **TOTAL** | **$0–8 USD/mes** |

---

## Personalizar el bot

Editá el archivo `index.js`, sección `SYSTEM_PROMPT`.
Podés cambiar:
- Precios orientativos
- Servicios ofrecidos
- Zona de cobertura
- Horarios de atención
- Tono del bot

Después de editar, hacé push a GitHub y Railway se actualiza automáticamente.

---

## ¿Algo no funciona?

Revisá los logs en Railway → tu proyecto → pestaña **Logs**.
Los errores más comunes aparecen ahí con descripción.
