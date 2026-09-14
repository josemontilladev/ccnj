# Sistema de Membresía — Confraternidad Cristiana Nueva Jerusalén

Aplicación web para registrar miembros a partir de planillas manuscritas (leídas con IA),
mantener la base de datos de la membresía y generar carnets verticales con QR de verificación.

## Arquitectura

- **Frontend**: HTML/CSS/JS sin frameworks (`index.html`, `styles.css`, `app.js`).
- **Base de datos**: Supabase (Postgres + Auth + Storage). Configuración en `config-nube.js`.
  Sin ese archivo, la app funciona en modo local con IndexedDB.
- **Fotos**: bucket `fotos` de Supabase Storage (en la tabla solo queda la URL).
- **Lectura de planillas**: función serverless `api/extract.js` (Vercel) con Gemini
  y respaldo en OpenRouter. Las claves van en variables de entorno de Vercel:
  `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- **Esquema de la base de datos**: `supabase.sql` (pegar en el SQL Editor de Supabase).
  Es idempotente: se puede volver a ejecutar cada vez que cambie.

## Despliegue

1. Ejecutar `supabase.sql` completo en Supabase (SQL Editor → New query → Run).
2. Definir el código de invitación (solo vive en el servidor, nunca en la app):
   ```sql
   update privado.config set valor = 'UN-CODIGO-LARGO-Y-DIFICIL' where clave = 'codigo_invitacion';
   ```
   Mientras quede el valor por defecto, el registro de cuentas nuevas está bloqueado.
3. Importar este repositorio en Vercel y definir las 4 variables de entorno.
4. Listo: la app queda en `https://<proyecto>.vercel.app`.

### Si ya tenías la app funcionando (actualización)

1. Vuelve a ejecutar `supabase.sql`. Si falla en el índice `miembros_ci_unica`, hay miembros
   con la misma cédula: la consulta comentada al final del archivo los lista; corrígelos
   desde la app y vuelve a ejecutar.
2. Define el código de invitación nuevo (paso 2 de arriba). El anterior quedó expuesto en
   versiones viejas de la app, así que usa uno distinto.
3. Entra a la app → Ajustes → **Mover fotos a Storage** (una sola vez). Sube las fotos que
   estaban en base64 dentro de la tabla al bucket y deja la base liviana.
4. Recomendado en el panel de Supabase: Authentication → Providers → Email → activar
   "Confirm email", para que las cuentas nuevas verifiquen su correo.

## Detección de planillas duplicadas

Al subir planillas, la app evita registros repetidos en tres capas:

1. **Misma imagen** (antes de gastar la lectura de IA): se calcula el SHA-256 del archivo
   y una huella visual (dHash de 256 bits). Idéntica → se omite; muy parecida → pasa a
   revisión manual.
2. **Misma persona** (con los datos leídos): misma cédula → se omite; mismo nombre y fecha
   de nacimiento sin cédula → revisión manual (en registro individual pregunta antes de guardar).
3. **Servidor**: índice único de cédula en Postgres. Aunque dos personas registren a la vez
   o se edite una cédula, la base rechaza el duplicado.

Restaurar un respaldo JSON tampoco duplica: los miembros que ya existen se actualizan.

## Archivos que no se publican

`.vercelignore` excluye del sitio `supabase.sql`, los scripts locales y la carpeta `electron/`.

La carpeta `electron/` genera la versión de escritorio (instalador Windows) con `empaquetar-app.bat`.
