/* /api/keepalive — Mantiene activo el proyecto de Supabase.
   Supabase pausa los proyectos gratuitos tras 7 días sin uso. El cron de
   Vercel (vercel.json → "crons") llama a esta ruta una vez al día y ella
   ejecuta la función keepalive() de la base de datos, que escribe una fila.

   Variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY (las mismas de
   /api/extract). Si existe CRON_SECRET, Vercel la envía sola en el cron y
   la ruta rechaza cualquier otra llamada. */

module.exports = async function handler(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Faltan SUPABASE_URL / SUPABASE_ANON_KEY' });

  try {
    const r = await fetch(`${url}/rest/v1/rpc/keepalive`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ origen: 'vercel-cron' })
    });
    const cuerpo = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Supabase HTTP ${r.status}`, detalle: cuerpo.slice(0, 300) });
    return res.status(200).json({ ok: true, ultimo: JSON.parse(cuerpo) });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
};
