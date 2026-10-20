// Vue privée des données collectées (pseudos en clair). Protégée par ?k=CRON_SECRET. Jamais liée depuis le site public.
// ?day=AAAA-MM-JJ (défaut : aujourd'hui, UTC) ; renvoie les comptes par type d'événement et les derniers événements.
import { list, get } from "@vercel/blob";
const A = () => process.env.BLOB_ACCESS || "private";
async function readAll(prefix, cap) {
  const out = []; let cursor;
  do { const r = await list({ prefix, cursor, limit: 1000 }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined } while (cursor && out.length < cap);
  const blobs = out.sort((a, b) => a.pathname < b.pathname ? -1 : 1).slice(-cap), rows = [];
  for (let i = 0; i < blobs.length; i += 10) {
    const part = await Promise.all(blobs.slice(i, i + 10).map(async b => { try { const g = await get(b.pathname, { access: A() }); return g && g.statusCode === 200 ? JSON.parse(await new Response(g.stream).text()) : [] } catch { return [] } }));
    part.forEach(p => rows.push(...(Array.isArray(p) ? p : [p])));
  }
  return { files: blobs.length, rows };
}
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.query.k !== process.env.CRON_SECRET) return res.status(401).end();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || "") ? req.query.day : new Date().toISOString().slice(0, 10);
  const [s, v0] = await Promise.all([readAll(`sessions/${day}/`, 400), readAll(`serveurs/${day}/`, 400)]);
  let roll = []; try { const g = await get(`serveurs/${day}.json`, { access: A(), useCache: false }); if (g && g.statusCode === 200) roll = JSON.parse(await new Response(g.stream).text()) } catch {}
  const v = { files: v0.files + (roll.length ? 1 : 0), rows: [...v0.rows, ...roll] };
  const by = {}; s.rows.forEach(e => by[e.type] = (by[e.type] || 0) + 1);
  s.rows.sort((a, b) => a.t - b.t);
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ day, sessionFiles: s.files, serverFiles: v.files, eventsByType: by,
    players: [...new Set(s.rows.filter(e => e.type === "join").map(e => e.name))],
    lastEvents: s.rows.filter(e => e.type !== "beat").slice(-30), lastBeat: s.rows.filter(e => e.type === "beat").slice(-1)[0] || null,
    serverSamples: v.rows.length, lastSample: v.rows.slice(-1)[0] || null });
}
