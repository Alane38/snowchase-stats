// Statistiques de session tirées des phases déjà lues par /api/live (aucune commande Redis en plus) : fidélité par jour
// et par version, manches (victoires, précision, départ juste après une défaite), économie de flocons, effet des amis,
// appareils. Toujours anonyme : des comptes et des médianes, jamais un joueur.
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) };
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const paris = t => DAY.format(new Date(t * 1000)); // AAAA-MM-JJ à Paris
const RD = /^(rdb?)(\d+)_([wl])_(\d+)_(\d+)$/; // manche n : gagnée ou perdue, touches, lancers ; rdb = contre SnowBot
const QUIT_AFTER = 40; // secondes : un départ dans ce délai après la fin d'une manche compte comme « juste après »

export function sessionStats(sess, dev, vOf) {
  const all = sess.filter(s => s.ph && Object.keys(s.ph).length), has = (s, n) => s.ph[n] != null;
  const done = all.filter(s => !s.live && Number.isFinite(s.dur));

  // fidélité : nouveaux, revenus le jour même, le lendemain ; rétention J1 estimée = revenus le lendemain le jour J /
  // nouveaux le jour J-1 (les jours doivent se suivre)
  const D = {};
  all.forEach(s => { const d = paris(s.t), o = D[d] || (D[d] = { day: d, sessions: 0, newP: 0, d0: 0, d1: 0, d2_7: 0, d8p: 0 }); o.sessions++;
    if (has(s, "new_player")) o.newP++; if (has(s, "back_d0")) o.d0++; if (has(s, "back_d1")) o.d1++; if (has(s, "back_d2_7")) o.d2_7++; if (has(s, "back_d8p")) o.d8p++ });
  const days = Object.values(D).sort((a, b) => a.day < b.day ? -1 : 1);
  days.forEach((o, i) => { const p = days[i - 1], next = p && Date.parse(o.day) - Date.parse(p.day) === 864e5; o.prevNew = next ? p.newP : null; o.retD1 = next && p.newP ? pct(o.d1, p.newP) : null });
  const V = {};
  all.forEach(s => { const v = vOf(s); if (!v) return; const o = V[v] || (V[v] = { v, sessions: 0, newP: 0, d0: 0, d1: 0 }); o.sessions++; if (has(s, "new_player")) o.newP++; if (has(s, "back_d0")) o.d0++; if (has(s, "back_d1")) o.d1++ });

  // manches : le détail rd/rdb des 5 premières, sinon r1_won / r1_lost / r2 (versions plus anciennes)
  const first = { real: [0, 0], bot: [0, 0], any: [0, 0] }, after = { l: [0, 0], w: [0, 0] };
  let played = 0, second = 0, rounds = 0, hits = 0, throws = 0;
  all.forEach(s => {
    const seq = s.seq || [], rs = seq.map(x => ({ x, m: x.ph.match(RD) })).filter(y => y.m);
    let last = null;
    if (rs.length) {
      played++; if (rs.some(y => +y.m[2] >= 2)) second++;
      const f = rs.find(y => y.m[2] === "1");
      if (f) { const k = f.m[1] === "rdb" ? "bot" : "real"; first[k][0]++; first.any[0]++; if (f.m[3] === "w") { first[k][1]++; first.any[1]++ } }
      rs.forEach(y => { rounds++; hits += +y.m[4]; throws += +y.m[5] });
      last = { won: rs[rs.length - 1].m[3] === "w", dt: rs[rs.length - 1].x.dt };
    } else {
      const r1 = seq.find(x => x.ph === "r1_won" || x.ph === "r1_lost");
      if (!r1) return;
      played++; if (has(s, "r2")) second++;
      first.any[0]++; if (r1.ph === "r1_won") first.any[1]++;
      last = has(s, "r2") ? null : { won: r1.ph === "r1_won", dt: r1.dt };
    }
    if (last && !s.live && Number.isFinite(s.dur)) { const b = after[last.won ? "w" : "l"]; b[0]++; if (s.dur - last.dt <= QUIT_AFTER) b[1]++ }
  });
  const rate = a => ({ n: a[0], pct: pct(a[1], a[0]) });
  const roundsOut = { sessions: all.length, played, playedPct: pct(played, all.length), secondPct: pct(second, played),
    first: { real: rate(first.real), bot: rate(first.bot), any: rate(first.any) }, detailed: rounds,
    avgHits: rounds ? +(hits / rounds).toFixed(1) : null, avgThrows: rounds ? +(throws / rounds).toFixed(1) : null, accuracyPct: pct(hits, throws),
    quitAfterLoss: rate(after.l), quitAfterWin: rate(after.w), quitSeconds: QUIT_AFTER };

  // économie : flocons gagnés (paliers earn_), dépensés (spend_), boutique ouverte sans achat, achats par skin, roue
  const tracked = all.filter(s => Object.keys(s.ph).some(n => n.startsWith("earn_") || n.startsWith("spend_") || n === "open_shop" || n.startsWith("buy_")));
  const shop = all.filter(s => has(s, "open_shop")), bought = s => Object.keys(s.ph).some(n => (n.startsWith("buy_") && n !== "buy_refused") || n.startsWith("spend_"));
  const buys = {}; all.forEach(s => Object.keys(s.ph).forEach(n => { if (n.startsWith("buy_") && n !== "buy_refused") buys[n.slice(4)] = (buys[n.slice(4)] || 0) + 1 }));
  const earnBase = all.filter(s => Object.keys(s.ph).some(n => n.startsWith("earn_")) || has(s, "play")).length;
  const economy = { sessions: all.length, measured: tracked.length, earn: [50, 200, 500, 1000, 2000].map(t => ({ t, pct: pct(all.filter(s => has(s, "earn_" + t)).length, earnBase) })), earnBase,
    spendPct: pct(all.filter(s => has(s, "spend_1")).length, all.length), shopOpened: shop.length, shopNoBuy: shop.filter(s => !bought(s)).length,
    shopNoBuyPct: pct(shop.filter(s => !bought(s)).length, shop.length), refused: all.filter(s => has(s, "buy_refused")).length,
    wheel: all.filter(s => has(s, "wheel_spin")).length, buys: Object.entries(buys).map(([skin, n]) => ({ skin, n })).sort((a, b) => b.n - a.n) };

  // social : ami sur le serveur, chat ; l'effet d'un ami sur la durée et la manche jouée
  const grp = a => { const d = a.filter(s => !s.live && Number.isFinite(s.dur)); return { n: a.length, medianSec: med(d.map(s => s.dur)), playPct: pct(a.filter(s => has(s, "play")).length, a.length) } };
  const social = { sessions: all.length, friendPct: pct(all.filter(s => has(s, "with_friend")).length, all.length), chatPct: pct(all.filter(s => has(s, "chat")).length, all.length),
    withFriend: grp(all.filter(s => has(s, "with_friend"))), alone: grp(all.filter(s => !has(s, "with_friend"))) };

  // appareils : type d'appareil (événement client), FPS client, chargement, durée, manche ; les petits écrans à part
  const G = {};
  sess.forEach(s => { const c = dev[s.k]; if (!c) return; const small = c.dev === "mobile" && Number.isFinite(c.w) && Number.isFinite(c.h) && Math.min(c.w, c.h) < 360;
    [c.dev || "inconnu"].concat(small ? ["mobile_small"] : []).forEach(k => { const o = G[k] || (G[k] = { dev: k, n: 0, fps: [], load: [], dur: [], play: 0 }); o.n++;
      if (Number.isFinite(c.fpsc)) o.fps.push(c.fpsc); if (s.ph && Number.isFinite(s.ph.loaded)) o.load.push(Math.round(s.ph.loaded * 10)); if (!s.live && Number.isFinite(s.dur)) o.dur.push(s.dur); if (s.ph && s.ph.play != null) o.play++ }) });
  const devices = Object.values(G).map(o => ({ dev: o.dev, n: o.n, fps: med(o.fps), loadSec: o.load.length ? med(o.load) / 10 : null, medianSec: med(o.dur), playPct: pct(o.play, o.n) })).sort((a, b) => b.n - a.n);

  return { fidelity: { days, versions: Object.values(V).sort((a, b) => b.v - a.v) }, rounds: roundsOut, economy, social, devices };
}
