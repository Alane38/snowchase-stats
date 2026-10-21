// Stockage Upstash Redis (REST) : remplace Vercel Blob, dont le plan gratuit ne permet que 2 000 écritures/listes par mois.
// Variables Vercel (ajoutées automatiquement par l'intégration Upstash) : KV_REST_API_URL et KV_REST_API_TOKEN
// (ou UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN).
// Clés : ev:AAAA-MM-JJ (liste d'événements), sm:AAAA-MM-JJ (relevés des serveurs publics), beat:<job> (dernier battement d'un serveur).
const U = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, T = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const ready = () => !!(U() && T());
export async function pipe(cmds) {
  const r = await fetch(U().replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { authorization: "Bearer " + T(), "content-type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("db " + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result });
}
export const cmd = async (...a) => (await pipe([a]))[0];
export const day = (off = 0) => new Date(Date.now() - off * 864e5).toISOString().slice(0, 10);
const parse = a => (a || []).map(s => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean);
export const readEvents = async days => (await pipe(days.map(d => ["LRANGE", "ev:" + d, "-4000", "-1"]))).flatMap(parse);
export const readPos = async days => (await pipe(days.map(d => ["LRANGE", "ps:" + d, "-1500", "-1"]))).flatMap(parse);
export const readSamples = async days => (await pipe(days.map(d => ["LRANGE", "sm:" + d, "-1500", "-1"]))).flatMap(parse);
export async function readBeats() {
  const k = await cmd("KEYS", "beat:*"); if (!k.length) return {};
  const v = await cmd("MGET", ...k), o = {};
  k.forEach((key, i) => { try { o[key.slice(5)] = JSON.parse(v[i]) } catch {} });
  return o;
}
