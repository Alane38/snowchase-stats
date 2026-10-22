// Agrégats PUBLICS (aucun pseudo, aucun userId) calculés depuis Redis (événements, relevés des serveurs, battements).
// Cache CDN 2 min pour limiter les lectures.
import { ready, readEvents, readSamples, readBeats, day } from "./_db.js";
import { sessionStats, avg, durBuckets } from "./_stats.js";
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
    if (e.type === "join") open[k] = { k, p: e.p && e.p.slice(0, 6), pFull: e.p, job: e.job && e.job.slice(0, 8), jf: e.job, uid: e.uid, t: e.t, reg: e.reg, acct: e.acct, prem: e.prem, src: e.src, dur: null, deaths: 0, buys: 0, ph: {}, seq: [] };
    else if (e.type === "leave") { const o = open[k] || { k, p: e.p && e.p.slice(0, 6), job: e.job && e.job.slice(0, 8), t: e.t - (e.dur || 0), deaths: 0, buys: 0, ph: {}, seq: [] }; o.dur = e.dur; o.end = e.t; sess.push(o); delete open[k] }
    else if (e.type === "phase" && open[k] && e.ph && Number.isFinite(e.dt)) { if (open[k].ph[e.ph] == null) open[k].ph[e.ph] = e.dt; open[k].last = e.ph; if (open[k].seq.length < 60) open[k].seq.push({ ph: e.ph, dt: e.dt }) }
    else if (e.type === "death" && open[k]) open[k].deaths++;
    else if (e.type === "purchase" && e.ok) { const o = open[k]; if (o) o.buys++ }
    if (e.job) { const s = srv[e.job] || (srv[e.job] = { job: e.job.slice(0, 8), t0: e.t, t1: e.t, peak: 0, joins: 0, v: e.v }); s.t0 = Math.min(s.t0, e.t); s.t1 = Math.max(s.t1, e.t); if (e.type === "join") s.joins++; if (Number.isFinite(e.n)) s.peak = Math.max(s.peak, e.n); if (e.type === "server_end") { s.ended = true; if (e.peak) s.peak = Math.max(s.peak, e.peak) } } });
  Object.values(bt).forEach(b => { if (!b.job) return; const s = srv[b.job] || (srv[b.job] = { job: b.job.slice(0, 8), t0: b.t - (b.up || 0), t1: b.t, peak: 0, joins: 0, v: b.v }); s.t1 = Math.max(s.t1, b.t); if (Number.isFinite(b.n)) s.peak = Math.max(s.peak, b.n) });
  // une entrée sans sortie : en cours si son serveur bat encore (battement de moins de 5 min), sinon sa sortie s'est
  // perdue (serveur arrêté avant d'envoyer, journée hors fenêtre) : close à la dernière activité du serveur, durée
  // estimée (est). Avant, ces sessions restaient « en cours » pour toujours et faussaient les pourcentages
  const nowS = Math.floor(Date.now() / 1000);
  Object.values(open).forEach(o => { const b = bt[o.jf], s = srv[o.jf];
    if (b && nowS - b.t < 300) sess.push({ ...o, live: true });
    else { const end = Math.max(o.t, s ? s.t1 : o.t, b ? b.t : o.t); sess.push({ ...o, dur: end - o.t, end, est: true }) } });
  // sessions du propriétaire et de l'équipe (phase staff, depuis la v887) : hors des stats ; encore en jeu, elles restent
  // dans les joueurs en ligne
  let staff = 0; for (let i = sess.length - 1; i >= 0; i--) if (sess[i].ph && sess[i].ph.staff != null && !sess[i].live) { sess.splice(i, 1); staff++ }
  const vOf = s => srv[Object.keys(srv).find(j => j.startsWith(s.job))]?.v, latest = Math.max(0, ...Object.values(srv).map(s => s.v || 0));
  // filtre par version (?v=887, ?from=873, ?to=) : en mémoire, sur les sessions déjà construites (aucune lecture en
  // plus) ; le tableau des versions, les serveurs, l'affluence et les joueurs en ligne restent complets
  const int = x => /^\d{1,6}$/.test(String(x ?? "")) ? +x : null, q = req.query || {};
  const fv = int(q.v), ff = fv ?? int(q.from), ft = fv ?? int(q.to), filtered = ff != null || ft != null;
  const all = sess, fs = filtered ? sess.filter(s => { const v = vOf(s); return v != null && (ff == null || v >= ff) && (ft == null || v <= ft) }) : sess;
  const fk = new Set(fs.map(s => s.k));
  const done = fs.filter(s => Number.isFinite(s.dur)), durs = done.map(s => s.dur);
  const tracked = done.filter(s => s.ph && Object.keys(s.ph).length), withPlay = done.filter(s => Number.isFinite(s.ph && s.ph.play)), playDurs = withPlay.map(s => Math.max(0, s.dur - s.ph.play)), loads = fs.map(s => s.ph && s.ph.loaded).filter(Number.isFinite);
  // phases de la dernière version publiée (le suivi du tutoriel, du lobby et des manches en dépend) : combien de sessions
  // atteignent chaque phase, en combien de secondes, et la dernière phase vue avant de quitter
  // la dernière version, et les précédentes tant qu'il y a moins de PH_MIN sessions (une version neuve à 1 joueur
  // affichait 100 % partout, Alane 21/10)
  // (filtre actif : exactement les sessions filtrées)
  const PH_MIN = 30, byV = {}; fs.forEach(s => { const v = vOf(s); if (v) (byV[v] = byV[v] || []).push(s) });
  const vs = []; let lv = []; Object.keys(byV).map(Number).sort((a, b) => b - a).forEach(v => { if (filtered || lv.length < PH_MIN) { vs.push(v); lv = lv.concat(byV[v]) } });
  const PH = {};
  lv.forEach(s => Object.entries(s.ph || {}).forEach(([n, dt]) => (PH[n] = PH[n] || []).push(dt)));
  const phases = { v: (filtered ? (vs.length ? Math.max(...vs) : null) : latest) || null, vFrom: vs.length ? Math.min(...vs) : null, sessions: lv.length, steps: Object.entries(PH).map(([name, a]) => ({ name, n: a.length, medDt: med(a.map(x => Math.round(x))) })).sort((a, b) => b.n - a.n),
    leftAfter: Object.entries(lv.filter(s => !s.live && s.last).reduce((o, s) => (o[s.last] = (o[s.last] || 0) + 1, o), {})).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
  // versions publiées : comparer chaque publication à la précédente (durée, manche jouée, sessions longues)
  const versions = Object.entries(all.reduce((o, s) => { const v = vOf(s); if (v) (o[v] = o[v] || []).push(s); return o }, {})).map(([v, a]) => { const d = a.filter(s => Number.isFinite(s.dur)); return { v: +v, sessions: a.length, t0: Math.min(...a.map(s => s.t)), srvT0: Math.min(...Object.values(srv).filter(x => x.v === +v).map(x => x.t0)), medianSec: med(d.map(s => s.dur)), avgSec: avg(d.map(s => s.dur)), playPct: Math.round(a.filter(s => s.ph && s.ph.play != null).length / a.length * 100), over5Pct: d.length ? Math.round(d.filter(s => s.dur >= 300).length / d.length * 100) : null, over10Pct: d.length ? Math.round(d.filter(s => s.dur >= 600).length / d.length * 100) : null, bounce: d.length ? Math.round(d.filter(s => s.dur < 30).length / d.length * 100) : null, leftBeforePlay: (() => { const t = d.filter(s => s.ph && Object.keys(s.ph).length); return t.length ? Math.round(t.filter(s => !Number.isFinite(s.ph.play)).length / t.length * 100) : null })() } }).sort((a, b) => b.v - a.v);
  const stats = sessionStats(fs, dev, vOf);
  // matchmaking : relevés du jour où au moins 2 serveurs publics n'avaient qu'1 joueur (Roblox a séparé des joueurs seuls)
  const today = samples.filter(x => x.t >= Date.parse(days[1] + "T00:00:00Z") / 1000), splitS = today.filter(x => x.s.filter(y => y.n === 1).length >= 2);
  const split = { samples: today.length, splitSamples: splitS.length, lastAt: splitS.length ? splitS[splitS.length - 1].t : null, maxAlone: Math.max(0, ...today.map(x => x.s.filter(y => y.n === 1).length)) };
  // joueurs en ligne, ANONYMES : code haché court, état, appareil, pays, tranche d'âge du compte, chronologie. Jamais de
  // pseudo, d'identifiant, d'avatar ni de position
  const now = Math.floor(Date.now() / 1000), acctB = a => !Number.isFinite(a) ? null : a < 30 ? "<30 j" : a < 365 ? "30-365 j" : a < 1095 ? "1-3 ans" : "3 ans+";
  // historique de chaque joueur sur les jours lus (code haché p) : visite n° et temps depuis sa dernière sortie
  const past = {}; ev.forEach(e => { if (!e.p || (e.type !== "join" && e.type !== "leave")) return; const h = past[e.p] || (past[e.p] = { joins: [], ends: [] }); (e.type === "join" ? h.joins : h.ends).push(e.t) });
  const histOf = o => { const h = past[o.pFull || o.p]; if (!h) return { visitNo: 1, gapSec: null }; const pe = Math.max(-Infinity, ...h.ends.filter(t => t < o.t)); return { visitNo: h.joins.filter(t => t <= o.t).length || 1, gapSec: Number.isFinite(pe) ? o.t - pe : null } };
  const online = Object.entries(open).filter(([, o]) => { const b = bt[o.jf]; return b && now - b.t < 180 }).map(([k, o]) => { const b = bt[o.jf], pl = b.pl && b.pl[o.uid] || {}, c = dev[k] || {};
    return { p: o.p, ...histOf(o), v: b.v, job: o.job, srvUp: Number.isFinite(b.up) ? b.up : null, srvN: Number.isFinite(b.n) ? b.n : null, state: pl.ph || o.last || null, idle: pl.idle ?? null, dev: c.dev || null, inp: c.inp || null, reg: o.reg || null, acct: acctB(o.acct), sec: now - o.t, seq: o.seq } }).sort((a, b) => a.sec - b.sec);
  const cnt = (a, f) => { const o = {}; a.forEach(x => { const k = f(x) || "inconnu"; o[k] = (o[k] || 0) + 1 }); return Object.entries(o).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
  const devices = cnt(Object.entries(dev).filter(([k]) => !filtered || fk.has(k)).map(([, e]) => e), e => e.dev);
  res.setHeader("cache-control", "s-maxage=20, stale-while-revalidate=60"); // lecture incrémentale : recalculer coûte peu
  res.status(200).json({ at: new Date().toISOString(), days,
    fresh: { event: ev.length ? ev[ev.length - 1].t : null, sample: samples.length ? samples[samples.length - 1].t : null, beat: Object.values(bt).reduce((m, b) => Math.max(m, b.t || 0), 0) || null },
    filter: filtered ? { v: fv, from: ff, to: ft, sessions: fs.length } : null,
    totals: { staffExcluded: staff, sessions: fs.length, players: filtered ? new Set(fs.map(s => s.p)).size : new Set(ev.filter(e => e.type === "join").map(e => e.p)).size, medianSec: med(durs), avgSec: avg(durs), durBuckets: durBuckets(durs), over5Pct: durs.length ? +(durs.filter(x => x >= 300).length / durs.length * 100).toFixed(1) : null, over10Pct: durs.length ? +(durs.filter(x => x >= 600).length / durs.length * 100).toFixed(1) : null, medianPlaySec: med(playDurs), firstPlaySec: med(withPlay.map(s => Math.round(s.ph.play))), medianLoadSec: loads.length ? +(med(loads.map(x => Math.round(x * 10))) / 10).toFixed(1) : null, leftBeforePlay: tracked.length ? +((tracked.filter(s => !Number.isFinite(s.ph.play)).length) / tracked.length * 100).toFixed(1) : null, neverMoved: tracked.length ? +(tracked.filter(s => s.ph.move == null).length / tracked.length * 100).toFixed(1) : null, bounce: done.length ? +(done.filter(s => s.dur < 30).length / done.length * 100).toFixed(1) : null,
      premium: fs.length ? +(fs.filter(s => s.prem).length / fs.length * 100).toFixed(1) : null, newAccounts: fs.length ? +(fs.filter(s => Number.isFinite(s.acct) && s.acct < 30).length / fs.length * 100).toFixed(1) : null, deaths: filtered ? fs.reduce((a, s) => a + (s.deaths || 0), 0) : ev.filter(e => e.type === "death").length, purchases: filtered ? fs.reduce((a, s) => a + (s.buys || 0), 0) : ev.filter(e => e.type === "purchase" && e.ok).length },
    flow, servers: Object.values(srv).sort((a, b) => b.t0 - a.t0).slice(0, 50).map(s => ({ ...s, lifeSec: s.t1 - s.t0 })),
    sessions: [...fs].sort((a, b) => b.t - a.t).slice(0, 100).map(s => ({ p: s.p, job: s.job, t: s.t, dur: s.dur, reg: s.reg, acct: s.acct, prem: !!s.prem, src: s.src, deaths: s.deaths, live: !!s.live, load: s.ph && s.ph.loaded != null ? s.ph.loaded : null, spawn: s.ph && s.ph.spawn != null ? s.ph.spawn : null, move: s.ph && s.ph.move != null ? s.ph.move : null, play: s.ph && s.ph.play != null ? s.ph.play : null })),
    phases, versions, stats, split, online, regions: cnt(fs, s => s.reg), devices, sources: cnt(fs, s => s.src) });
}
