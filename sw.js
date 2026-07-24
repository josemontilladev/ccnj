/* Service Worker — permite que la app abra y funcione sin internet.
   Cachea la interfaz (HTML/CSS/JS/librerías); nunca cachea los datos
   de Supabase ni la lectura de planillas (/api/). */

const CACHE = 'ccnj-v4';
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'config-nube.js',
  'assets.js',
  'logo.png',
  'favicon.png',
  'favicon.ico',
  'manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Datos e IA: siempre directo a la red (nunca del caché)
  if (url.pathname.startsWith('/api/')) return;
  if (url.hostname.endsWith('supabase.co')) return;

  // Interfaz y librerías: caché primero, red como respaldo,
  // y actualización del caché en segundo plano
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const red = fetch(e.request).then((resp) => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
