// Agrégats PUBLICS (aucun pseudo, aucun userId) calculés depuis Redis (événements, relevés des serveurs, battements).
// Cache CDN 2 min pour limiter les lectures.
import { ready, readEvents, readSamples, readBeats, day } from "./_db.js";
import { sessionStats } from "./_stats.js";
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) };
export default async function handler(req, res) {
  if (!ready()) return res.status(503).json({ error: "base non configurée" });
  const days = [1, 0].map(d => day(d));
  let ev, samples, bt;
  try { [ev, samples, bt] = await Promise.all([readEvents(days), readSamples(days), readBeats()]) } catch (e) { return res.status(502).json({ error: "base indisponible" }) }
  for (let i = ev.length - 1; i >= 0; i--) if (!ev[i].job) ev.splice(i, 1); // événements de test Studio (pas d'id de serveur) exclus des stats publiques
  ev.sort((a, b) => a.t - b.t); samples.sort((a, b) => a.t - b.t);
  // affluence : paquets de 10 minutes
  const B = {}; samples.forEach(x => { const k = Math.floor(x.t / 600) * 600, b = B[k] || (B[k] = { t: k, n: 0, pk: 0, sv: 0, fps: [], ping: [], c: 0 }); const tot = x.s.reduce((a, y) => a + y.n, 0); b.n += tot; b.c++; b.pk = Math.max(b.pk, tot); b.sv = Math.max(b.sv, x.s.length); x.s.forEach(y => { if (y.fps) b.fps.push(y.fps); if (y.ping) b.ping.push(y.ping) }) });
  const flow = Object.values(B).map(b => ({ t: b.t, avg: +(b.n / b.c).toFixed(2), peak: b.pk, servers: b.sv, fps: b.fps.length ? Math.round(b.fps.reduce((a, y) => a + y, 0) / b.fps.length) : null, ping: b.ping.length ? Math.round(b.ping.reduce((a, y) => a + y, 0) / b.ping.length) : null }));
  // sessions : join + leave appariés par (serveur, joueur haché)
  const open = {}, sess = [], dev = {}, srv = {};
  ev.forEach(e => { const k = e.job + "|" + e.p;
    if (e.type === "client") dev[k] = e;
    if (e.type === "join") open[k] = { k, p: e.p && e.p.slice(0, 6), job: e.job && e.job.slice(0, 8), jf: e.job, uid: e.uid, t: e.t, reg: e.reg, acct: e.acct, prem: e.prem, src: e.src, dur: null, deaths: 0, buys: 0, ph: {}, seq: [] };
    else if (e.type === "leave") { const o = open[k] || { k, p: e.p && e.p.slice(0, 6), job: e.job && e.job.slice(0, 8), t: e.t - (e.dur || 0), deaths: 0, buys: 0, ph: {}, seq: [] }; o.dur = e.dur; o.end = e.t; sess.push(o); delete open[k] }
    else if (e.type === "phase" && open[k] && e.ph && Number.isFinite(e.dt)) { if (open[k].ph[e.ph] == null) open[k].ph[e.ph] = e.dt; open[k].last = e.ph; if (open[k].seq.length < 60) open[k].seq.push({ ph: e.ph, dt: e.dt }) }
    else if (e.type === "death" && open[k]) open[k].deaths++;
    else if (e.type === "purchase" && e.ok) { const o = open[k]; if (o) o.buys++ }
    if (e.job) { const s = srv[e.job] || (srv[e.job] = { job: e.job.slice(0, 8), t0: e.t, t1: e.t, peak: 0, joins: 0, v: e.v }); s.t0 = Math.min(s.t0, e.t); s.t1 = Math.max(s.t1, e.t); if (e.type === "join") s.joins++; if (Number.isFinite(e.n)) s.peak = Math.max(s.peak, e.n); if (e.type === "server_end") { s.ended = true; if (e.peak) s.peak = Math.max(s.peak, e.peak) } } });
  Object.values(bt).forEach(b => { if (!b.job) return; const s = srv[b.job] || (srv[b.job] = { job: b.job.slice(0, 8), t0: b.t - (b.up || 0), t1: b.t, peak: 0, joins: 0, v: b.v }); s.t1 = Math.max(s.t1, b.t); if (Number.isFinite(b.n)) s.peak = Math.max(s.peak, b.n) });
  Object.values(open).forEach(o => sess.push({ ...o, live: true }));
  const done = sess.filter(s => Number.isFinite(s.dur)), durs = done.map(s => s.dur);
  const tracked = done.filter(s => s.ph && Object.keys(s.ph).length), withPlay = done.filter(s => Number.isFinite(s.ph && s.ph.play)), playDurs = withPlay.map(s => Math.max(0, s.dur - s.ph.play)), loads = sess.map(s => s.ph && s.ph.loaded).filter(Number.isFinite);
  // phases de la dernière version publiée (le suivi du tutoriel, du lobby et des manches en dépend) : combien de sessions
  // atteignent chaque phase, en combien de secondes, et la dernière phase vue avant de quitter
  const vOf = s => srv[Object.keys(srv).find(j => j.startsWith(s.job))]?.v, latest = Math.max(0, ...Object.values(srv).map(s => s.v || 0));
  // la dernière version, et les précédentes tant qu'il y a moins de PH_MIN sessions (une version neuve à 1 joueur
  // affichait 100 % partout, Alane 21/10)
  const PH_MIN = 30, byV = {}; sess.forEach(s => { const v = vOf(s); if (v) (byV[v] = byV[v] || []).push(s) });
  const vs = []; let lv = []; Object.keys(byV).map(Number).sort((a, b) => b - a).forEach(v => { if (lv.length < PH_MIN) { vs.push(v); lv = lv.concat(byV[v]) } });
  const PH = {};
  lv.forEach(s => Object.entries(s.ph || {}).forEach(([n, dt]) => (PH[n] = PH[n] || []).push(dt)));
  const phases = { v: latest || null, vFrom: vs.length ? Math.min(...vs) : null, sessions: lv.length, steps: Object.entries(PH).map(([name, a]) => ({ name, n: a.length, medDt: med(a.map(x => Math.round(x))) })).sort((a, b) => b.n - a.n),
    leftAfter: Object.entries(lv.filter(s => !s.live && s.last).reduce((o, s) => (o[s.last] = (o[s.last] || 0) + 1, o), {})).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
  // versions publiées : comparer chaque publication à la précédente (durée, manche jouée, sessions longues)
  const versions = Object.entries(sess.reduce((o, s) => { const v = vOf(s); if (v) (o[v] = o[v] || []).push(s); return o }, {})).map(([v, a]) => { const d = a.filter(s => Number.isFinite(s.dur)); return { v: +v, sessions: a.length, t0: Math.min(...a.map(s => s.t)), medianSec: med(d.map(s => s.dur)), playPct: Math.round(a.filter(s => s.ph && s.ph.play != null).length / a.length * 100), over5Pct: d.length ? Math.round(d.filter(s => s.dur >= 300).length / d.length * 100) : null } }).sort((a, b) => b.v - a.v);
  const stats = sessionStats(sess, dev, vOf);
  // matchmaking : relevés du jour où au moins 2 serveurs publics n'avaient qu'1 joueur (Roblox a séparé des joueurs seuls)
  const today = samples.filter(x => x.t >= Date.parse(days[1] + "T00:00:00Z") / 1000), splitS = today.filter(x => x.s.filter(y => y.n === 1).length >= 2);
  const split = { samples: today.length, splitSamples: splitS.length, lastAt: splitS.length ? splitS[splitS.length - 1].t : null, maxAlone: Math.max(0, ...today.map(x => x.s.filter(y => y.n === 1).length)) };
  // joueurs en ligne, ANONYMES : code haché court, état, appareil, pays, tranche d'âge du compte, chronologie. Jamais de
  // pseudo, d'identifiant, d'avatar ni de position
  const now = Math.floor(Date.now() / 1000), acctB = a => !Number.isFinite(a) ? null : a < 30 ? "<30 j" : a < 365 ? "30-365 j" : a < 1095 ? "1-3 ans" : "3 ans+";
  const online = Object.entries(open).filter(([, o]) => { const b = bt[o.jf]; return b && now - b.t < 180 }).map(([k, o]) => { const b = bt[o.jf], pl = b.pl && b.pl[o.uid] || {}, c = dev[k] || {};
    return { p: o.p, v: b.v, state: pl.ph || o.last || null, idle: pl.idle ?? null, dev: c.dev || null, inp: c.inp || null, reg: o.reg || null, acct: acctB(o.acct), sec: now - o.t, seq: o.seq } }).sort((a, b) => a.sec - b.sec);
  const cnt = (a, f) => { const o = {}; a.forEach(x => { const k = f(x) || "inconnu"; o[k] = (o[k] || 0) + 1 }); return Object.entries(o).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
  const devices = cnt(ev.filter(e => e.type === "client"), e => e.dev);
  res.setHeader("cache-control", "s-maxage=120, stale-while-revalidate=300");
  res.status(200).json({ at: new Date().toISOString(), days,
    fresh: { event: ev.length ? ev[ev.length - 1].t : null, sample: samples.length ? samples[samples.length - 1].t : null, beat: Object.values(bt).reduce((m, b) => Math.max(m, b.t || 0), 0) || null },
    totals: { sessions: sess.length, players: new Set(ev.filter(e => e.type === "join").map(e => e.p)).size, medianSec: med(durs), medianPlaySec: med(playDurs), medianLoadSec: loads.length ? +(med(loads.map(x => Math.round(x * 10))) / 10).toFixed(1) : null, leftBeforePlay: tracked.length && withPlay.length ? +((tracked.filter(s => !Number.isFinite(s.ph.play)).length) / tracked.length * 100).toFixed(1) : null, neverMoved: tracked.length ? +(tracked.filter(s => s.ph.move == null).length / tracked.length * 100).toFixed(1) : null, bounce: done.length ? +(done.filter(s => s.dur < 30).length / done.length * 100).toFixed(1) : null,
      premium: sess.length ? +(sess.filter(s => s.prem).length / sess.length * 100).toFixed(1) : null, newAccounts: sess.length ? +(sess.filter(s => Number.isFinite(s.acct) && s.acct < 30).length / sess.length * 100).toFixed(1) : null, deaths: ev.filter(e => e.type === "death").length, purchases: ev.filter(e => e.type === "purchase" && e.ok).length },
    flow, servers: Object.values(srv).sort((a, b) => b.t0 - a.t0).slice(0, 50).map(s => ({ ...s, lifeSec: s.t1 - s.t0 })),
    sessions: sess.sort((a, b) => b.t - a.t).slice(0, 100).map(s => ({ p: s.p, job: s.job, t: s.t, dur: s.dur, reg: s.reg, acct: s.acct, prem: !!s.prem, src: s.src, deaths: s.deaths, live: !!s.live, load: s.ph && s.ph.loaded != null ? s.ph.loaded : null, spawn: s.ph && s.ph.spawn != null ? s.ph.spawn : null, move: s.ph && s.ph.move != null ? s.ph.move : null, play: s.ph && s.ph.play != null ? s.ph.play : null })),
    phases, versions, stats, split, online, regions: cnt(sess, s => s.reg), devices, sources: cnt(sess, s => s.src) });
}
