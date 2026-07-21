# Sistema de Membresía — Confraternidad Cristiana Nueva Jerusalén

Aplicación web para registrar miembros a partir de planillas manuscritas (leídas con IA),
mantener la base de datos de la membresía y generar carnets verticales con QR de verificación.

## Arquitectura

- **Frontend**: HTML/CSS/JS sin frameworks (`index.html`, `styles.css`, `app.js`).
- **Base de datos**: Supabase (Postgres + Auth). Configuración en `config-nube.js`.
  Sin ese archivo, la app funciona en modo local con IndexedDB.
- **Lectura de planillas**: función serverless `api/extract.js` (Vercel) con Gemini
  y respaldo en OpenRouter. Las claves van en variables de entorno de Vercel:
  `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- **Esquema de la base de datos**: `supabase.sql` (pegar en el SQL Editor de Supabase).

## Despliegue

1. Ejecutar `supabase.sql` en Supabase y crear los usuarios en Authentication → Users.
2. Importar este repositorio en Vercel y definir las 4 variables de entorno.
3. Listo: la app queda en `https://<proyecto>.vercel.app`.

La carpeta `electron/` genera la versión de escritorio (instalador Windows) con `empaquetar-app.bat`.
