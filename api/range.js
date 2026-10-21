// Agrégats PUBLICS depuis le lancement de la campagne : 8 derniers jours lus dans Redis, jours plus anciens relus dans l'archive anonymisée (branche data) : carte des heures de pointe, parcours de session (entonnoir),
// joueurs depuis le lancement de la campagne. Aucun pseudo ni identifiant. Cache CDN 15 min (environ 20 commandes Redis par recalcul).
import { ready, readEvents, readSamples, readPos, day } from "./_db.js";
const CAMP = Date.parse("2026-10-19T19:30:00Z") / 1000; // lancement de la campagne : 19/10/2026 21h30 à Paris
const F = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
const paris = t => { const o = {}; F.formatToParts(new Date(t * 1000)).forEach(p => o[p.type] = p.value); return { d: o.year + "-" + o.month + "-" + o.day, h: +o.hour } };
export default async function handler(req, res) {
  if (!ready()) return res.status(503).json({ error: "base non configurée" });
  const ds = Array.from({ length: 8 }, (_, i) => day(i));
  const older = []; for (let i = 8; i < 60; i++) { const d = day(i); if (d < new Date(CAMP * 1000).toISOString().slice(0, 10)) break; older.push(d) }
  let ev, sm, ps;
  try { [ev, sm, ps] = await Promise.all([readEvents(ds), readSamples(ds), readPos(ds)]) } catch { return res.status(502).json({ error: "base indisponible" }) }
  const arch = await Promise.all(older.map(async d => { try { const r = await fetch("https://raw.githubusercontent.com/Alane38/snowchase-stats/data/sessions/" + d + ".json"); return r.ok ? await r.json() : null } catch { return null } }));
  arch.forEach(a => { if (a && Array.isArray(a.events)) { ev = ev.concat(a.events); sm = sm.concat(Array.isArray(a.samples) ? a.samples : []); if (Array.isArray(a.pos)) ps = ps.concat(a.pos) } });
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
  const funnel = { sessions: tracked.length, loaded: n(s => s.ph.loaded != null), spawn: n(s => s.ph.spawn != null), move: n(s => s.ph.move != null), play: n(s => s.ph.play != null), alone: n(s => s.ph.alone != null), tuto: n(s => s.ph.tuto != null), stay30: n(s => Number.isFinite(s.dur) && s.dur >= 30) };
  const since = sess.filter(s => s.t >= CAMP), uniq = a => new Set(a.map(s => s.p).filter(Boolean)).size;
  const firstT = ev.length ? ev[0].t : null;
  // cartes de positions : cases de 20 studs, séparées en manche / hors manche (le tutoriel est exclu : autre zone)
  const P = [{}, {}];
  ps.forEach(x => (x.c || []).forEach(q => { const g = q[2] === 1 ? 1 : q[2] === 0 ? 0 : -1; if (g < 0) return; const k = q[0] + "," + q[1]; P[g][k] = (P[g][k] || 0) + 1 }));
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 600).map(([k, n]) => { const [x, z] = k.split(",").map(Number); return [x, z, n] });
  const pos = { lobby: top(P[0]), play: top(P[1]), snaps: ps.length };
  // retours, d'après les entrées et sorties (depuis le début du logger, 20/10 au soir) : qui revient, au bout de combien
  // de temps, et par jour de premier passage la part revenue le lendemain (jours de Paris). « Premier passage » = première
  // session vue par le logger, pas forcément la première de sa vie (le jeu existait avant)
  const byP = {}; sess.forEach(s => { if (s.p && Number.isFinite(s.t)) (byP[s.p] = byP[s.p] || []).push(s) });
  const gaps = [], visits = { 1: 0, 2: 0, 3: 0, "4+": 0 }, coh = {};
  let returned = 0;
  Object.values(byP).forEach(a => {
    a.sort((x, y) => x.t - y.t);
    const vs = [a[0]]; // une visite = une session qui commence plus d'1 min après la fin de la précédente (regroupement, reconnexion : même visite)
    for (let i = 1; i < a.length; i++) { const prev = a[i - 1], end = prev.t + (prev.dur || 0); if (a[i].t - end > 60) { vs.push(a[i]); gaps.push(a[i].t - end) } }
    const k = vs.length >= 4 ? "4+" : vs.length; visits[k]++; if (vs.length > 1) returned++;
    const d0 = paris(vs[0].t).d, c = coh[d0] || (coh[d0] = { day: d0, first: 0, j1: 0, j7: 0 }); c.first++;
    const days = new Set(vs.slice(1).map(v => paris(v.t).d)), next = new Date(Date.parse(d0 + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
    if (days.has(next)) c.j1++;
    if (vs.slice(1).some(v => v.t - vs[0].t <= 7 * 86400)) c.j7++;
  });
  const players = Object.keys(byP).length, gs = gaps.sort((x, y) => x - y);
  const returns = { players, returned, returnedPct: players ? Math.round(returned / players * 100) : null, visits,
    medianGapMin: gs.length ? Math.round(gs[gs.length >> 1] / 60) : null,
    cohorts: Object.values(coh).sort((x, y) => x.day < y.day ? -1 : 1).map(c => ({ ...c, j1Pct: c.first ? Math.round(c.j1 / c.first * 100) : null, j7Pct: c.first ? Math.round(c.j7 / c.first * 100) : null })) };
  res.setHeader("cache-control", "s-maxage=900, stale-while-revalidate=1800");
  res.status(200).json({ at: new Date().toISOString(), campStart: CAMP, from: firstT, heat, funnel, pos, returns,
    campaign: { sessions: since.length, players: uniq(since), played: uniq(since.filter(s => s.ph.play != null)), complete: firstT != null && firstT <= CAMP + 3600 } });
}
