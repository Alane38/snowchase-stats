// Reçoit les événements du logger Luau. Stocke un blob par lot : sessions/AAAA-MM-JJ/<ts>-<rand>.json
// Variables Vercel : INGEST_KEY (secret partagé avec le script), SALT (sel du hachage), BLOB_READ_WRITE_TOKEN (auto, via le store Blob)
import { put } from "@vercel/blob";
import { createHmac, timingSafeEqual } from "node:crypto";
const ok = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y) };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.INGEST_KEY || !ok(req.headers["x-key"] || "", process.env.INGEST_KEY)) return res.status(401).end();
  const ev = (req.body && req.body.events) || [];
  if (!Array.isArray(ev) || !ev.length || ev.length > 50) return res.status(400).end();
  const hash = u => createHmac("sha256", process.env.SALT || "").update(String(u)).digest("hex").slice(0, 12);
  const clean = ev.filter(e => e && (e.type === "join" || e.type === "leave") && Number.isFinite(e.t)).map(e => ({
    t: e.t, type: e.type, job: String(e.job || "").slice(0, 40), p: hash(e.uid),
    n: Number.isFinite(e.n) ? e.n : null, dur: Number.isFinite(e.dur) ? e.dur : null,
    src: e.src === "teleport" ? "teleport" : "direct", v: Number.isFinite(e.v) ? e.v : null, acct: Number.isFinite(e.acct) ? e.acct : null }));
  if (!clean.length) return res.status(400).end();
  const d = new Date().toISOString().slice(0, 10);
  await put(`sessions/${d}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify(clean), { access: "public", addRandomSuffix: false, contentType: "application/json" });
  res.status(200).json({ stored: clean.length });
}
