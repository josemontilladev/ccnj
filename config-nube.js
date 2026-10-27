/* config-nube.js — Conexión a la base de datos en la nube (Supabase).
   Si este archivo existe, la app trabaja en modo nube con inicio de sesión.
   La clave "publishable" es pública por diseño: la seguridad la ponen las
   políticas RLS de Supabase y el inicio de sesión.

   El código de invitación para crear cuentas NO va aquí: vive solo en
   el servidor (tabla privado.config, ver supabase.sql) y lo valida el
   servidor al registrarse. */

window.CONFIG_NUBE = {
  url: 'https://pmlmdavfhihdgnbiyuyg.supabase.co',
  anonKey: 'sb_publishable_CUX1s9876tulegCLFkY-TA_Fyj7yIMi'
};
