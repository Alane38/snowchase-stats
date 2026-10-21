// Vue privée des données collectées (pseudos en clair). Protégée par ?k=CRON_SECRET. Jamais liée depuis le site public.
// ?day=AAAA-MM-JJ (défaut : aujourd'hui, UTC) ; renvoie les comptes par type d'événement et les derniers événements.
import { ready, pipe, readEvents, readSamples, readBeats, day } from "./_db.js";
import { timingSafeEqual } from "node:crypto";
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) };
export default async function handler(req, res) {
  const key = req.headers["x-key"] || req.query.k || "";
  if (!process.env.CRON_SECRET || !same(key, process.env.CRON_SECRET)) return res.status(401).end();
  if (!ready()) return res.status(503).json({ error: "base non configurée : ajoute l'intégration Upstash Redis au projet Vercel" });
  if (req.query.view === "live") return live(req, res);
  if (req.query.view === "migrate") return migrate(res);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || "") ? req.query.day : day();
  const [rows, sm, bt] = await Promise.all([readEvents([d]), readSamples([d]), readBeats()]);
  const by = {}; rows.forEach(e => by[e.type] = (by[e.type] || 0) + 1);
  rows.sort((a, b) => a.t - b.t);
  const beats = Object.values(bt).sort((a, b) => a.t - b.t);
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ day: d, events: rows.length, eventsByType: by,
    players: [...new Set(rows.filter(e => e.type === "join").map(e => e.name))],
    lastEvents: rows.slice(-30), lastBeat: beats.slice(-1)[0] || null, beatServers: beats.length,
    serverSamples: sm.length, lastSample: sm.slice(-1)[0] || null });
}

// ---- Vue « En direct » (privée) : joueurs présents avec tête, état détaillé, historique par joueur ----
async function heads(ids) {
  const out = {}; if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 50) {
    try { const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.slice(i, i + 50).join(",")}&size=150x150&format=Png&isCircular=false`); if (r.ok) (await r.json()).data.forEach(x => { if (x.imageUrl) out[x.targetId] = x.imageUrl }) } catch {}
  } return out;
}
async function live(req, res) {
  const days = Math.min(7, Math.max(1, +req.query.days || 2)), ds = Array.from({ length: days }, (_, i) => day(i));
  const [ev, bt] = await Promise.all([readEvents(ds), readBeats()]);
  ev.sort((a, b) => a.t - b.t);
  const now = Math.floor(Date.now() / 1000), open = {}, last = {}, beat = bt, sessions = [], who = {}, dev = {};
  ev.forEach(e => { const k = e.job + "|" + e.uid; if (e.job) last[e.job] = Math.max(last[e.job] || 0, e.t);
    if (e.type === "client") dev[e.uid] = { dev: e.dev, w: e.w, h: e.h, inp: e.inp, fpsc: e.fpsc };
    if (e.type === "server_end") delete last[e.job];
    if (e.type === "join") { open[k] = { uid: e.uid, name: e.name, dn: e.dn, job: e.job, v: e.v, since: e.t, reg: e.reg, acct: e.acct, prem: e.prem, src: e.src, deaths: 0, phs: [] }; const w = who[e.uid] || (who[e.uid] = { uid: e.uid, name: e.name, dn: e.dn, visits: 0, sec: 0, first: e.t, last: e.t, deaths: 0, buys: 0 }); w.visits++; w.first = Math.min(w.first, e.t); w.last = Math.max(w.last, e.t); w.name = e.name; w.dn = e.dn || w.dn }
    else if (e.type === "leave") { const o = open[k]; const w = who[e.uid]; if (w && Number.isFinite(e.dur)) { w.sec += e.dur; w.last = Math.max(w.last, e.t) } sessions.push({ uid: e.uid, name: e.name, job: (e.job || "").slice(0, 8), t: e.t - (e.dur || 0), dur: e.dur, deaths: o ? o.deaths : 0, reg: o && o.reg, acct: o && o.acct, prem: o && o.prem, src: o && o.src, phs: o ? o.phs : [] }); delete open[k] }
    else if (e.type === "phase") { if (open[k] && open[k].phs.length < 60) open[k].phs.push({ ph: e.ph, dt: e.dt }) }
    else if (e.type === "death") { if (open[k]) open[k].deaths++; if (who[e.uid]) who[e.uid].deaths++ }
    else if (e.type === "purchase" && e.ok && who[e.uid]) who[e.uid].buys++ });
  Object.values(bt).forEach(b => { if (b.job) last[b.job] = Math.max(last[b.job] || 0, b.t) });
  const alive = Object.keys(last).filter(j => now - last[j] < 180);
  const online = Object.values(open).filter(o => alive.includes(o.job)).map(o => { const b = beat[o.job], p = b && b.pl && b.pl[o.uid] || {}; return { ...o, ...p, ...(dev[o.uid] || {}), ls: p.ls || null } });
  const ids = [...new Set([...online.map(o => o.uid), ...sessions.slice(-30).map(s => s.uid), ...Object.values(who).sort((a, b) => b.last - a.last).slice(0, 40).map(w => w.uid)])].filter(Number.isFinite);
  const img = await heads(ids);
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ at: now, days: ds,
    servers: alive.map(j => { const b = beat[j]; return { job: j.slice(0, 8), v: b && b.v, n: b && b.n, fps: b && b.fps, mem: b && b.mem, up: b && b.up, last: last[j] } }),
    online: online.map(o => ({ ...o, head: img[o.uid] || null })),
    recent: sessions.slice(-30).reverse().map(s => ({ ...s, head: img[s.uid] || null })),
    players: Object.values(who).sort((a, b) => b.last - a.last).slice(0, 40).map(w => ({ ...w, head: img[w.uid] || null })) });
}

// ---- Migration unique de l'ancien stockage Blob vers Redis (à lancer une seule fois : /api/admin?view=migrate) ----
async function migrate(res) {
  const { list, get } = await import("@vercel/blob"), A = process.env.BLOB_ACCESS || "private";
  const txt = async p => { try { const g = await get(p, { access: A }); return g && g.statusCode === 200 ? await new Response(g.stream).text() : null } catch { return null } };
  const all = async prefix => { const out = []; let cursor; do { const r = await list({ prefix, cursor, limit: 1000 }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined } while (cursor); return out };
  const ev = {}, sm = {}, beats = {}; let files = 0;
  const sess = await all("sessions/");
  for (let i = 0; i < sess.length; i += 10) await Promise.all(sess.slice(i, i + 10).map(async b => {
    const t = await txt(b.pathname); if (!t) return; files++; const d = b.pathname.split("/")[1];
    let rows; try { rows = JSON.parse(t) } catch { return } (Array.isArray(rows) ? rows : [rows]).forEach(e => { if (e.type === "beat") { if (e.job && (!beats[e.job] || beats[e.job].t < e.t)) beats[e.job] = e } else (ev[d] = ev[d] || []).push(e) }) }));
  const srv = await all("serveurs/");
  for (let i = 0; i < srv.length; i += 10) await Promise.all(srv.slice(i, i + 10).map(async b => {
    const t = await txt(b.pathname); if (!t) return; files++; const m = b.pathname.match(/serveurs\/(\d{4}-\d{2}-\d{2})/); if (!m) return;
    let rows; try { rows = JSON.parse(t) } catch { return } (Array.isArray(rows) ? rows : [rows]).forEach(e => (sm[m[1]] = sm[m[1]] || []).push(e)) }));
  const cmds = [];
  Object.entries(ev).forEach(([d, a]) => { a.sort((x, y) => x.t - y.t); for (let i = 0; i < a.length; i += 200) cmds.push(["RPUSH", "ev:" + d, ...a.slice(i, i + 200).map(e => JSON.stringify(e))]) });
  Object.entries(sm).forEach(([d, a]) => { a.sort((x, y) => x.t - y.t); for (let i = 0; i < a.length; i += 200) cmds.push(["RPUSH", "sm:" + d, ...a.slice(i, i + 200).map(e => JSON.stringify(e))]) });
  Object.values(beats).forEach(b => cmds.push(["SET", "beat:" + b.job, JSON.stringify(b), "EX", "172800"]));
  if (cmds.length) await pipe(cmds);
  res.status(200).json({ blobsLus: files, jours: Object.keys(ev), eventsParJour: Object.fromEntries(Object.entries(ev).map(([d, a]) => [d, a.length])), relevesParJour: Object.fromEntries(Object.entries(sm).map(([d, a]) => [d, a.length])), serveursAvecBattement: Object.keys(beats).length });
}
