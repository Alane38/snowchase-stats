// Export ANONYMISÉ d'une journée pour l'archive publique (branche data). Protégé par Authorization: Bearer CRON_SECRET.
// Jamais de pseudo, d'identifiant, de nom affiché ni de position : seulement le code haché du joueur, des durées et des tranches.
import { ready, readEvents, readSamples } from "./_db.js";
const acct = a => !Number.isFinite(a) ? null : a < 30 ? "<30j" : a < 365 ? "30-365j" : a < 1095 ? "1-3 ans" : "3 ans+";
const keep = e => {
  const o = { t: e.t, type: e.type, job: e.job, v: e.v, n: e.n, p: e.p ? e.p.slice(0, 12) : undefined };
  if (e.type === "join" || e.type === "leave") Object.assign(o, { dur: e.dur, src: e.src, reg: e.reg, acct: acct(e.acct), prem: e.prem, srv: e.srv });
  else if (e.type === "phase") Object.assign(o, { ph: e.ph, dt: e.dt });
  else if (e.type === "death") o.dur = e.dur;
  else if (e.type === "purchase") Object.assign(o, { kind: e.kind, id: e.id, ok: e.ok });
  else if (e.type === "client") Object.assign(o, { dev: e.dev, inp: e.inp, w: e.w, h: e.h, fpsc: e.fpsc });
  else if (e.type === "server_start" || e.type === "server_end") Object.assign(o, { up: e.up, peak: e.peak, max: e.max, srv: e.srv });
  return o;
};
export default async function handler(req, res) {
  const sec = process.env.CRON_SECRET;
  if (!sec || req.headers.authorization !== "Bearer " + sec) return res.status(401).end();
  if (!ready()) return res.status(503).json({ error: "base non configurée" });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || "") ? req.query.day : null;
  if (!d) return res.status(400).json({ error: "day=AAAA-MM-JJ requis" });
  let ev, sm;
  try { [ev, sm] = await Promise.all([readEvents([d]), readSamples([d])]) } catch { return res.status(502).json({ error: "base indisponible" }) }
  ev.sort((a, b) => a.t - b.t);
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ day: d, note: "anonymisé : pas de pseudo, d'identifiant, de position", events: ev.filter(e => e.type !== "beat").map(keep), samples: sm });
}
