// Statistiques de session tirées des phases déjà lues par /api/live (aucune commande Redis en plus) : fidélité par jour
// et par version, manches (victoires, précision, départ juste après une défaite), économie de flocons, effet des amis,
// appareils. Toujours anonyme : des comptes et des médianes, jamais un joueur.
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) };
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
// moyenne à côté de la médiane : Roblox affiche une moyenne, tirée vers le haut par ceux qui restent longtemps
export const avg = a => a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length) : null;
// durées des sessions terminées par tranche (secondes) : la forme de la distribution, que ni la médiane ni la moyenne ne montrent
export const DUR_BUCKETS = [["lt30", 0, 30], ["30_60", 30, 60], ["1_2", 60, 120], ["2_5", 120, 300], ["5_10", 300, 600], ["10p", 600, Infinity]];
export const durBuckets = a => DUR_BUCKETS.map(([k, lo, hi]) => { const n = a.filter(x => x >= lo && x < hi).length; return { k, n, pct: pct(n, a.length) } });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const paris = t => DAY.format(new Date(t * 1000)); // AAAA-MM-JJ à Paris
const RD = /^(rdb?)(\d+)_([wl])_(\d+)_(\d+)(?:_(\d+))?(?:_([gtcjo]))?$/; // + fois touché depuis le 22/10, + fin (g objectif, t temps, c annulée, j joueur arrivé dans un duel SnowBot, o départs) depuis la v901 ; // manche n : gagnée ou perdue, touches, lancers ; rdb = contre SnowBot
const QUIT_AFTER = 40; // secondes : un départ dans ce délai après la fin d'une manche compte comme « juste après »

export function sessionStats(sess, dev, vOf) {
  const all = sess.filter(s => s.ph && Object.keys(s.ph).length), has = (s, n) => s.ph[n] != null;
  // une mesure n'existe que depuis la version du jeu qui l'envoie : son dénominateur ne prend que les sessions de cette
  // version et des suivantes (avant, les sessions plus anciennes la faisaient paraître rare : 0 % d'amis, 12 % de manches)
  const since = test => { const vs = all.filter(s => Object.keys(s.ph).some(test)).map(vOf).filter(Boolean); if (!vs.length) return [];
    const v0 = Math.min(...vs); return all.filter(s => (vOf(s) || 0) >= v0) };
  const done = all.filter(s => !s.live && Number.isFinite(s.dur));

  // fidélité : nouveaux, revenus le jour même, le lendemain ; rétention J1 estimée = revenus le lendemain le jour J /
  // nouveaux le jour J-1 (les jours doivent se suivre)
  const D = {};
  all.forEach(s => { const d = paris(s.t), o = D[d] || (D[d] = { day: d, sessions: 0, newP: 0, d0: 0, d1: 0, d2_7: 0, d8p: 0 }); o.sessions++;
    if (Object.keys(s.ph).some(n => n === "new_player" || n.startsWith("back_d"))) o.classed = (o.classed || 0) + 1;
    if (has(s, "new_player")) o.newP++; if (has(s, "back_d0")) o.d0++; if (has(s, "back_d1")) o.d1++; if (has(s, "back_d2_7")) o.d2_7++; if (has(s, "back_d8p")) o.d8p++ });
  const days = Object.values(D).sort((a, b) => a.day < b.day ? -1 : 1);
  days.forEach((o, i) => { const p = days[i - 1], next = p && Date.parse(o.day) - Date.parse(p.day) === 864e5; o.prevNew = next ? p.newP : null; o.retD1 = next && p.newP ? pct(o.d1, p.newP) : null });
  const V = {};
  all.forEach(s => { const v = vOf(s); if (!v) return; const o = V[v] || (V[v] = { v, sessions: 0, newP: 0, d0: 0, d1: 0 }); o.sessions++; if (has(s, "new_player")) o.newP++; if (has(s, "back_d0")) o.d0++; if (has(s, "back_d1")) o.d1++ });

  // manches : le détail rd/rdb des 5 premières, sinon r1_won / r1_lost / r2 (versions plus anciennes)
  const first = { real: [0, 0], bot: [0, 0], any: [0, 0] }, after = { l: [0, 0], w: [0, 0], solo: [0, 0], group: [0, 0] };
  let cut = 0, played = 0, second = 0, rounds = 0, hits = 0, throws = 0, pro = 0, hitByN = 0, hitBy = 0, closedN = 0;
  const waits = [];
  all.forEach(s => {
    const seq = s.seq || [], rs = seq.map(x => ({ x, m: x.ph.match(RD) })).filter(y => y.m);
    let last = null;
    if (rs.length) {
      played++; if (rs.some(y => +y.m[2] >= 2)) second++;
      const f = rs.find(y => y.m[2] === "1");
      // une 1re manche coupée (duel SnowBot arrêté par l'arrivée d'un joueur, départs, annulation) n'est ni gagnée ni perdue
      if (f && f.m[7] && !"gt".includes(f.m[7])) cut++;
      else if (f) { const k = f.m[1] === "rdb" ? "bot" : "real"; first[k][0]++; first.any[0]++; if (f.m[3] === "w") { first[k][1]++; first.any[1]++ } }
      rs.forEach(y => { rounds++; hits += +y.m[4]; throws += +y.m[5]; if (y.m[6] != null) { hitByN++; hitBy += +y.m[6] } });
      // attente entre la fin d'une manche et le début de la suivante (rs<n>, depuis le 22/10)
      rs.forEach(y => { const nx = seq.find(x => x.ph === "rs" + (+y.m[2] + 1)); if (nx && Number.isFinite(nx.dt) && Number.isFinite(y.x.dt) && nx.dt >= y.x.dt) waits.push(nx.dt - y.x.dt) });
      if (has(s, "results_closed")) closedN++;
      last = { won: rs[rs.length - 1].m[3] === "w", dt: rs[rs.length - 1].x.dt };
    } else {
      const r1 = seq.find(x => x.ph === "r1_won" || x.ph === "r1_lost");
      if (!r1) return;
      played++; if (has(s, "r2")) second++;
      first.any[0]++; if (r1.ph === "r1_won") first.any[1]++;
      last = has(s, "r2") ? null : { won: r1.ph === "r1_won", dt: r1.dt };
    }
    if (has(s, "pro_on")) pro++;
    if (last && !s.live && Number.isFinite(s.dur)) {
      const quit = s.dur - last.dt <= QUIT_AFTER;
      // gagné / perdu, et seul au lobby ensuite (solo_after_round, depuis la v886) ou non
      [after[last.won ? "w" : "l"], after[has(s, "solo_after_round") ? "solo" : "group"]].forEach(b => { b[0]++; if (quit) b[1]++ });
    }
  });
  const rate = a => ({ n: a[0], pct: pct(a[1], a[0]) });
  const withPlay = all.filter(s => has(s, "play")).length; // entré dans une manche (étiquette du logger, toutes versions)
  const roundsOut = { sessions: all.length, played: withPlay, detailedSessions: played, playedPct: pct(withPlay, all.length), secondPct: pct(second, played),
    first: { real: rate(first.real), bot: rate(first.bot), any: rate(first.any), cut }, detailed: rounds,
    avgHits: rounds ? +(hits / rounds).toFixed(1) : null, avgThrows: rounds ? +(throws / rounds).toFixed(1) : null, accuracyPct: pct(hits, throws),
    quitAfterLoss: rate(after.l), quitAfterWin: rate(after.w), quitAfterSolo: rate(after.solo), quitAfterGroup: rate(after.group),
    proPct: (() => { const b = since(n => n === "pro_on" || n === "solo_after_round").filter(s => has(s, "play")); return b.length ? pct(b.filter(s => has(s, "pro_on")).length, b.length) : null })(), avgHitBy: hitByN ? +(hitBy / hitByN).toFixed(1) : null,
    waitMedianSec: waits.length ? waits.sort((a, b) => a - b)[waits.length >> 1] : null, waitN: waits.length, resultsClosedPct: since(n => n === "results_closed").length ? pct(closedN, played) : null,
    quitSeconds: QUIT_AFTER };

  // économie : flocons gagnés (paliers earn_), dépensés (spend_), boutique ouverte sans achat, achats par skin, roue
  const tracked = all.filter(s => Object.keys(s.ph).some(n => n.startsWith("earn_") || n.startsWith("spend_") || n === "open_shop" || n.startsWith("buy_")));
  const shop = all.filter(s => has(s, "open_shop")), bought = s => Object.keys(s.ph).some(n => (n.startsWith("buy_") && n !== "buy_refused") || n.startsWith("spend_"));
  const buys = {}; all.forEach(s => Object.keys(s.ph).forEach(n => { if (n.startsWith("buy_") && n !== "buy_refused") buys[n.slice(4)] = (buys[n.slice(4)] || 0) + 1 }));

  const ecoBase = since(n => n.startsWith("earn_") || n.startsWith("spend_"));
  const earnBase = ecoBase.length;
  const economy = { sessions: all.length, measured: tracked.length, base: ecoBase.length, earn: [50, 200, 500, 1000, 2000].map(t => ({ t, pct: pct(all.filter(s => has(s, "earn_" + t)).length, earnBase) })), earnBase,
    spendPct: pct(all.filter(s => has(s, "spend_1")).length, ecoBase.length), shopOpened: shop.length, shopNoBuy: shop.filter(s => !bought(s)).length,
    shopNoBuyPct: pct(shop.filter(s => !bought(s)).length, shop.length), refused: all.filter(s => has(s, "buy_refused")).length,
    wheel: all.filter(s => has(s, "wheel_spin")).length, buys: Object.entries(buys).map(([skin, n]) => ({ skin, n })).sort((a, b) => b.n - a.n) };

  // social : ami sur le serveur, chat ; l'effet d'un ami sur la durée et la manche jouée
  const grp = a => { const d = a.filter(s => !s.live && Number.isFinite(s.dur)); return { n: a.length, medianSec: med(d.map(s => s.dur)), avgSec: avg(d.map(s => s.dur)), playPct: pct(a.filter(s => has(s, "play")).length, a.length) } };
  const socBase = since(n => n === "with_friend" || n === "chat" || n.startsWith("earn_"));
  const social = { sessions: socBase.length, friendPct: pct(socBase.filter(s => has(s, "with_friend")).length, socBase.length), chatPct: pct(socBase.filter(s => has(s, "chat")).length, socBase.length),
    withFriend: grp(socBase.filter(s => has(s, "with_friend"))), alone: grp(socBase.filter(s => !has(s, "with_friend"))) };

  // appareils : type d'appareil (événement client), FPS client, chargement, durée, manche ; les petits écrans à part
  const G = {};
  sess.forEach(s => { const c = dev[s.k]; if (!c) return; const small = c.dev === "mobile" && Number.isFinite(c.w) && Number.isFinite(c.h) && Math.min(c.w, c.h) < 360;
    [c.dev || "inconnu"].concat(small ? ["mobile_small"] : []).forEach(k => { const o = G[k] || (G[k] = { dev: k, n: 0, fps: [], load: [], dur: [], play: 0 }); o.n++;
      if (Number.isFinite(c.fpsc)) o.fps.push(c.fpsc); if (s.ph && Number.isFinite(s.ph.loaded)) o.load.push(Math.round(s.ph.loaded * 10)); if (!s.live && Number.isFinite(s.dur)) o.dur.push(s.dur); if (s.ph && s.ph.play != null) o.play++ }) });
  const devices = Object.values(G).map(o => ({ dev: o.dev, n: o.n, fps: med(o.fps), loadSec: o.load.length ? med(o.load) / 10 : null, medianSec: med(o.dur), avgSec: avg(o.dur), playPct: pct(o.play, o.n) })).sort((a, b) => b.n - a.n);

  return { fidelity: { days, versions: Object.values(V).sort((a, b) => b.v - a.v) }, rounds: roundsOut, economy, social, devices };
}
