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
// toute la journée, par paquets de 3 000 (une réponse par appel reste sous la taille maximale d'Upstash) ; avant, seuls les
// 4 000 derniers événements étaient lus et le matin d'une journée chargée manquait à l'archive et aux vues.
// Mémoire de l'instance (Vercel la garde chaude entre deux appels rapprochés) : une liste ne fait que grandir par la fin,
// donc seuls les événements ajoutés depuis la dernière lecture sont relus (LLEN + la suite), et un jour passé n'est lu
// qu'une fois. Les vues gardent leur rythme (30-60 s) pour une fraction de la bande passante (3 Go en 2 jours, 21/10).
const PAGE = 3000, MAX_DAY = 60000, memo = new Map(); // "ev:AAAA-MM-JJ" -> { n: éléments lus, items }
export async function readEvents(days) {
  const today = day(), need = days.filter(d => d === today || !memo.has("ev:" + d));
  const lens = need.length ? await pipe(need.map(d => ["LLEN", "ev:" + d])) : [];
  const out = [];
  for (const d of days) {
    const key = "ev:" + d, i = need.indexOf(d);
    let m = memo.get(key);
    if (i >= 0) {
      const n = lens[i] || 0;
      if (!m || m.n > n) m = { n: Math.max(0, n - MAX_DAY), items: [] }; // première lecture, ou liste expirée et recréée
      for (let from = m.n; from < n; from += PAGE) m.items.push(...parse((await pipe([["LRANGE", key, String(from), String(Math.min(from + PAGE, n) - 1)]]))[0]));
      m.n = n;
      if (m.items.length > MAX_DAY) m.items.splice(0, m.items.length - MAX_DAY);
      memo.set(key, m);
    }
    if (m) out.push(...m.items);
  }
  for (const k of memo.keys()) if (k < "ev:" + day(10)) memo.delete(k); // pas plus de 10 jours en mémoire
  return out;
}
export const readPos = async days => (await pipe(days.map(d => ["LRANGE", "ps:" + d, "-1500", "-1"]))).flatMap(parse);
export const readSamples = async days => (await pipe(days.map(d => ["LRANGE", "sm:" + d, "-1500", "-1"]))).flatMap(parse);
export async function readBeats() {
  const k = await cmd("KEYS", "beat:*"); if (!k.length) return {};
  const v = await cmd("MGET", ...k), o = {};
  k.forEach((key, i) => { try { o[key.slice(5)] = JSON.parse(v[i]) } catch {} });
  return o;
}
