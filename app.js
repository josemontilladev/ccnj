/* ============================================================
   Sistema de Membresía CFNJ
   - Base de datos local (IndexedDB)
   - Lectura de planillas con IA (API de Claude)
   - Generación de carnets (individual y masiva)
   ============================================================ */

'use strict';

/* ---------------- Ajustes (localStorage) ---------------- */
const DEFAULTS = {
  apiKey: '',        // Claude (opcional)
  geminiKey: '',     // Google Gemini (principal: gratuita y disponible en Venezuela)
  openrouterKey: '', // OpenRouter (respaldo si Gemini falla)
  groqKey: '',       // Groq (no disponible desde Venezuela sin VPN)
  modeloCarnet: 'clasico',
  carnetQR: true,
  anio: '2026',
  sede: 'Auditorio Canaima frente a la plaza Bolívar. Ciudad Ojeda, Estado Zulia - Venezuela',
  rif: 'J-310653135'
};

function loadSettings() {
  let s;
  try {
    s = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('cfnj_settings') || '{}')) };
  } catch { s = { ...DEFAULTS }; }
  // Claves preconfiguradas en datos.js
  const pre = window.PRECONFIG || {};
  if (!s.groqKey && pre.groqKey) s.groqKey = pre.groqKey;
  if (!s.geminiKey && pre.geminiKey) s.geminiKey = pre.geminiKey;
  if (!s.openrouterKey && pre.openrouterKey) s.openrouterKey = pre.openrouterKey;
  return s;
}

function hasAI() {
  // En la nube (publicado en Vercel) la lectura la hace el servidor /api/extract
  if (window.CONFIG_NUBE && location.protocol !== 'file:') return true;
  return !!(loadedKey());
}
function loadedKey() { return settings.apiKey || settings.geminiKey || settings.openrouterKey || settings.groqKey; }
function saveSettings(s) {
  localStorage.setItem('cfnj_settings', JSON.stringify(s));
}
let settings = loadSettings();

/* ---------------- Utilidades ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* Normaliza texto para búsquedas: minúsculas y sin acentos */
function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toast(msg, type = 'ok', ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* Vuelve a dibujar los iconos (Lucide) tras renderizar HTML dinámico */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* Redimensiona una imagen (File o dataURL) y devuelve dataURL JPEG */
function resizeImage(src, maxDim, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    if (src instanceof File) {
      const fr = new FileReader();
      fr.onload = () => { img.src = fr.result; };
      fr.onerror = reject;
      fr.readAsDataURL(src);
    } else {
      img.src = src;
    }
  });
}

/* ============================================================
   MODO NUBE (Supabase): base de datos compartida + inicio de sesión.
   Se activa cuando existe config-nube.js. Sin él, la app trabaja
   en modo local (IndexedDB), igual que siempre.
   ============================================================ */
const NUBE = window.CONFIG_NUBE || null;
const sb = (NUBE && window.supabase)
  ? window.supabase.createClient(NUBE.url, NUBE.anonKey)
  : null;

let SESION = null;
let APP_CARGADA = false;

/* Prepara un miembro con solo las columnas que existen en la tabla */
function miembroParaNube(member) {
  const rec = {};
  FIELD_KEYS.forEach(k => { rec[k] = member[k] ?? ''; });
  rec.foto = member.foto || null;
  rec.estado = member.estado || 'Activo';
  rec.renovado = member.renovado !== false;
  rec.seedKey = member.seedKey || null;
  rec.fechaRegistro = member.fechaRegistro || new Date().toISOString();
  if (member.id != null) rec.id = member.id;
  return rec;
}

/* ---------------- Base de datos (IndexedDB) ---------------- */
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cfnj_membresia', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('miembros')) {
        d.createObjectStore('miembros', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function dbAll() {
  if (sb) {
    const { data, error } = await sb.from('miembros').select('*');
    if (error) throw new Error(error.message);
    return data || [];
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('miembros', 'readonly');
    const req = tx.objectStore('miembros').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(member) {
  if (sb) {
    const { data, error } = await sb.from('miembros')
      .upsert(miembroParaNube(member))
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('miembros', 'readwrite');
    const req = tx.objectStore('miembros').put(member);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  if (sb) {
    const { error } = await sb.from('miembros').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('miembros', 'readwrite');
    const req = tx.objectStore('miembros').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let MEMBERS = []; // caché en memoria

async function refreshMembers() {
  MEMBERS = await dbAll();
  MEMBERS.sort((a, b) => (b.fechaRegistro || '').localeCompare(a.fechaRegistro || ''));
}

/* ---------------- Navegación ---------------- */
let ACTIVE_TAB = 'inicio';

function renderTab(name) {
  if (name === 'inicio') renderDashboard();
  if (name === 'miembros') renderMembersTable();
  if (name === 'carnets') renderCarnetList();
  if (name === 'registrar') $('#apiKeyWarning').classList.toggle('hidden', hasAI());
}

function goTab(name) {
  ACTIVE_TAB = name;
  $$('.tab').forEach(t => t.classList.remove('active'));
  $('#tab-' + name).classList.add('active');
  $$('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  renderTab(name);
  // En la nube: refresca los datos por si otra persona registró miembros
  if (sb && SESION) {
    refreshMembers()
      .then(() => { if (ACTIVE_TAB === name) renderTab(name); })
      .catch(() => {});
  }
}

$$('.nav-item[data-tab]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.tab)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.goto)));

/* ---------------- Panel de inicio ---------------- */
function renderDashboard() {
  $('#anioInicio').textContent = settings.anio;
  $('#statTotal').textContent = MEMBERS.length;
  $('#statFoto').textContent = MEMBERS.filter(m => m.foto).length;
  $('#statFuncion').textContent = MEMBERS.filter(m => (m.funcion || '').trim()).length;
  const now = new Date();
  $('#statMes').textContent = MEMBERS.filter(m => {
    if (!m.fechaRegistro) return false;
    const d = new Date(m.fechaRegistro);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const box = $('#recientes');
  if (!MEMBERS.length) {
    box.innerHTML = '<p class="empty-msg">Aún no hay miembros registrados. Comienza subiendo una planilla en <b>Registrar</b>.</p>';
    return;
  }
  box.innerHTML = MEMBERS.slice(0, 6).map(m => `
    <div class="recent-item" data-id="${m.id}" title="Ver ficha">
      <div class="avatar">${m.foto ? `<img src="${m.foto}" alt="">` : esc(initials(m.nombres))}</div>
      <div>
        <div class="recent-name">${esc(m.nombres)}</div>
        <div class="recent-sub">${esc(m.funcion || 'Miembro')} ${m.ci ? '· C.I. ' + esc(m.ci) : ''}</div>
      </div>
      <div class="recent-date">${fmtDate(m.fechaRegistro)}</div>
    </div>
  `).join('');
}

/* Clic en un registro reciente: abre la ficha */
$('#recientes').addEventListener('click', (e) => {
  const item = e.target.closest('.recent-item[data-id]');
  if (!item) return;
  const m = MEMBERS.find(x => x.id === Number(item.dataset.id));
  if (m) openViewModal(m);
});

/* ============================================================
   REGISTRAR — cola de planillas + IA + recorte de foto
   ============================================================ */
const FIELD_KEYS = ['nombres','ci','fechaNacimiento','lugarNacimiento','estadoCivil','correo','telefono',
  'direccion','ocupacion','profesion','esposo','hijos','padres','viveConPadres','viveConEsposoHijos',
  'recibioCristo','bautizo','tiempoConfraternidad','funcion'];

const EXTRACT_ALL_KEYS = [
  'nombres','ci','fecha_nacimiento','lugar_nacimiento','estado_civil','correo','telefono',
  'direccion','ocupacion','profesion','esposo','hijos','padres','vive_con_padres',
  'vive_con_esposo_hijos','recibio_cristo','bautizo','tiempo_confraternidad','funcion',
  // Recuadro de la foto de la persona (coordenadas normalizadas 0-1000)
  'foto_ymin','foto_xmin','foto_ymax','foto_xmax'
];

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(EXTRACT_ALL_KEYS.map(k => [k, { type: 'string' }])),
  required: EXTRACT_ALL_KEYS,
  additionalProperties: false
};

const SNAKE_TO_FORM = {
  nombres: 'nombres', ci: 'ci', fecha_nacimiento: 'fechaNacimiento', lugar_nacimiento: 'lugarNacimiento',
  estado_civil: 'estadoCivil', correo: 'correo', telefono: 'telefono', direccion: 'direccion',
  ocupacion: 'ocupacion', profesion: 'profesion', esposo: 'esposo', hijos: 'hijos', padres: 'padres',
  vive_con_padres: 'viveConPadres', vive_con_esposo_hijos: 'viveConEsposoHijos',
  recibio_cristo: 'recibioCristo', bautizo: 'bautizo', tiempo_confraternidad: 'tiempoConfraternidad',
  funcion: 'funcion'
};

const state = {
  queue: [],          // archivos pendientes
  planillaDataUrl: null, // imagen actual de la planilla (para recorte)
  fotoDataUrl: null,  // foto recortada / subida del miembro
  pendingBox: null    // recuadro de la foto detectado por la IA (coords 0-1000)
};

/* Convierte las coordenadas devueltas por la IA en un recuadro válido */
function boxFromExtracted(d) {
  const ys = parseFloat(d.foto_ymin), xs = parseFloat(d.foto_xmin);
  const ye = parseFloat(d.foto_ymax), xe = parseFloat(d.foto_xmax);
  if (![ys, xs, ye, xe].every(Number.isFinite)) return null;
  if (ye - ys < 15 || xe - xs < 15) return null; // demasiado pequeño para ser una foto
  return { ys, xs, ye, xe };
}

/* --- Lectura de la planilla con IA --- */
const EXTRACT_PROMPT = `Esta es una fotografía de una planilla de membresía manuscrita de la iglesia "Confraternidad Cristiana Nueva Jerusalén" (formato MEMBRESÍA). Lee cuidadosamente la letra a mano y extrae todos los campos.

Reglas:
- Si un campo está vacío o es ilegible, devuelve una cadena vacía "" (no inventes datos).
- Transcribe nombres propios con mayúscula inicial (ej: "Juan Carlos Ramos").
- La cédula (C.I.) solo con dígitos y puntos si los tiene.
- El teléfono tal como está escrito.
- "funcion" corresponde a la pregunta "¿Ejerce usted alguna función en la iglesia y desde cuándo?" — extrae solo el nombre de la función (ej: "Supervisora de Evangelismo"), sin la fecha.
- "foto_ymin", "foto_xmin", "foto_ymax", "foto_xmax": coordenadas del recuadro donde está la FOTOGRAFÍA del rostro de la persona pegada o impresa en la planilla, normalizadas de 0 a 1000 respecto a la imagen completa (ymin = borde superior, xmin = izquierdo, ymax = inferior, xmax = derecho), como cadenas numéricas (ej: "150"). Ajusta el recuadro solo a la fotografía, sin incluir texto alrededor. Si no hay fotografía, devuelve cadenas vacías en las cuatro.`;

async function extractFromImage(dataUrl) {
  // Publicado en la nube: el servidor lee la planilla (las claves no viajan al navegador)
  if (sb && location.protocol !== 'file:') {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + (session?.access_token || '')
      },
      body: JSON.stringify({ image: dataUrl })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || ('Error del servidor (' + res.status + ')'));
    }
    return cleanExtracted(await res.json());
  }

  // Orden de prioridad; si un proveedor falla, se intenta el siguiente
  const providers = [];
  if (settings.apiKey) providers.push(['Claude', extractWithClaude]);
  if (settings.geminiKey) providers.push(['Gemini', extractWithGemini]);
  if (settings.openrouterKey) providers.push(['OpenRouter', extractWithOpenRouter]);
  if (settings.groqKey) providers.push(['Groq', extractWithGroq]);
  if (!providers.length) throw new Error('No hay clave API configurada');

  let lastErr = null;
  for (const [name, fn] of providers) {
    try {
      return await fn(dataUrl);
    } catch (err) {
      console.warn(`Lectura con ${name} falló:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

/* Valores devueltos por la IA → objeto con todas las claves como texto */
function cleanExtracted(parsed) {
  const out = {};
  for (const k of Object.keys(EXTRACT_SCHEMA.properties)) {
    const v = parsed[k];
    out[k] = (typeof v === 'string') ? v : (v == null ? '' : String(v));
  }
  return out;
}

/* Google Gemini (principal: gratuita y disponible en Venezuela) */
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'];

async function extractWithGemini(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const keys = Object.keys(EXTRACT_SCHEMA.properties);
  let lastErr = null;

  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.geminiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: EXTRACT_PROMPT + '\n\nResponde SOLO con un objeto JSON con exactamente estas claves (todas con valores de texto): ' + keys.join(', ') },
                { inline_data: { mime_type: mime, data: b64 } }
              ]
            }],
            generationConfig: { temperature: 0, response_mime_type: 'application/json' }
          })
        }
      );
      if (!res.ok) {
        let msg = 'Error ' + res.status;
        try { msg = (await res.json()).error?.message || msg; } catch {}
        if (/API key not valid|API_KEY_INVALID/i.test(msg)) throw new Error('Clave de Gemini inválida. Revísala en Ajustes.');
        if (res.status === 429) throw new Error('Límite gratuito de Gemini alcanzado. Espera un minuto e intenta de nuevo.');
        lastErr = new Error(msg);
        continue; // prueba el siguiente modelo
      }
      const data = await res.json();
      let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (!text) throw new Error('La IA no devolvió datos. Intenta con una foto más clara.');
      text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      return cleanExtracted(JSON.parse(text));
    } catch (err) {
      if (err instanceof TypeError) throw new Error('Sin conexión a internet o Gemini no accesible desde esta red.');
      if (/inválida|Límite/.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw (lastErr || new Error('No se pudo leer la planilla'));
}

/* OpenRouter (respaldo) — API compatible con OpenAI, funciona desde Venezuela */
const OPENROUTER_MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash',
  'meta-llama/llama-4-scout'
];

async function extractWithOpenRouter(dataUrl) {
  const keys = Object.keys(EXTRACT_SCHEMA.properties);
  let lastErr = null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + settings.openrouterKey
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT + '\n\nResponde SOLO con un objeto JSON con exactamente estas claves (todas con valores de texto): ' + keys.join(', ') },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }]
        })
      });
      if (!res.ok) {
        let msg = 'Error ' + res.status;
        try { msg = (await res.json()).error?.message || msg; } catch {}
        if (res.status === 401) throw new Error('Clave de OpenRouter inválida. Revísala en Ajustes.');
        if (res.status === 402) throw new Error('Sin crédito en OpenRouter. Revisa tu cuenta en openrouter.ai.');
        if (res.status === 429) throw new Error('Límite de OpenRouter alcanzado. Espera un momento.');
        lastErr = new Error(msg);
        continue;
      }
      const data = await res.json();
      let text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('La IA no devolvió datos');
      text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      return cleanExtracted(JSON.parse(text));
    } catch (err) {
      if (err instanceof TypeError) throw new Error('Sin conexión con OpenRouter.');
      if (/inválida|crédito|Límite/.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw (lastErr || new Error('No se pudo leer la planilla'));
}

/* Groq (gratuita) — modelos Llama 4 con visión, API compatible con OpenAI */
const GROQ_MODELS = [
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct'
];

async function extractWithGroq(dataUrl) {
  const keys = Object.keys(EXTRACT_SCHEMA.properties);
  let lastErr = null;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + settings.groqKey
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT + '\n\nResponde SOLO con un objeto JSON con exactamente estas claves (todas con valores de texto): ' + keys.join(', ') },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }]
        })
      });
      if (!res.ok) {
        let msg = 'Error ' + res.status;
        try { msg = (await res.json()).error?.message || msg; } catch {}
        if (res.status === 401) throw new Error('Clave de Groq inválida. Revísala en Ajustes.');
        if (res.status === 403) throw new Error('Groq no está disponible desde tu red (bloqueado por región). Configura una clave gratuita de Google Gemini en Ajustes.');
        if (res.status === 429) throw new Error('Límite de uso de Groq alcanzado. Espera un momento.');
        lastErr = new Error(msg);
        continue; // prueba el siguiente modelo (p. ej. si el modelo fue retirado)
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('La IA no devolvió datos');
      return cleanExtracted(JSON.parse(text));
    } catch (err) {
      // "Failed to fetch": bloqueo regional de Groq o sin internet
      if (err instanceof TypeError) throw new Error('Groq no está disponible desde tu red (bloqueado por región). Configura una clave gratuita de Google Gemini en Ajustes.');
      if (/inválida|Límite|Gemini/.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw (lastErr || new Error('No se pudo leer la planilla'));
}

/* Claude (opcional, mayor precisión con letra difícil) */
async function extractWithClaude(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';

  const body = {
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: EXTRACT_PROMPT }
      ]
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let msg = 'Error ' + res.status;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    if (res.status === 401) msg = 'Clave API inválida. Revísala en Ajustes.';
    if (res.status === 429) msg = 'Límite de uso alcanzado. Espera un momento e intenta de nuevo.';
    throw new Error(msg);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('La IA no devolvió datos. Intenta con una foto más clara.');
  return JSON.parse(textBlock.text);
}

/* --- Subida de archivos --- */
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault(); dropzone.classList.remove('drag');
  addToQueue([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
});
fileInput.addEventListener('change', () => {
  addToQueue([...fileInput.files]);
  fileInput.value = '';
});

function addToQueue(files) {
  if (!files.length) return;
  state.queue.push(...files);
  // Solo arranca el procesamiento si no hay una planilla en revisión
  if (!$('#stepUpload').classList.contains('hidden')) {
    // Varias planillas + IA disponible: creación automática en lote.
    // Una sola: flujo de revisión manual.
    if (state.queue.length > 1 && hasAI()) runBatch();
    else processNext();
  } else {
    updateQueueInfo();
    toast(`${files.length} planilla(s) añadidas a la cola`);
  }
}

function showStep(step) {
  ['upload', 'batch', 'processing', 'review'].forEach(s => {
    const el = $('#step' + s[0].toUpperCase() + s.slice(1));
    if (el) el.classList.toggle('hidden', s !== step);
  });
}

/* ============ MODO LOTE: crea los miembros automáticamente ============ */

function memberFromExtracted(extracted) {
  const member = { fechaRegistro: new Date().toISOString(), estado: 'Activo' };
  FIELD_KEYS.forEach(k => { member[k] = ''; });
  for (const [snake, campo] of Object.entries(SNAKE_TO_FORM)) {
    if (typeof extracted[snake] === 'string') member[campo] = extracted[snake].trim();
  }
  return member;
}

/* Recorta la foto de la persona a partir del recuadro detectado por la IA */
function cropPhotoFromBox(dataUrl, box) {
  return new Promise((resolve) => {
    if (!box) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const pad = -0.01; // encoge un poco el recuadro para no incluir papel alrededor
      const x1 = Math.max(0, (box.xs / 1000 - pad) * img.width);
      const y1 = Math.max(0, (box.ys / 1000 - pad) * img.height);
      const x2 = Math.min(img.width, (box.xe / 1000 + pad) * img.width);
      const y2 = Math.min(img.height, (box.ye / 1000 + pad) * img.height);
      if (x2 - x1 < 15 || y2 - y1 < 15) return resolve(null);
      const out = document.createElement('canvas');
      const targetW = 480;
      out.width = targetW;
      out.height = Math.round((y2 - y1) * targetW / (x2 - x1));
      out.getContext('2d').drawImage(img, x1, y1, x2 - x1, y2 - y1, 0, 0, out.width, out.height);
      resolve(out.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function addBatchLog(tipo, texto) {
  const div = document.createElement('div');
  div.className = 'batch-line ' + tipo;
  div.textContent = texto;
  $('#batchLog').appendChild(div);
  $('#batchLog').scrollTop = $('#batchLog').scrollHeight;
}

async function runBatch() {
  const total = state.queue.length;
  const failed = [];
  const createdIds = [];
  let done = 0, saved = 0, skipped = 0;

  showStep('batch');
  $('#batchTitle').textContent = 'Procesando planillas…';
  $('#batchLog').innerHTML = '';
  $('#batchActions').classList.add('hidden');
  updateQueueInfo();

  while (state.queue.length) {
    const file = state.queue.shift();
    done++;
    $('#batchBarFill').style.width = Math.round((done - 1) / total * 100) + '%';
    $('#batchStatus').textContent = `Leyendo ${done} de ${total}: ${file.name}`;
    try {
      const dataUrl = await resizeImage(file, 2000, 0.9);
      const extracted = await extractFromImage(dataUrl);
      const member = memberFromExtracted(extracted);
      if (!member.nombres) throw new Error('no se pudo leer el nombre');

      // Omite duplicados por cédula
      const ciDigits = member.ci.replace(/\D/g, '');
      if (ciDigits && MEMBERS.some(x => (x.ci || '').replace(/\D/g, '') === ciDigits)) {
        skipped++;
        addBatchLog('warn', `${member.nombres} ya existe (C.I. ${member.ci}) — omitida`);
        continue;
      }

      member.foto = await cropPhotoFromBox(dataUrl, boxFromExtracted(extracted));
      const newId = await dbPut(member);
      createdIds.push(newId);
      await refreshMembers();
      saved++;
      addBatchLog('ok', `${member.nombres}${member.foto ? '' : ' (sin foto detectada)'}`);
    } catch (err) {
      failed.push(file);
      addBatchLog('err', `${file.name}: ${err.message}`);
    }
    $('#batchBarFill').style.width = Math.round(done / total * 100) + '%';
  }

  renderDashboard();
  $('#batchTitle').textContent = 'Lote completado';
  $('#batchStatus').textContent =
    `${saved} miembro(s) creados` +
    (skipped ? ` · ${skipped} duplicado(s) omitidos` : '') +
    (failed.length ? ` · ${failed.length} con error (puedes revisarlas manualmente)` : '');
  $('#batchActions').classList.remove('hidden');
  $('#btnBatchReviewFailed').classList.toggle('hidden', !failed.length);
  const btnCarnets = $('#btnBatchCarnets');
  btnCarnets.classList.toggle('hidden', !createdIds.length);
  btnCarnets.dataset.ids = createdIds.join(',');
  btnCarnets.innerHTML = `<i data-lucide="id-card"></i> Generar carnets (${createdIds.length})`;
  state.queue.push(...failed);
  refreshIcons();
  if (saved) toast(`${saved} miembro(s) creados en lote`);
}

/* Salta a Carnets con los miembros recién creados ya seleccionados */
$('#btnBatchCarnets').addEventListener('click', (e) => {
  const ids = (e.currentTarget.dataset.ids || '').split(',').map(Number).filter(Boolean);
  selectedIds.clear();
  ids.forEach(id => selectedIds.add(id));
  state.queue.length = 0;
  showStep('upload');
  updateQueueInfo();
  goTab('carnets');
});

$('#btnBatchDone').addEventListener('click', () => {
  state.queue.length = 0;
  showStep('upload');
  updateQueueInfo();
  goTab('miembros');
});

$('#btnBatchReviewFailed').addEventListener('click', () => {
  if (state.queue.length) processNext();
  else showStep('upload');
});

function updateQueueInfo() {
  const q = $('#queueInfo');
  if (state.queue.length > 0) {
    q.textContent = `${state.queue.length} planilla(s) en cola`;
    q.classList.remove('hidden');
  } else {
    q.classList.add('hidden');
  }
}

async function processNext() {
  updateQueueInfo();
  if (!state.queue.length) { showStep('upload'); return; }

  const file = state.queue.shift();
  updateQueueInfo();
  state.fotoDataUrl = null;
  state.pendingBox = null;
  renderPhotoPreview();

  // Imagen a resolución alta para el recorte y la IA
  const dataUrl = await resizeImage(file, 2000, 0.9);
  state.planillaDataUrl = dataUrl;

  if (hasAI()) {
    showStep('processing');
    try {
      const extracted = await extractFromImage(dataUrl);
      fillForm(extracted);
      state.pendingBox = boxFromExtracted(extracted); // foto detectada por la IA
      $('#reviewTitle').textContent = 'Verifica los datos extraídos';
    } catch (err) {
      toast('No se pudo leer la planilla: ' + err.message, 'err', 6000);
      fillForm({});
      $('#reviewTitle').textContent = 'Llena los datos manualmente';
    }
  } else {
    fillForm({});
    $('#reviewTitle').textContent = 'Llena los datos (sin IA configurada)';
  }

  showStep('review');
  setupCropCanvas(dataUrl);
}

/* Registro manual sin planilla */
$('#btnManual').addEventListener('click', () => {
  state.planillaDataUrl = null;
  state.fotoDataUrl = null;
  renderPhotoPreview();
  fillForm({});
  $('#reviewTitle').textContent = 'Registro manual';
  showStep('review');
  clearCropCanvas();
});

function fillForm(data) {
  const form = $('#memberForm');
  form.reset();
  for (const [snake, formName] of Object.entries(SNAKE_TO_FORM)) {
    if (data[snake] !== undefined && form.elements[formName]) {
      form.elements[formName].value = data[snake];
    }
  }
}

/* --- Lienzo de recorte de foto --- */
const cropCanvas = $('#cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
let cropImg = null;
let sel = null;       // {x,y,w,h} en coords del canvas
let dragging = false;

function clearCropCanvas() {
  cropImg = null; sel = null;
  cropCanvas.width = 10; cropCanvas.height = 10;
  $('#btnCrop').disabled = true;
  $('#cropHint').textContent = 'No hay planilla cargada. Puedes subir una foto aparte para el carnet.';
  $('.crop-wrap').style.display = 'none';
}

function setupCropCanvas(dataUrl) {
  $('.crop-wrap').style.display = '';
  $('#cropHint').textContent = 'Dibuja un recuadro sobre la foto de la persona para recortarla, o sube una foto aparte.';
  const img = new Image();
  img.onload = () => {
    cropImg = img;
    cropCanvas.width = img.width;
    cropCanvas.height = img.height;
    sel = null;
    $('#btnCrop').disabled = true;

    // Si la IA detectó la foto de la persona, recórtala automáticamente
    if (state.pendingBox) {
      const b = state.pendingBox;
      const pad = -0.01; // encoge un poco el recuadro para no incluir papel alrededor
      const x1 = Math.max(0, (b.xs / 1000 - pad) * img.width);
      const y1 = Math.max(0, (b.ys / 1000 - pad) * img.height);
      const x2 = Math.min(img.width, (b.xe / 1000 + pad) * img.width);
      const y2 = Math.min(img.height, (b.ye / 1000 + pad) * img.height);
      sel = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      state.pendingBox = null;
      if (cropSelection()) {
        $('#btnCrop').disabled = false;
        $('#cropHint').textContent = 'La foto se recortó automáticamente. Si no quedó bien, dibuja tú el recuadro y pulsa "Recortar selección".';
        toast('Foto recortada automáticamente');
      }
    }
    drawCrop();
  };
  img.src = dataUrl;
}

/* Recorta la selección actual y la usa como foto del miembro */
function cropSelection() {
  if (!cropImg || !sel || sel.w < 15 || sel.h < 15) return false;
  const out = document.createElement('canvas');
  const targetW = 480;
  const scale = targetW / sel.w;
  out.width = targetW;
  out.height = Math.round(sel.h * scale);
  out.getContext('2d').drawImage(cropImg, sel.x, sel.y, sel.w, sel.h, 0, 0, out.width, out.height);
  state.fotoDataUrl = out.toDataURL('image/jpeg', 0.9);
  renderPhotoPreview();
  return true;
}

function drawCrop() {
  if (!cropImg) return;
  cropCtx.drawImage(cropImg, 0, 0);
  if (sel && sel.w && sel.h) {
    cropCtx.save();
    cropCtx.fillStyle = 'rgba(0,20,60,.45)';
    // Oscurece todo menos la selección
    cropCtx.beginPath();
    cropCtx.rect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.rect(sel.x, sel.y, sel.w, sel.h);
    cropCtx.fill('evenodd');
    cropCtx.strokeStyle = '#feeb01';
    cropCtx.lineWidth = Math.max(3, cropCanvas.width / 300);
    cropCtx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    cropCtx.restore();
  }
}

function canvasPos(e) {
  const r = cropCanvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX);
  const cy = (e.touches ? e.touches[0].clientY : e.clientY);
  return {
    x: (cx - r.left) * (cropCanvas.width / r.width),
    y: (cy - r.top) * (cropCanvas.height / r.height)
  };
}

function cropStart(e) {
  if (!cropImg) return;
  e.preventDefault();
  const p = canvasPos(e);
  sel = { x: p.x, y: p.y, w: 0, h: 0, ox: p.x, oy: p.y };
  dragging = true;
}
function cropMove(e) {
  if (!dragging || !sel) return;
  e.preventDefault();
  const p = canvasPos(e);
  sel.x = Math.min(p.x, sel.ox);
  sel.y = Math.min(p.y, sel.oy);
  sel.w = Math.abs(p.x - sel.ox);
  sel.h = Math.abs(p.y - sel.oy);
  drawCrop();
}
function cropEnd() {
  if (!dragging) return;
  dragging = false;
  $('#btnCrop').disabled = !(sel && sel.w > 15 && sel.h > 15);
}

cropCanvas.addEventListener('mousedown', cropStart);
cropCanvas.addEventListener('mousemove', cropMove);
window.addEventListener('mouseup', cropEnd);
cropCanvas.addEventListener('touchstart', cropStart, { passive: false });
cropCanvas.addEventListener('touchmove', cropMove, { passive: false });
window.addEventListener('touchend', cropEnd);

$('#btnCrop').addEventListener('click', () => {
  if (cropSelection()) toast('Foto recortada');
});

$('#photoFileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.fotoDataUrl = await resizeImage(f, 600, 0.9);
  renderPhotoPreview();
  e.target.value = '';
});

function renderPhotoPreview() {
  const box = $('#photoPreview');
  if (state.fotoDataUrl) {
    box.innerHTML = `<img src="${state.fotoDataUrl}" alt="">`;
    box.classList.add('has-photo');
  } else {
    box.innerHTML = '<span>Sin foto</span>';
    box.classList.remove('has-photo');
  }
}

/* --- Guardar miembro --- */
let savingMember = false; // evita registros duplicados por doble clic

$('#memberForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (savingMember) return;

  const form = e.target;
  const member = { fechaRegistro: new Date().toISOString(), estado: 'Activo' };
  FIELD_KEYS.forEach(k => { member[k] = (form.elements[k]?.value || '').trim(); });
  member.foto = state.fotoDataUrl || null;

  if (!member.nombres) { toast('El nombre es obligatorio', 'err'); return; }

  // Aviso si ya existe un miembro con la misma cédula
  const ciDigits = member.ci.replace(/\D/g, '');
  if (ciDigits && MEMBERS.some(x => (x.ci || '').replace(/\D/g, '') === ciDigits)) {
    if (!confirm(`Ya existe un miembro con la cédula ${member.ci}. ¿Guardar de todas formas?`)) return;
  }

  savingMember = true;
  const btn = $('#btnSaveMember');
  btn.disabled = true;
  try {
    await dbPut(member);
    await refreshMembers();
    toast(`${member.nombres} guardado en la base de datos`);
    renderDashboard();

    if (state.queue.length) {
      processNext();
    } else {
      showStep('upload');
    }
  } catch (err) {
    toast('No se pudo guardar: ' + err.message, 'err');
  } finally {
    savingMember = false;
    btn.disabled = false;
  }
});

$('#btnCancelReview').addEventListener('click', () => {
  if (state.queue.length) processNext();
  else showStep('upload');
});

/* ============================================================
   MIEMBROS — tabla, búsqueda, edición, respaldo
   ============================================================ */
function memberMatches(m, q) {
  if (!q) return true;
  const hay = norm([m.nombres, m.ci, m.telefono, m.funcion, m.correo, m.direccion].join(' '));
  return hay.includes(norm(q));
}

function estadoFilterMatch(m, filtro) {
  if (filtro === 'activos') return (m.estado || 'Activo') !== 'Inactivo';
  if (filtro === 'inactivos') return m.estado === 'Inactivo';
  if (filtro === 'porRenovar') return m.renovado === false;
  return true;
}

function renderMembersTable() {
  const q = $('#searchInput').value.trim();
  const filtro = $('#filterEstado').value;
  const rows = MEMBERS.filter(m => memberMatches(m, q) && estadoFilterMatch(m, filtro));
  const tbody = $('#membersTbody');
  $('#memberCount').textContent = (q || filtro !== 'todos')
    ? `${rows.length} de ${MEMBERS.length} miembros`
    : `${MEMBERS.length} miembro${MEMBERS.length === 1 ? '' : 's'}`;
  $('#membersEmpty').classList.toggle('hidden', rows.length > 0);
  tbody.innerHTML = rows.map(m => `
    <tr data-id="${m.id}" class="${m.estado === 'Inactivo' ? 'row-inactivo' : ''}">
      <td><div class="avatar">${m.foto ? `<img src="${m.foto}" alt="">` : esc(initials(m.nombres))}</div></td>
      <td class="td-name">${esc(m.nombres)}</td>
      <td>${esc(m.ci || '—')}</td>
      <td>${esc(m.telefono || '—')}</td>
      <td>${m.funcion ? `<span class="badge">${esc(m.funcion)}</span>` : '<span class="badge badge-empty">Miembro</span>'}</td>
      <td>
        ${m.estado === 'Inactivo'
          ? '<span class="badge badge-inactivo">Inactivo</span>'
          : '<span class="badge badge-activo">Activo</span>'}
        ${m.renovado === false
          ? '<button class="badge-renovar" data-act="renovar" title="Clic cuando la persona renueve">Por renovar</button>'
          : ''}
      </td>
      <td>${fmtDate(m.fechaRegistro)}</td>
      <td class="td-actions">
        <button class="icon-btn" title="Descargar carnet" data-act="carnet"><i data-lucide="id-card"></i></button>
        <button class="icon-btn" title="Editar" data-act="edit"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" title="Eliminar" data-act="del"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>
  `).join('');
  refreshIcons();
}

$('#searchInput').addEventListener('input', renderMembersTable);
$('#filterEstado').addEventListener('change', renderMembersTable);

$('#membersTbody').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  const m = MEMBERS.find(x => x.id === id);
  if (!m) return;

  const btn = e.target.closest('button[data-act]');
  if (!btn) {
    // Clic en cualquier parte de la fila: abre la ficha completa
    openViewModal(m);
    return;
  }

  if (btn.dataset.act === 'renovar') {
    m.renovado = true;
    await dbPut(m);
    await refreshMembers();
    renderMembersTable();
    toast(`${m.nombres}: renovación registrada`);
    return;
  }

  if (btn.dataset.act === 'del') {
    if (confirm(`¿Eliminar a ${m.nombres} de la base de datos?`)) {
      await dbDelete(id);
      await refreshMembers();
      renderMembersTable();
      renderDashboard();
      toast('Miembro eliminado');
    }
  } else if (btn.dataset.act === 'edit') {
    openEditModal(m);
  } else if (btn.dataset.act === 'carnet') {
    await downloadCarnetPNG([m]);
  }
});

/* --- Ficha del miembro (vista rápida) --- */
let viewingId = null;

const VIEW_FIELDS = [
  ['ci', 'C.I.'], ['telefono', 'Teléfono'], ['fechaNacimiento', 'Fecha de nacimiento'],
  ['lugarNacimiento', 'Lugar de nacimiento'], ['estadoCivil', 'Estado civil'], ['correo', 'Correo'],
  ['direccion', 'Dirección'], ['ocupacion', 'Ocupación'], ['profesion', 'Profesión'],
  ['esposo', 'Esposo(a)'], ['hijos', 'Hijos(as)'], ['padres', 'Padres'],
  ['viveConPadres', '¿Vive con sus padres?'], ['viveConEsposoHijos', '¿Vive con esposo(a) e hijos?'],
  ['recibioCristo', 'Recibió al Señor'], ['bautizo', 'Bautizo'],
  ['tiempoConfraternidad', 'Tiempo en la Confraternidad']
];

function openViewModal(m) {
  viewingId = m.id;
  const foto = m.foto
    ? `<img src="${m.foto}" alt="">`
    : `<span>${esc(initials(m.nombres))}</span>`;
  const items = VIEW_FIELDS.map(([key, label]) => `
    <div class="detail-item">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${esc(m[key] || '—')}</span>
    </div>`).join('');
  $('#viewBody').innerHTML = `
    <div class="view-layout">
      <div class="view-left">
        <div class="view-header">
          <div class="view-photo">${foto}</div>
          <div>
            <div class="view-name">${esc(m.nombres)}</div>
            <div class="view-funcion">${m.funcion
              ? `<span class="badge">${esc(m.funcion)}</span>`
              : '<span class="badge badge-empty">Miembro</span>'}
            </div>
            <div class="view-date">Registrado: ${fmtDate(m.fechaRegistro)}</div>
          </div>
        </div>
        <div class="detail-grid">${items}</div>
      </div>
      <div class="view-carnet">${carnetHTML(m)}</div>
    </div>`;
  $('#viewModal').classList.remove('hidden');
  refreshIcons();
}

$('#btnViewEdit').addEventListener('click', () => {
  const m = MEMBERS.find(x => x.id === viewingId);
  if (!m) return;
  $('#viewModal').classList.add('hidden');
  openEditModal(m);
});

$('#btnViewCarnet').addEventListener('click', async () => {
  const m = MEMBERS.find(x => x.id === viewingId);
  if (m) await downloadCarnetPNG([m]);
});

$('#btnViewWhatsApp').addEventListener('click', async () => {
  const m = MEMBERS.find(x => x.id === viewingId);
  if (m) await enviarWhatsApp(m);
});

/* --- Modal de edición --- */
let editingId = null;
let editPhoto = null;

function openEditModal(m) {
  editingId = m.id;
  editPhoto = m.foto || null;
  const form = $('#editForm');
  form.reset();
  FIELD_KEYS.forEach(k => { if (form.elements[k]) form.elements[k].value = m[k] || ''; });
  form.elements.estado.value = m.estado === 'Inactivo' ? 'Inactivo' : 'Activo';
  const pv = $('#editPhotoPreview');
  pv.innerHTML = editPhoto ? `<img src="${editPhoto}" alt="">` : '<span>Sin foto</span>';
  pv.classList.toggle('has-photo', !!editPhoto);
  $('#editModal').classList.remove('hidden');
}

$('#editPhotoInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  editPhoto = await resizeImage(f, 600, 0.9);
  $('#editPhotoPreview').innerHTML = `<img src="${editPhoto}" alt="">`;
  e.target.value = '';
});

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = MEMBERS.find(x => x.id === editingId);
  if (!m) return;
  const form = e.target;
  FIELD_KEYS.forEach(k => { if (form.elements[k]) m[k] = form.elements[k].value.trim(); });
  m.estado = form.elements.estado.value;
  m.foto = editPhoto;
  await dbPut(m);
  await refreshMembers();
  renderMembersTable();
  renderDashboard();
  $('#editModal').classList.add('hidden');
  toast('✔ Cambios guardados');
});

/* --- Respaldo / restauración / CSV --- */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#btnExportJSON').addEventListener('click', () => {
  downloadFile(`respaldo_membresia_cfnj_${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify({ version: 1, miembros: MEMBERS }, null, 2), 'application/json');
  localStorage.setItem('cfnj_lastBackup', String(Date.now()));
  $('#backupBanner').classList.add('hidden');
  toast('Respaldo descargado');
});

$('#btnImportJSON').addEventListener('click', () => $('#importFileInput').click());
$('#importFileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = data.miembros || data;
    if (!Array.isArray(list)) throw new Error('Formato inválido');
    for (const m of list) {
      delete m.id; // evitar choques de id
      await dbPut(m);
    }
    await refreshMembers();
    renderMembersTable();
    renderDashboard();
    toast(`${list.length} miembro(s) restaurados`);
  } catch (err) {
    toast('No se pudo restaurar: ' + err.message, 'err');
  }
  e.target.value = '';
});

$('#btnExportCSV').addEventListener('click', () => {
  const headers = ['Nombres y apellidos','C.I.','Teléfono','Fecha de nacimiento','Lugar de nacimiento',
    'Estado civil','Correo','Dirección','Ocupación','Profesión','Esposo(a)','Hijos','Padres',
    'Vive con padres','Vive con esposo/hijos','Recibió a Cristo','Bautizo','Tiempo en la Confraternidad',
    'Función','Fecha de registro'];
  const cols = ['nombres','ci','telefono','fechaNacimiento','lugarNacimiento','estadoCivil','correo',
    'direccion','ocupacion','profesion','esposo','hijos','padres','viveConPadres','viveConEsposoHijos',
    'recibioCristo','bautizo','tiempoConfraternidad','funcion'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const BOM = '﻿'; // para que Excel abra bien los acentos
  const lines = [headers.map(q).join(';')];
  for (const m of MEMBERS) {
    lines.push([...cols.map(c => q(m[c])), q(fmtDate(m.fechaRegistro))].join(';'));
  }
  // BOM para que Excel abra bien los acentos
  downloadFile(`membresia_cfnj_${settings.anio}.csv`, BOM + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV descargado');
});

/* ============================================================
   CARNETS — vista previa, PNG y PDF masivo
   ============================================================ */
const selectedIds = new Set();

/* QR de verificación: al escanearlo muestra los datos del miembro */
function memberQRDataUrl(m) {
  if (!window.qrcode) return '';
  try {
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }
    const texto =
      'CONFRATERNIDAD CRISTIANA NUEVA JERUSALEN\n' +
      'Miembro: ' + (m.nombres || '') + '\n' +
      'C.I.: ' + (m.ci || '-') + '\n' +
      'Funcion: ' + (m.funcion || 'Miembro') + '\n' +
      'Membresia ' + settings.anio + ' - ' + ((m.estado || 'Activo').toUpperCase()) + '\n' +
      'RIF ' + settings.rif;
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr.createDataURL(4, 2);
  } catch { return ''; }
}

/* ---- Piezas comunes de todos los modelos de carnet ---- */
function carnetParts(m) {
  const qrUrl = (settings.carnetQR !== false) ? memberQRDataUrl(m) : '';
  return {
    // Logo incrustado en base64: necesario para poder exportar el carnet a PNG
    logoSrc: (window.ASSETS && window.ASSETS.logo) || 'logo.png',
    name: esc(m.nombres || ''),
    nameClass: (m.nombres || '').length > 26 ? 'c-name small' : 'c-name',
    fotoHTML: m.foto
      ? `<img class="c-photo" src="${m.foto}" alt="">`
      : `<div class="c-photo placeholder">${esc(initials(m.nombres))}</div>`,
    ciHTML: m.ci ? `<div class="c-ci">C.I. ${esc(m.ci)}</div>` : '',
    funcion: esc(m.funcion || 'Miembro Activo'),
    qrHTML: qrUrl ? `<img class="c-qr" src="${qrUrl}" alt="">` : '',
    anio: esc(settings.anio),
    sede: esc(settings.sede),
    rif: esc(settings.rif)
  };
}

/* Modelo 1 — Clásico: blanco con franja tricolor y banda azul */
function carnetClasico(m) {
  const p = carnetParts(m);
  return `
  <div class="carnet">
    <div class="tri"><i class="t-az"></i><i class="t-ve"></i><i class="t-am"></i></div>
    <img class="c-logo" src="${p.logoSrc}" alt="">
    <div class="c-rif">RIF ${p.rif}</div>
    ${p.fotoHTML}
    <div class="${p.nameClass}">${p.name}</div>
    ${p.ciHTML}
    <div class="c-funcion">${p.funcion}</div>
    ${p.qrHTML}
    <div class="c-band">
      <div class="c-anio">MEMBRESÍA ${p.anio}</div>
      <div class="c-sede">${p.sede}</div>
    </div>
  </div>`;
}

/* Modelo 2 — Azul: cabecera azul con el logo en placa blanca y foto superpuesta */
function carnetAzul(m) {
  const p = carnetParts(m);
  return `
  <div class="carnet m-azul">
    <div class="c-cab">
      <div class="c-placa"><img src="${p.logoSrc}" alt=""></div>
      <div class="c-anio2">MEMBRESÍA ${p.anio}</div>
      <div class="c-rif2">RIF ${p.rif}</div>
    </div>
    ${p.fotoHTML}
    <div class="${p.nameClass}">${p.name}</div>
    ${p.ciHTML}
    <div class="c-funcion">${p.funcion}</div>
    ${p.qrHTML}
    <div class="c-pie">${p.sede}</div>
    <div class="tri tri-bottom"><i class="t-az"></i><i class="t-ve"></i><i class="t-am"></i></div>
  </div>`;
}

/* Modelo 3 — Franja: banda lateral azul→verde con el año en vertical */
function carnetFranja(m) {
  const p = carnetParts(m);
  return `
  <div class="carnet m-franja">
    <div class="c-lat"><span>MEMBRESÍA ${p.anio}</span></div>
    <div class="c-cuerpo">
      <img class="c-logo" src="${p.logoSrc}" alt="">
      <div class="c-rif">RIF ${p.rif}</div>
      ${p.fotoHTML}
      <div class="${p.nameClass}">${p.name}</div>
      ${p.ciHTML}
      <div class="c-funcion">${p.funcion}</div>
    ${p.qrHTML}
      <div class="c-pie2">${p.sede}</div>
    </div>
  </div>`;
}

/* Modelo 4 — Elegante: fondo azul oscuro con acentos amarillos */
function carnetOscuro(m) {
  const p = carnetParts(m);
  return `
  <div class="carnet m-oscuro">
    <div class="tri"><i class="t-az"></i><i class="t-ve"></i><i class="t-am"></i></div>
    <div class="c-placa"><img src="${p.logoSrc}" alt=""></div>
    <div class="c-rif">RIF ${p.rif}</div>
    ${p.fotoHTML}
    <div class="${p.nameClass}">${p.name}</div>
    ${p.ciHTML}
    <div class="c-funcion">${p.funcion}</div>
    ${p.qrHTML}
    <div class="c-band">
      <div class="c-anio">MEMBRESÍA ${p.anio}</div>
      <div class="c-sede">${p.sede}</div>
    </div>
  </div>`;
}

const CARNET_MODELOS = {
  clasico: { nombre: 'Clásico', fn: carnetClasico },
  azul: { nombre: 'Azul', fn: carnetAzul },
  franja: { nombre: 'Franja', fn: carnetFranja },
  oscuro: { nombre: 'Elegante', fn: carnetOscuro }
};

function carnetHTML(m) {
  const modelo = CARNET_MODELOS[settings.modeloCarnet] || CARNET_MODELOS.clasico;
  return modelo.fn(m);
}

function renderCarnetList() {
  const box = $('#carnetMemberList');
  if (!MEMBERS.length) {
    box.innerHTML = '<p class="empty-msg">No hay miembros registrados todavía.</p>';
    updateCarnetButtons();
    return;
  }
  const q = $('#carnetSearch').value.trim();
  const lista = MEMBERS.filter(m => memberMatches(m, q));
  if (!lista.length) {
    box.innerHTML = '<p class="empty-msg">Ningún miembro coincide con el filtro.</p>';
    renderCarnetPreview();
    updateCarnetButtons();
    return;
  }
  box.innerHTML = lista.map(m => `
    <label class="cm-item ${m.foto ? '' : 'no-photo'}" data-id="${m.id}">
      <input type="checkbox" ${selectedIds.has(m.id) ? 'checked' : ''}>
      <div class="avatar">${m.foto ? `<img src="${m.foto}" alt="">` : esc(initials(m.nombres))}</div>
      <div>
        <div class="cm-name">${esc(m.nombres)}</div>
        <div class="cm-sub">${esc(m.funcion || 'Miembro')} ${m.ci ? '· C.I. ' + esc(m.ci) : ''}</div>
      </div>
    </label>
  `).join('');
  renderCarnetPreview();
  updateCarnetButtons();
}

$('#carnetMemberList').addEventListener('change', (e) => {
  const item = e.target.closest('.cm-item');
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
  $('#checkAll').checked = selectedIds.size === MEMBERS.length && MEMBERS.length > 0;
  renderCarnetPreview();
  updateCarnetButtons();
});

$('#checkAll').addEventListener('change', (e) => {
  // Aplica sobre la lista filtrada (si hay filtro activo)
  const q = $('#carnetSearch').value.trim();
  const lista = MEMBERS.filter(m => memberMatches(m, q));
  if (e.target.checked) lista.forEach(m => selectedIds.add(m.id));
  else lista.forEach(m => selectedIds.delete(m.id));
  renderCarnetList();
});

$('#carnetSearch').addEventListener('input', renderCarnetList);

/* Interruptor del QR de verificación */
$('#checkQR').addEventListener('change', (e) => {
  settings.carnetQR = e.target.checked;
  saveSettings(settings);
  renderCarnetPreview();
});

function selectedMembers() {
  return MEMBERS.filter(m => selectedIds.has(m.id));
}

/* Selector de modelo de carnet */
function updateModeloPicker() {
  $$('#modeloPicker .modelo-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.modelo === (settings.modeloCarnet || 'clasico')));
}

$('#modeloPicker').addEventListener('click', (e) => {
  const btn = e.target.closest('.modelo-btn');
  if (!btn) return;
  settings.modeloCarnet = btn.dataset.modelo;
  saveSettings(settings);
  updateModeloPicker();
  renderCarnetPreview();
  toast(`Modelo "${CARNET_MODELOS[btn.dataset.modelo].nombre}" seleccionado`);
});

function renderCarnetPreview() {
  const sel = selectedMembers();
  const box = $('#carnetPreview');
  if (!sel.length) {
    box.innerHTML = '<p class="empty-msg">Selecciona un miembro para ver su carnet</p>';
    return;
  }
  box.innerHTML = carnetHTML(sel[sel.length - 1]);
}

function updateCarnetButtons() {
  const n = selectedIds.size;
  $('#btnPrintCards').disabled = !n;
  $('#btnDownloadPNG').disabled = !n;
  $('#btnPrintCards').innerHTML = `<i data-lucide="printer"></i> Imprimir / PDF${n ? ` (${n})` : ''}`;
  $('#btnDownloadPNG').innerHTML = `<i data-lucide="download"></i> Descargar PNG${n ? ` (${n})` : ''}`;
  refreshIcons();
}

/* --- Impresión masiva (PDF desde el navegador) --- */
$('#btnPrintCards').addEventListener('click', async () => {
  const sel = selectedMembers();
  if (!sel.length) return;
  const area = $('#printArea');
  area.innerHTML = sel.map(carnetHTML).join('');
  // Espera imágenes y fuentes antes de imprimir (evita carnets a medio cargar)
  const imgs = [...area.querySelectorAll('img')];
  await Promise.all(imgs.map(img => img.complete ? Promise.resolve() :
    new Promise(r => { img.onload = r; img.onerror = r; })));
  try { await document.fonts.ready; } catch {}
  setTimeout(() => window.print(), 150);
});

window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

/* --- Descarga PNG (alta resolución) --- */
function nombreArchivo(m) {
  return (m.nombres || 'miembro').replace(/[^\wáéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_');
}

/* Renderiza el carnet de un miembro en un canvas de alta resolución */
async function carnetToCanvas(m) {
  try { await document.fonts.ready; } catch {}
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(holder);
  try {
    holder.innerHTML = carnetHTML(m);
    const node = holder.firstElementChild;
    const imgs = [...node.querySelectorAll('img')];
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() :
      new Promise(r => { img.onload = r; img.onerror = r; })));
    return await html2canvas(node, { scale: 5, backgroundColor: null, logging: false });
  } finally {
    holder.remove();
  }
}

async function downloadCarnetPNG(members) {
  if (!window.html2canvas) { toast('Se necesita conexión a internet para generar el PNG', 'err'); return; }
  try {
    for (const m of members) {
      const canvas = await carnetToCanvas(m);
      const a = document.createElement('a');
      a.download = `carnet_${nombreArchivo(m)}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      await new Promise(r => setTimeout(r, 350));
    }
    toast(`${members.length} carnet(s) descargados`);
  } catch (err) {
    toast('Error generando PNG: ' + err.message, 'err');
  }
}

/* Enviar el carnet por WhatsApp */
async function enviarWhatsApp(m) {
  if (!window.html2canvas) { toast('Se necesita conexión a internet', 'err'); return; }
  toast('Generando carnet…');
  try {
    const canvas = await carnetToCanvas(m);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], `carnet_${nombreArchivo(m)}.png`, { type: 'image/png' });
    const primerNombre = (m.nombres || '').split(/\s+/)[0];
    const texto = `Hola ${primerNombre}, aquí está tu carnet de Membresía ${settings.anio} de la Confraternidad Cristiana Nueva Jerusalén. ¡Dios te bendiga!`;

    // Si el equipo permite compartir archivos directamente (móvil / Windows con WhatsApp)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: texto, title: 'Carnet de membresía' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // el usuario canceló
      }
    }

    // Alternativa: descarga el PNG y abre el chat del miembro para adjuntarlo
    const a = document.createElement('a');
    a.download = file.name;
    a.href = canvas.toDataURL('image/png');
    a.click();
    const tel = (m.telefono || '').replace(/\D/g, '');
    const tel58 = tel.startsWith('0') ? '58' + tel.slice(1) : (tel.startsWith('58') ? tel : '');
    window.open(tel58
      ? `https://wa.me/${tel58}?text=${encodeURIComponent(texto)}`
      : `https://wa.me/?text=${encodeURIComponent(texto)}`);
    toast('Carnet descargado: adjúntalo en el chat de WhatsApp que se abrió', 'ok', 6000);
  } catch (err) {
    toast('No se pudo generar el carnet: ' + err.message, 'err');
  }
}

$('#btnDownloadPNG').addEventListener('click', () => downloadCarnetPNG(selectedMembers()));

/* ============================================================
   AJUSTES
   ============================================================ */
function openSettings() {
  $('#renovarLabel').textContent = `Iniciar renovación ${Number(settings.anio) + 1}`;
  $('#setGeminiKey').value = settings.geminiKey;
  $('#setOpenrouterKey').value = settings.openrouterKey;
  $('#setGroqKey').value = settings.groqKey;
  $('#setApiKey').value = settings.apiKey;
  $('#setAnio').value = settings.anio;
  $('#setSede').value = settings.sede;
  $('#setRif').value = settings.rif;
  $('#settingsModal').classList.remove('hidden');
}

$('#btnAjustes').addEventListener('click', openSettings);

/* --- Renovación anual --- */
$('#btnRenovar').addEventListener('click', async () => {
  const siguiente = Number(settings.anio) + 1;
  if (!confirm(`Esto cambiará el año de membresía a ${siguiente} y marcará a TODOS los miembros como "Por renovar". ¿Continuar?`)) return;
  settings.anio = String(siguiente);
  saveSettings(settings);
  for (const m of MEMBERS) {
    m.renovado = false;
    await dbPut(m);
  }
  await refreshMembers();
  $('#settingsModal').classList.add('hidden');
  renderDashboard();
  renderMembersTable();
  renderCarnetPreview();
  toast(`Renovación ${siguiente} iniciada: todos marcados como "Por renovar"`);
});

/* --- Recordatorio de respaldo --- */
function checkBackupReminder() {
  const last = Number(localStorage.getItem('cfnj_lastBackup') || 0);
  const snooze = Number(localStorage.getItem('cfnj_backupSnooze') || 0);
  const dias = (Date.now() - last) / 86400000;
  const show = MEMBERS.length > 0 && dias > 7 && Date.now() > snooze;
  $('#backupBanner').classList.toggle('hidden', !show);
  if (show) {
    $('#backupMsg').textContent = last
      ? `Hace ${Math.floor(dias)} días que no guardas un respaldo de la base de datos.`
      : 'Aún no has guardado ningún respaldo de la base de datos.';
    refreshIcons();
  }
}

$('#btnBackupNow').addEventListener('click', () => {
  $('#btnExportJSON').click();
  checkBackupReminder();
});

$('#btnBackupLater').addEventListener('click', () => {
  localStorage.setItem('cfnj_backupSnooze', String(Date.now() + 3 * 86400000));
  $('#backupBanner').classList.add('hidden');
});
$('#linkAjustes')?.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });

$('#btnSaveSettings').addEventListener('click', () => {
  settings.geminiKey = $('#setGeminiKey').value.trim();
  settings.openrouterKey = $('#setOpenrouterKey').value.trim();
  settings.groqKey = $('#setGroqKey').value.trim();
  settings.apiKey = $('#setApiKey').value.trim();
  settings.anio = $('#setAnio').value.trim() || '2026';
  settings.sede = $('#setSede').value.trim();
  settings.rif = $('#setRif').value.trim();
  saveSettings(settings);
  $('#settingsModal').classList.add('hidden');
  $('#apiKeyWarning').classList.toggle('hidden', hasAI());
  renderDashboard();
  renderCarnetPreview();
  toast('Ajustes guardados');
});

/* Cerrar modales */
$$('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => $('#' + btn.dataset.close).classList.add('hidden'));
});
$$('.modal-backdrop').forEach(bg => {
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.classList.add('hidden'); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-backdrop').forEach(bg => bg.classList.add('hidden'));
});

/* ============================================================
   ARRANQUE
   ============================================================ */
/* ============================================================
   SESIÓN (modo nube)
   ============================================================ */
function setSesion(session) {
  SESION = session;
  $('#loginOverlay').classList.toggle('hidden', !!session);
  $('#userBox').classList.toggle('hidden', !session);
  if (session) $('#userEmail').textContent = session.user.email;
  if (session && !APP_CARGADA) {
    APP_CARGADA = true;
    cargarApp();
  }
}

if (sb) {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnLogin');
    btn.disabled = true;
    $('#loginError').classList.add('hidden');
    const { error } = await sb.auth.signInWithPassword({
      email: $('#loginEmail').value.trim(),
      password: $('#loginPass').value
    });
    btn.disabled = false;
    if (error) {
      $('#loginError').textContent = /credentials/i.test(error.message)
        ? 'Correo o contraseña incorrectos'
        : 'No se pudo iniciar sesión: ' + error.message;
      $('#loginError').classList.remove('hidden');
    }
  });

  $('#btnSalir').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });
}

/* Importa los miembros precargados (datos.js + planillas_extra.js del script
   escanear_planillas.py), una sola vez cada uno. Solo en modo local:
   en la nube los datos viven en Supabase. */
async function importSeeds() {
  if (sb) return;
  const seeds = [...(window.SEED_MEMBERS || []), ...(window.SEED_MEMBERS_EXTRA || [])];
  const photos = { ...(window.SEED_PHOTOS || {}), ...(window.SEED_PHOTOS_EXTRA || {}) };
  // Conjuntos de control para no duplicar (incluye lo agregado en esta misma pasada)
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const keysVistos = new Set(MEMBERS.map(m => m.seedKey).filter(Boolean));
  const cisVistas = new Set(MEMBERS.map(m => digits(m.ci)).filter(Boolean));

  let added = 0;
  for (const seed of seeds) {
    if (!seed.seedKey || keysVistos.has(seed.seedKey)) continue;
    const ciDigits = digits(seed.ci);
    if (ciDigits && cisVistas.has(ciDigits)) continue; // misma cédula ya registrada
    const member = {
      ...seed,
      foto: seed.foto || photos[seed.seedKey] || null,
      fechaRegistro: new Date().toISOString()
    };
    await dbPut(member);
    keysVistos.add(seed.seedKey);
    if (ciDigits) cisVistas.add(ciDigits);
    added++;
  }
  if (added) {
    await refreshMembers();
    toast(`${added} miembro(s) importados de las planillas`);
  }
}

/* Carga los datos y pinta la interfaz (tras iniciar sesión, en modo nube) */
async function cargarApp() {
  try {
    await refreshMembers();
  } catch (err) {
    toast('No se pudo cargar la base de datos: ' + err.message, 'err', 7000);
  }
  await importSeeds();
  renderDashboard();
  updateModeloPicker();
  $('#checkQR').checked = settings.carnetQR !== false;
  checkBackupReminder();
  $('#apiKeyWarning').classList.toggle('hidden', hasAI());
  // Permite abrir una pestaña directa con #miembros, #carnets, etc.
  const h = location.hash.slice(1);
  if (h && document.getElementById('tab-' + h)) goTab(h);
  refreshIcons();
}

(async function init() {
  if (sb) {
    // Modo nube: primero la sesión, luego los datos
    const { data: { session } } = await sb.auth.getSession();
    setSesion(session);
    sb.auth.onAuthStateChange((_evento, s) => setSesion(s));
    if (!session) refreshIcons(); // pantalla de inicio de sesión
    return;
  }
  // Modo local (carpeta): IndexedDB como siempre
  await openDB();
  APP_CARGADA = true;
  await cargarApp();
})();
