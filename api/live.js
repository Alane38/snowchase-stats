// Agrégats PUBLICS (aucun pseudo, aucun userId) calculés depuis les blobs sessions/ et serveurs/.
// Cache CDN 10 min pour limiter les lectures de blobs.
import { list, get } from "@vercel/blob";
const A = () => process.env.BLOB_ACCESS || "private";
const txt = async p => { try { const g = await get(p, { access: A() }); return g && g.statusCode === 200 ? await new Response(g.stream).text() : null } catch { return null } };
async function many(paths) { const out = []; for (let i = 0; i < paths.length; i += 10) out.push(...await Promise.all(paths.slice(i, i + 10).map(async p => { const t = await txt(p); try { return t ? JSON.parse(t) : [] } catch { return [] } }))); return out.flat() }
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) };
export default async function handler(req, res) {
  const days = [1, 0].map(d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10));
  const ev = [], samples = [];
  for (const d of days) {
    const l = await list({ prefix: `sessions/${d}/`, limit: 1000 });
    ev.push(...await many(l.blobs.map(b => b.pathname).slice(-500)));
    const roll = await txt(`serveurs/${d}.json`); if (roll) try { samples.push(...JSON.parse(roll)) } catch {}
  }
  for (let i = ev.length - 1; i >= 0; i--) if (!ev[i].job) ev.splice(i, 1); // événements de test Studio (pas d'id de serveur) exclus des stats publiques
  ev.sort((a, b) => a.t - b.t); samples.sort((a, b) => a.t - b.t);
  // affluence : paquets de 10 minutes
  const B = {}; samples.forEach(x => { const k = Math.floor(x.t / 600) * 600, b = B[k] || (B[k] = { t: k, n: 0, pk: 0, sv: 0, fps: [], ping: [], c: 0 }); const tot = x.s.reduce((a, y) => a + y.n, 0); b.n += tot; b.c++; b.pk = Math.max(b.pk, tot); b.sv = Math.max(b.sv, x.s.length); x.s.forEach(y => { if (y.fps) b.fps.push(y.fps); if (y.ping) b.ping.push(y.ping) }) });
  const flow = Object.values(B).map(b => ({ t: b.t, avg: +(b.n / b.c).toFixed(2), peak: b.pk, servers: b.sv, fps: b.fps.length ? Math.round(b.fps.reduce((a, y) => a + y, 0) / b.fps.length) : null, ping: b.ping.length ? Math.round(b.ping.reduce((a, y) => a + y, 0) / b.ping.length) : null }));
  // sessions : join + leave appariés par (serveur, joueur haché)
  const open = {}, sess = [], dev = {}, srv = {};
  ev.forEach(e => { const k = e.job + "|" + e.p;
    if (e.type === "client") dev[k] = e;
    if (e.type === "join") open[k] = { p: e.p && e.p.slice(0, 6), job: e.job && e.job.slice(0, 8), t: e.t, reg: e.reg, acct: e.acct, prem: e.prem, src: e.src, dur: null, deaths: 0, buys: 0, ph: {} };
    else if (e.type === "leave") { const o = open[k] || { p: e.p && e.p.slice(0, 6), job: e.job && e.job.slice(0, 8), t: e.t - (e.dur || 0), deaths: 0, buys: 0, ph: {} }; o.dur = e.dur; o.end = e.t; sess.push(o); delete open[k] }
    else if (e.type === "phase" && open[k] && e.ph && Number.isFinite(e.dt)) { if (open[k].ph[e.ph] == null) open[k].ph[e.ph] = e.dt }
    else if (e.type === "death" && open[k]) open[k].deaths++;
    else if (e.type === "purchase" && e.ok) { const o = open[k]; if (o) o.buys++ }
    if (e.job) { const s = srv[e.job] || (srv[e.job] = { job: e.job.slice(0, 8), t0: e.t, t1: e.t, peak: 0, joins: 0, v: e.v }); s.t0 = Math.min(s.t0, e.t); s.t1 = Math.max(s.t1, e.t); if (e.type === "join") s.joins++; if (Number.isFinite(e.n)) s.peak = Math.max(s.peak, e.n); if (e.type === "server_end" && e.peak) s.peak = Math.max(s.peak, e.peak) } });
  Object.values(open).forEach(o => sess.push({ ...o, live: true }));
  const done = sess.filter(s => Number.isFinite(s.dur)), durs = done.map(s => s.dur);
  const withPlay = done.filter(s => Number.isFinite(s.ph && s.ph.play)), playDurs = withPlay.map(s => Math.max(0, s.dur - s.ph.play)), loads = sess.map(s => s.ph && s.ph.loaded).filter(Number.isFinite);
  const cnt = (a, f) => { const o = {}; a.forEach(x => { const k = f(x) || "inconnu"; o[k] = (o[k] || 0) + 1 }); return Object.entries(o).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
  const devices = cnt(ev.filter(e => e.type === "client"), e => e.dev);
  res.setHeader("cache-control", "s-maxage=120, stale-while-revalidate=300");
  res.status(200).json({ at: new Date().toISOString(), days,
    totals: { sessions: sess.length, players: new Set(ev.filter(e => e.type === "join").map(e => e.p)).size, medianSec: med(durs), medianPlaySec: med(playDurs), medianLoadSec: loads.length ? +(med(loads.map(x => Math.round(x * 10))) / 10).toFixed(1) : null, leftBeforePlay: done.length && withPlay.length ? +((done.filter(s => !Number.isFinite(s.ph && s.ph.play)).length) / done.length * 100).toFixed(1) : null, neverMoved: done.length ? +(done.filter(s => s.ph && s.ph.move == null).length / done.length * 100).toFixed(1) : null, bounce: done.length ? +(done.filter(s => s.dur < 30).length / done.length * 100).toFixed(1) : null,
      premium: sess.length ? +(sess.filter(s => s.prem).length / sess.length * 100).toFixed(1) : null, newAccounts: sess.length ? +(sess.filter(s => Number.isFinite(s.acct) && s.acct < 30).length / sess.length * 100).toFixed(1) : null, deaths: ev.filter(e => e.type === "death").length, purchases: ev.filter(e => e.type === "purchase" && e.ok).length },
    flow, servers: Object.values(srv).sort((a, b) => b.t0 - a.t0).slice(0, 50).map(s => ({ ...s, lifeSec: s.t1 - s.t0 })),
    sessions: sess.sort((a, b) => b.t - a.t).slice(0, 100).map(s => ({ p: s.p, job: s.job, t: s.t, dur: s.dur, reg: s.reg, acct: s.acct, prem: !!s.prem, src: s.src, deaths: s.deaths, live: !!s.live, load: s.ph && s.ph.loaded != null ? s.ph.loaded : null, spawn: s.ph && s.ph.spawn != null ? s.ph.spawn : null, move: s.ph && s.ph.move != null ? s.ph.move : null, play: s.ph && s.ph.play != null ? s.ph.play : null })),
    regions: cnt(sess, s => s.reg), devices, sources: cnt(sess, s => s.src) });
}
