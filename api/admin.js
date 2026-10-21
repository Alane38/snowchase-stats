// Vue privée des données collectées (pseudos en clair). Protégée par ?k=CRON_SECRET. Jamais liée depuis le site public.
// ?day=AAAA-MM-JJ (défaut : aujourd'hui, UTC) ; renvoie les comptes par type d'événement et les derniers événements.
import { list, get } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) };
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
  const key = req.headers["x-key"] || req.query.k || "";
  if (!process.env.CRON_SECRET || !same(key, process.env.CRON_SECRET)) return res.status(401).end();
  if (req.query.view === "live") return live(req, res);
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

// ---- Vue « En direct » (privée) : joueurs présents avec tête, état détaillé, historique par joueur ----
async function heads(ids) {
  const out = {}; if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 50) {
    try { const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.slice(i, i + 50).join(",")}&size=150x150&format=Png&isCircular=false`); if (r.ok) (await r.json()).data.forEach(x => { if (x.imageUrl) out[x.targetId] = x.imageUrl }) } catch {}
  } return out;
}
async function live(req, res) {
  const days = Math.min(7, Math.max(1, +req.query.days || 2)), ds = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)), ev = [];
  for (const d of ds) ev.push(...(await readAll(`sessions/${d}/`, 500)).rows);
  ev.sort((a, b) => a.t - b.t);
  const now = Math.floor(Date.now() / 1000), open = {}, last = {}, beat = {}, sessions = [], who = {}, dev = {};
  ev.forEach(e => { const k = e.job + "|" + e.uid; if (e.job) last[e.job] = Math.max(last[e.job] || 0, e.t);
    if (e.type === "client") dev[e.uid] = { dev: e.dev, w: e.w, h: e.h, inp: e.inp, fpsc: e.fpsc };
    if (e.type === "beat") beat[e.job] = e;
    if (e.type === "server_end") delete last[e.job];
    if (e.type === "join") { open[k] = { uid: e.uid, name: e.name, dn: e.dn, job: e.job, v: e.v, since: e.t, reg: e.reg, acct: e.acct, prem: e.prem, src: e.src, deaths: 0, phs: [] }; const w = who[e.uid] || (who[e.uid] = { uid: e.uid, name: e.name, dn: e.dn, visits: 0, sec: 0, first: e.t, last: e.t, deaths: 0, buys: 0 }); w.visits++; w.first = Math.min(w.first, e.t); w.last = Math.max(w.last, e.t); w.name = e.name; w.dn = e.dn || w.dn }
    else if (e.type === "leave") { const o = open[k]; const w = who[e.uid]; if (w && Number.isFinite(e.dur)) { w.sec += e.dur; w.last = Math.max(w.last, e.t) } sessions.push({ uid: e.uid, name: e.name, job: (e.job || "").slice(0, 8), t: e.t - (e.dur || 0), dur: e.dur, deaths: o ? o.deaths : 0, reg: o && o.reg, acct: o && o.acct, prem: o && o.prem, src: o && o.src, phs: o ? o.phs : [] }); delete open[k] }
    else if (e.type === "phase") { if (open[k] && open[k].phs.length < 30) open[k].phs.push({ ph: e.ph, dt: e.dt }) }
    else if (e.type === "death") { if (open[k]) open[k].deaths++; if (who[e.uid]) who[e.uid].deaths++ }
    else if (e.type === "purchase" && e.ok && who[e.uid]) who[e.uid].buys++ });
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
