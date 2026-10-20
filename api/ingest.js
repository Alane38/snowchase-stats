// Reçoit les événements du logger Luau. Stocke un blob par lot : sessions/AAAA-MM-JJ/<ts>-<rand>.json
// Variables Vercel : INGEST_KEY, SALT (hachage), BLOB_READ_WRITE_TOKEN (auto, via le store Blob), BLOB_ACCESS ("private" par défaut)
// Les pseudos et userId sont stockés EN CLAIR dans le Blob : le store doit être privé et ne jamais être exposé publiquement.
import { put } from "@vercel/blob";
import { createHmac, timingSafeEqual } from "node:crypto";
const ok = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) };
const num = v => Number.isFinite(v) ? v : null, str = (v, n) => typeof v === "string" ? v.slice(0, n) : null;
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.INGEST_KEY || !ok(req.headers["x-key"] || "", process.env.INGEST_KEY)) return res.status(401).end();
  const ev = (req.body && req.body.events) || [];
  if (!Array.isArray(ev) || !ev.length || ev.length > 50) return res.status(400).end();
  const hash = u => createHmac("sha256", process.env.SALT || "").update(String(u)).digest("hex").slice(0, 12);
  const clean = ev.filter(e => e && ["join", "leave", "beat"].includes(e.type) && Number.isFinite(e.t)).map(e => {
    const o = { t: e.t, type: e.type, job: str(e.job, 40), v: num(e.v), n: num(e.n) };
    if (e.type !== "beat") Object.assign(o, { uid: num(e.uid), p: hash(e.uid), name: str(e.name, 40), dn: str(e.dn, 60), dur: num(e.dur),
      src: e.src === "teleport" ? "teleport" : "direct", from: num(e.from), acct: num(e.acct), prem: e.prem === true, loc: str(e.loc, 12), reg: str(e.reg, 4), srv: e.srv === "private" ? "private" : "public" });
    else { o.fps = num(e.fps); o.up = num(e.up); o.pings = e.pings && typeof e.pings === "object" ? Object.fromEntries(Object.entries(e.pings).slice(0, 30).map(([k, x]) => [k, num(x)])) : null }
    return o });
  if (!clean.length) return res.status(400).end();
  const d = new Date().toISOString().slice(0, 10);
  await put(`sessions/${d}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify(clean), { access: process.env.BLOB_ACCESS || "private", addRandomSuffix: false, contentType: "application/json" });
  res.status(200).json({ stored: clean.length });
}
