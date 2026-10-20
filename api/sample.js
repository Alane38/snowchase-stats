// Relevé des serveurs publics (id, joueurs, FPS, ping). À appeler toutes les 2 min par un déclencheur externe.
// Protégé par ?k=CRON_SECRET. Stocke sessions/serveurs/AAAA-MM-JJ/<ts>.json
import { put } from "@vercel/blob";
const P = "78574155859097";
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.query.k !== process.env.CRON_SECRET) return res.status(401).end();
  let r, j;
  for (let i = 0; i < 2 && !(r && r.ok); i++) { r = await fetch(`https://games.roblox.com/v1/games/${P}/servers/Public?limit=100`, { headers: { accept: "application/json" } }).catch(() => null); if (r && r.status === 429) await new Promise(s => setTimeout(s, 2000)) }
  if (!r || !r.ok) return res.status(502).json({ error: r ? r.status : "réseau" });
  j = await r.json();
  const t = Date.now(), s = (j.data || []).map(x => ({ id: x.id, n: x.playing, max: x.maxPlayers, fps: x.fps && +x.fps.toFixed(1), ping: x.ping }));
  await put(`serveurs/${new Date(t).toISOString().slice(0, 10)}/${t}.json`, JSON.stringify({ t: Math.floor(t / 1000), s }), { access: process.env.BLOB_ACCESS || "private", addRandomSuffix: false, contentType: "application/json" });
  res.status(200).json({ servers: s.length, players: s.reduce((a, x) => a + x.n, 0) });
}
