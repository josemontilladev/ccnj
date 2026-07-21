/* /api/extract — Lee una planilla con IA desde el servidor (Vercel).
   Las claves API viven en variables de entorno de Vercel, nunca en el
   navegador. Solo usuarios con sesión de Supabase pueden usarla.

   Variables de entorno requeridas en Vercel:
   - SUPABASE_URL, SUPABASE_ANON_KEY  (para validar la sesión)
   - GEMINI_API_KEY                    (lector principal)
   - OPENROUTER_API_KEY                (respaldo, opcional)
*/

const EXTRACT_KEYS = [
  'nombres','ci','fecha_nacimiento','lugar_nacimiento','estado_civil','correo','telefono',
  'direccion','ocupacion','profesion','esposo','hijos','padres','vive_con_padres',
  'vive_con_esposo_hijos','recibio_cristo','bautizo','tiempo_confraternidad','funcion',
  'foto_ymin','foto_xmin','foto_ymax','foto_xmax'
];

const EXTRACT_PROMPT = `Esta es una fotografía de una planilla de membresía manuscrita de la iglesia "Confraternidad Cristiana Nueva Jerusalén" (formato MEMBRESÍA). Lee cuidadosamente la letra a mano y extrae todos los campos.

Reglas:
- Si un campo está vacío o es ilegible, devuelve una cadena vacía "" (no inventes datos).
- Transcribe nombres propios con mayúscula inicial (ej: "Juan Carlos Ramos").
- La cédula (C.I.) solo con dígitos y puntos si los tiene.
- El teléfono tal como está escrito.
- "funcion" corresponde a la pregunta "¿Ejerce usted alguna función en la iglesia y desde cuándo?" — extrae solo el nombre de la función (ej: "Supervisora de Evangelismo"), sin la fecha.
- "foto_ymin", "foto_xmin", "foto_ymax", "foto_xmax": coordenadas del recuadro donde está la FOTOGRAFÍA del rostro de la persona pegada o impresa en la planilla, normalizadas de 0 a 1000 respecto a la imagen completa (ymin = borde superior, xmin = izquierdo, ymax = inferior, xmax = derecho), como cadenas numéricas (ej: "150"). Ajusta el recuadro solo a la fotografía, sin incluir texto alrededor. Si no hay fotografía, devuelve cadenas vacías en las cuatro.

Responde SOLO con un objeto JSON con exactamente estas claves (todas con valores de texto): ` + EXTRACT_KEYS.join(', ');

function limpiar(parsed) {
  const out = {};
  for (const k of EXTRACT_KEYS) {
    const v = parsed[k];
    out[k] = (typeof v === 'string') ? v : (v == null ? '' : String(v));
  }
  return out;
}

const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'];

async function conGemini(mime, b64) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: EXTRACT_PROMPT },
              { inline_data: { mime_type: mime, data: b64 } }
            ]}],
            generationConfig: { temperature: 0, response_mime_type: 'application/json' }
          })
        }
      );
      if (!res.ok) { lastErr = new Error('Gemini HTTP ' + res.status); continue; }
      const data = await res.json();
      let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (!text) { lastErr = new Error('Gemini sin respuesta'); continue; }
      text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      return limpiar(JSON.parse(text));
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Gemini no disponible');
}

const OPENROUTER_MODELS = ['google/gemini-3-flash-preview', 'google/gemini-2.5-flash', 'meta-llama/llama-4-scout'];

async function conOpenRouter(dataUrl) {
  let lastErr = null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'text', text: EXTRACT_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]}]
        })
      });
      if (!res.ok) { lastErr = new Error('OpenRouter HTTP ' + res.status); continue; }
      const data = await res.json();
      let text = data.choices?.[0]?.message?.content;
      if (!text) { lastErr = new Error('OpenRouter sin respuesta'); continue; }
      text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      return limpiar(JSON.parse(text));
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('OpenRouter no disponible');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    // Solo usuarios con sesión iniciada
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Inicia sesión para leer planillas' });
    const v = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: 'Bearer ' + token }
    });
    if (!v.ok) return res.status(401).json({ error: 'Sesión inválida. Vuelve a iniciar sesión.' });

    const { image } = req.body || {};
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Imagen inválida' });
    }
    const [meta, b64] = image.split(',');
    const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';

    let out;
    try {
      out = await conGemini(mime, b64);
    } catch (err) {
      if (!process.env.OPENROUTER_API_KEY) throw err;
      out = await conOpenRouter(image);
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo leer la planilla: ' + err.message });
  }
};
