// Reçoit les événements du logger Luau et les range dans Redis (ev:AAAA-MM-JJ ; dernier battement de chaque serveur dans beat:<job>).
// Variables Vercel : INGEST_KEY, SALT (hachage), accès Upstash (KV_REST_API_URL, KV_REST_API_TOKEN).
// Les pseudos et userId sont stockés EN CLAIR dans la base : elle ne doit jamais être exposée publiquement.
import { ready, pipe, day } from "./_db.js";
import { createHmac, timingSafeEqual } from "node:crypto";
const ok = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) };
const num = v => Number.isFinite(v) ? v : null, str = (v, n) => typeof v === "string" ? v.slice(0, n) : null;
const scal = v => typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "string" ? v.slice(0, 40) : null;
const player = o => !o || typeof o !== "object" ? null : Object.fromEntries(Object.entries(o).slice(0, 30).map(([k, d]) => [k, !d || typeof d !== "object" ? null : {
  ...Object.fromEntries(["ping", "t", "hp", "mhp", "ws", "x", "y", "z", "idle"].map(f => [f, num(d[f])])), team: str(d.team, 40), ph: str(d.ph, 20),
  ls: d.ls && typeof d.ls === "object" ? Object.fromEntries(Object.entries(d.ls).slice(0, 20).map(([a, b]) => [a.slice(0, 30), scal(b)])) : null }]));
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.INGEST_KEY || !ok(req.headers["x-key"] || "", process.env.INGEST_KEY)) return res.status(401).end();
  if (!ready()) return res.status(503).json({ error: "base non configurée" }); // le logger garde ses événements en file et réessaie
  const ev = (req.body && req.body.events) || [];
  if (!Array.isArray(ev) || !ev.length || ev.length > 50) return res.status(400).end();
  const hash = u => createHmac("sha256", process.env.SALT || "").update(String(u)).digest("hex").slice(0, 12);
  const clean = ev.filter(e => e && ["join", "leave", "beat", "death", "purchase", "server_start", "server_end", "client", "phase"].includes(e.type) && Number.isFinite(e.t)).map(e => {
    const o = { t: e.t, type: e.type, job: str(e.job, 40), v: num(e.v), n: num(e.n) };
    if (["join", "leave"].includes(e.type)) Object.assign(o, { uid: num(e.uid), p: hash(e.uid), name: str(e.name, 40), dn: str(e.dn, 60), dur: num(e.dur),
      src: e.src === "teleport" ? "teleport" : "direct", from: num(e.from), acct: num(e.acct), prem: e.prem === true, loc: str(e.loc, 12), reg: str(e.reg, 4), srv: e.srv === "private" ? "private" : "public" });
    else if (e.type === "beat") { o.fps = num(e.fps); o.up = num(e.up); o.mem = num(e.mem); o.pl = player(e.pl) }
    else Object.assign(o, { uid: num(e.uid), p: e.uid != null ? hash(e.uid) : null, name: str(e.name, 40), dur: num(e.dur), x: num(e.x), y: num(e.y), z: num(e.z),
      up: num(e.up), peak: num(e.peak), max: num(e.max), srv: e.srv === "private" ? "private" : "public", kind: e.kind === "pass" ? "pass" : e.kind === "product" ? "product" : null,
      id: num(e.id), ok: e.ok === true, dev: str(e.dev, 12), w: num(e.w), h: num(e.h), inp: str(e.inp, 12), fpsc: num(e.fpsc), ph: str(e.ph, 20), dt: num(e.dt) })
    return o });
  if (!clean.length) return res.status(400).end();
  const rest = clean.filter(e => e.type !== "beat"), lastBeat = {};
  clean.filter(e => e.type === "beat" && e.job).forEach(b => { lastBeat[b.job] = b });
  const cmds = [];
  if (rest.length) cmds.push(["RPUSH", "ev:" + day(), ...rest.map(e => JSON.stringify(e))]);
  Object.values(lastBeat).forEach(b => cmds.push(["SET", "beat:" + b.job, JSON.stringify(b), "EX", "172800"]));
  if (cmds.length) await pipe(cmds);
  res.status(200).json({ stored: clean.length });
}
