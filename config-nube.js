/* config-nube.js — Conexión a la base de datos en la nube (Supabase).
   Si este archivo existe, la app trabaja en modo nube con inicio de sesión.
   La clave "anon" es pública por diseño: la seguridad la ponen las
   políticas RLS de Supabase y el inicio de sesión.

   El código de invitación para crear cuentas NO va aquí: vive solo en
   el servidor (tabla privado.config, ver supabase.sql) y lo valida el
   servidor al registrarse. */

window.CONFIG_NUBE = {
  url: 'https://bjxnhibureqgjitmlxxm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqeG5oaWJ1cmVxZ2ppdG1seHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzEzMjksImV4cCI6MjEwMDIwNzMyOX0.Ov4ARWr0AQg0uqLA0xhzokL0Y-H2OyuQVWajv1cyREY'
};
