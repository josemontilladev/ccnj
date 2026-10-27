/* generar-sql.mjs — Convierte el respaldo del Supabase anterior
   (pg_dumpall en texto plano) en archivos SQL listos para el proyecto nuevo.

   Uso:  node migracion/generar-sql.mjs backup/db_cluster-XXXX.backup

   Escribe en backup/sql/ (carpeta ignorada por git: contiene datos personales):
     01_usuarios.sql        cuentas de acceso (conservan su contraseña)
     02_esquema.sql         supabase.sql completo
     03_config.sql          código de invitación
     04_miembros_NN.sql     miembros en partes pequeñas (el SQL Editor no acepta
                            archivos enormes por las fotos en base64)
     99_verificar.sql       conteos para comprobar que todo llegó

   Ejecuta los archivos en ese orden (SQL Editor o migracion/restaurar.mjs).
   El orden importa: las cuentas van antes del esquema porque el esquema crea
   el trigger del código de invitación, que bloquearía su inserción. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node migracion/generar-sql.mjs <archivo .backup>');
  process.exit(1);
}
const SALIDA = path.join(RAIZ, 'backup', 'sql');
const MIEMBROS_POR_PARTE = 15;

/* ---------- Lectura de los bloques COPY del respaldo ---------- */
function unescapeCopy(v) {
  if (v === '\\N') return null;
  return v.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\' }[c] ?? c));
}

function leerTablas(texto) {
  const tablas = {};
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^COPY (\S+) \((.+)\) FROM stdin;$/);
    if (!m) continue;
    const columnas = m[2].split(', ').map(c => c.replace(/^"|"$/g, ''));
    const filas = [];
    for (i++; lineas[i] !== '\\.'; i++) {
      const vals = lineas[i].replace(/\r$/, '').split('\t').map(unescapeCopy);
      filas.push(Object.fromEntries(columnas.map((c, k) => [c, vals[k]])));
    }
    tablas[m[1]] = filas;
  }
  return tablas;
}

/* ---------- Generación de SQL ---------- */
const lit = v => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const id = c => `"${c}"`;

function insert(tabla, cols, filas, extra = '') {
  if (!filas.length) return '';
  const valores = filas.map(f => `  (${cols.map(c => lit(f[c])).join(', ')})`).join(',\n');
  return `insert into ${tabla} (${cols.map(id).join(', ')}) values\n${valores}\n${extra};\n`;
}

const t = leerTablas(fs.readFileSync(archivo, 'utf8'));
fs.mkdirSync(SALIDA, { recursive: true });
for (const f of fs.readdirSync(SALIDA)) if (f.endsWith('.sql')) fs.unlinkSync(path.join(SALIDA, f));
const escribir = (nombre, sql) => fs.writeFileSync(path.join(SALIDA, nombre), sql);

// 01 — Cuentas. Solo las columnas estables de auth.users; los tokens van en ''
// (el servicio de Auth falla al iniciar sesión si quedan en null).
const usuarios = (t['auth.users'] || []).map(u => ({
  ...u,
  confirmation_token: '', recovery_token: '', email_change_token_new: '',
  email_change: '', email_change_token_current: '', reauthentication_token: ''
}));
const colsUsuarios = ['instance_id', 'id', 'aud', 'role', 'email', 'encrypted_password',
  'email_confirmed_at', 'last_sign_in_at', 'raw_app_meta_data', 'raw_user_meta_data',
  'created_at', 'updated_at', 'confirmation_token', 'recovery_token',
  'email_change_token_new', 'email_change', 'email_change_token_current', 'reauthentication_token'];
const colsIdentidades = ['provider_id', 'user_id', 'identity_data', 'provider',
  'last_sign_in_at', 'created_at', 'updated_at', 'id'];
escribir('01_usuarios.sql',
  '-- Cuentas de acceso del proyecto anterior (conservan su contraseña).\n' +
  '-- Ejecutar ANTES de 02_esquema.sql.\n' +
  insert('auth.users', colsUsuarios, usuarios, 'on conflict (id) do nothing') +
  insert('auth.identities', colsIdentidades, t['auth.identities'] || [], 'on conflict do nothing'));

// 02 — Esquema
escribir('02_esquema.sql', fs.readFileSync(path.join(RAIZ, 'supabase.sql'), 'utf8'));

// 03 — Código de invitación
escribir('03_config.sql', (t['privado.config'] || []).map(c =>
  `insert into privado.config (clave, valor) values (${lit(c.clave)}, ${lit(c.valor)})\n` +
  `  on conflict (clave) do update set valor = excluded.valor;\n`).join(''));

// 04 — Miembros en partes
const miembros = t['public.miembros'] || [];
const colsMiembros = miembros.length ? Object.keys(miembros[0]) : [];
const upsert = 'on conflict (id) do update set ' +
  colsMiembros.filter(c => c !== 'id').map(c => `${id(c)} = excluded.${id(c)}`).join(', ');
const partes = Math.ceil(miembros.length / MIEMBROS_POR_PARTE);
for (let p = 0; p < partes; p++) {
  const lote = miembros.slice(p * MIEMBROS_POR_PARTE, (p + 1) * MIEMBROS_POR_PARTE);
  let sql = insert('public.miembros', colsMiembros, lote, upsert);
  // La última parte ajusta el contador de ids para que los nuevos no choquen
  if (p === partes - 1) {
    sql += "\nselect setval(pg_get_serial_sequence('public.miembros', 'id'), " +
      "(select coalesce(max(id), 1) from public.miembros));\n";
  }
  escribir(`04_miembros_${String(p + 1).padStart(2, '0')}.sql`, sql);
}

// 99 — Verificación
escribir('99_verificar.sql',
  "select 'miembros' as tabla, count(*) from public.miembros\n" +
  "union all select 'con foto', count(*) from public.miembros where foto is not null\n" +
  "union all select 'usuarios', count(*) from auth.users\n" +
  "union all select 'config', count(*) from privado.config;\n");

console.log(`Listo en ${SALIDA}`);
console.log(`  usuarios: ${usuarios.length}, miembros: ${miembros.length} en ${partes} partes, ` +
  `config: ${(t['privado.config'] || []).length}`);
