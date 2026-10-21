// Relevé des serveurs publics (id, joueurs, FPS, ping). À appeler toutes les 2 min par un déclencheur externe.
// Protégé par ?k=CRON_SECRET. Ajoute le relevé à la liste Redis sm:AAAA-MM-JJ (1 commande par appel) ; ménage des vieux jours vers 03 h UTC.
import { ready, pipe, day } from "./_db.js";
const P = "78574155859097";
export default async function handler(req, res) {
  if (!ready()) return res.status(503).json({ error: "base non configurée" });
  if (!process.env.CRON_SECRET || req.query.k !== process.env.CRON_SECRET) return res.status(401).end();
  let r;
  for (let i = 0; i < 2 && !(r && r.ok); i++) { r = await fetch(`https://games.roblox.com/v1/games/${P}/servers/Public?limit=100`, { headers: { accept: "application/json" } }).catch(() => null); if (r && r.status === 429) await new Promise(s => setTimeout(s, 2000)) }
  if (!r || !r.ok) return res.status(502).json({ error: r ? r.status : "réseau" });
  const j = await r.json(), t = Date.now(), s = (j.data || []).map(x => ({ id: x.id, n: x.playing, max: x.maxPlayers, fps: x.fps && +x.fps.toFixed(1), ping: x.ping }));
  const cmds = [["RPUSH", "sm:" + day(), JSON.stringify({ t: Math.floor(t / 1000), s })]], dt = new Date(t);
  if (dt.getUTCHours() === 3 && dt.getUTCMinutes() < 2) for (let i = 8; i <= 14; i++) cmds.push(["DEL", "ev:" + day(i)], ["DEL", "sm:" + day(i)]);
  const rows = (await pipe(cmds))[0];
  res.status(200).json({ servers: s.length, players: s.reduce((a, x) => a + x.n, 0), samplesToday: rows });
}
