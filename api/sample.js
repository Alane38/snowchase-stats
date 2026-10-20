// Relevé des serveurs publics (id, joueurs, FPS, ping). À appeler toutes les 2 min par un déclencheur externe.
// Protégé par ?k=CRON_SECRET. Cumule les relevés du jour dans UN seul blob : serveurs/AAAA-MM-JJ.json (1 lecture + 1 écriture par appel).
import { put, get } from "@vercel/blob";
const P = "78574155859097", A = () => process.env.BLOB_ACCESS || "private";
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.query.k !== process.env.CRON_SECRET) return res.status(401).end();
  let r;
  for (let i = 0; i < 2 && !(r && r.ok); i++) { r = await fetch(`https://games.roblox.com/v1/games/${P}/servers/Public?limit=100`, { headers: { accept: "application/json" } }).catch(() => null); if (r && r.status === 429) await new Promise(s => setTimeout(s, 2000)) }
  if (!r || !r.ok) return res.status(502).json({ error: r ? r.status : "réseau" });
  const j = await r.json(), t = Date.now(), s = (j.data || []).map(x => ({ id: x.id, n: x.playing, max: x.maxPlayers, fps: x.fps && +x.fps.toFixed(1), ping: x.ping }));
  const path = `serveurs/${new Date(t).toISOString().slice(0, 10)}.json`;
  let rows = [];
  try { const g = await get(path, { access: A(), useCache: false }); if (g && g.statusCode === 200) rows = JSON.parse(await new Response(g.stream).text()) } catch {}
  rows.push({ t: Math.floor(t / 1000), s });
  await put(path, JSON.stringify(rows), { access: A(), addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  res.status(200).json({ servers: s.length, players: s.reduce((a, x) => a + x.n, 0), samplesToday: rows.length });
}
