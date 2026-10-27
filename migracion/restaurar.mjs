/* restaurar.mjs — Ejecuta en orden los archivos de backup/sql/ contra el
   Supabase nuevo (los genera migracion/generar-sql.mjs).

   Uso (desde la carpeta del proyecto):
     cd migracion && npm install && cd ..
     node migracion/restaurar.mjs "postgresql://postgres.<ref>:<CLAVE>@<host>:5432/postgres"

   La cadena de conexión está en Supabase → botón "Connect" → Session pooler.
   Es secreta (da acceso total a la base): no la guardes en el repositorio. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA = path.join(RAIZ, 'backup', 'sql');
const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) {
  console.error('Falta la cadena de conexión (argumento o variable DATABASE_URL)');
  process.exit(1);
}

const archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.sql')).sort();
const cliente = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await cliente.connect();
try {
  for (const f of archivos) {
    process.stdout.write(`${f} ... `);
    const r = await cliente.query(fs.readFileSync(path.join(CARPETA, f), 'utf8'));
    console.log('ok');
    if (f.startsWith('99_')) console.table((Array.isArray(r) ? r.at(-1) : r).rows);
  }
} finally {
  await cliente.end();
}
