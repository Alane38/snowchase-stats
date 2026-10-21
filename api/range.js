// Agrégats PUBLICS sur toute la durée conservée (8 jours) : carte des heures de pointe, parcours de session (entonnoir),
// joueurs depuis le lancement de la campagne. Aucun pseudo ni identifiant. Cache CDN 15 min (environ 20 commandes Redis par recalcul).
import { ready, readEvents, readSamples, day } from "./_db.js";
const CAMP = Date.parse("2026-10-19T19:30:00Z") / 1000; // lancement de la campagne : 19/10/2026 21h30 à Paris
const F = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
const paris = t => { const o = {}; F.formatToParts(new Date(t * 1000)).forEach(p => o[p.type] = p.value); return { d: o.year + "-" + o.month + "-" + o.day, h: +o.hour } };
export default async function handler(req, res) {
  if (!ready()) return res.status(503).json({ error: "base non configurée" });
  const ds = Array.from({ length: 8 }, (_, i) => day(i));
  let ev, sm;
  try { [ev, sm] = await Promise.all([readEvents(ds), readSamples(ds)]) } catch { return res.status(502).json({ error: "base indisponible" }) }
  ev = ev.filter(e => e.job).sort((a, b) => a.t - b.t);
  // heures de pointe : moyenne des joueurs en ligne par (jour, heure) à Paris
  const H = {};
  sm.forEach(x => { const q = paris(x.t), k = q.d + "|" + q.h, tot = x.s.reduce((a, y) => a + y.n, 0), c = H[k] || (H[k] = { d: q.d, h: q.h, sum: 0, c: 0, pk: 0 }); c.sum += tot; c.c++; c.pk = Math.max(c.pk, tot) });
  const heat = Object.values(H).map(c => ({ d: c.d, h: c.h, avg: +(c.sum / c.c).toFixed(2), pk: c.pk, c: c.c })).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.h - b.h);
  // sessions et phases
  const open = {}, sess = [];
  ev.forEach(e => { const k = e.job + "|" + e.p;
    if (e.type === "join") open[k] = { p: e.p, t: e.t, ph: {}, src: e.src };
    else if (e.type === "phase" && open[k] && e.ph && Number.isFinite(e.dt) && open[k].ph[e.ph] == null) open[k].ph[e.ph] = e.dt;
    else if (e.type === "leave") { const o = open[k] || { p: e.p, t: e.t - (e.dur || 0), ph: {} }; o.dur = e.dur; sess.push(o); delete open[k] } });
  Object.values(open).forEach(o => sess.push(o));
  const tracked = sess.filter(s => Object.keys(s.ph).length);
  const n = f => tracked.filter(f).length;
  const funnel = { sessions: tracked.length, loaded: n(s => s.ph.loaded != null), spawn: n(s => s.ph.spawn != null), move: n(s => s.ph.move != null), play: n(s => s.ph.play != null), stay30: n(s => Number.isFinite(s.dur) && s.dur >= 30) };
  const since = sess.filter(s => s.t >= CAMP), uniq = a => new Set(a.map(s => s.p).filter(Boolean)).size;
  const firstT = ev.length ? ev[0].t : null;
  res.setHeader("cache-control", "s-maxage=900, stale-while-revalidate=1800");
  res.status(200).json({ at: new Date().toISOString(), campStart: CAMP, from: firstT, heat, funnel,
    campaign: { sessions: since.length, players: uniq(since), played: uniq(since.filter(s => s.ph.play != null)), complete: firstT != null && firstT <= CAMP + 3600 } });
}
