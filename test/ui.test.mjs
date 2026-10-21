// Tests de mise en page et de concision du site.
// Nécessite playwright (npm i -D playwright && npx playwright install chromium).
// Lancer : node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");
const parts = JSON.parse(fs.readFileSync(new URL("test/fixtures/parts.json", root), "utf8"));
const ads = fs.readFileSync(new URL("test/fixtures/ads.csv", root), "utf8");

const now = Math.floor(Date.now() / 1000);
const flow = Array.from({ length: 60 }, (_, i) => ({ t: Math.floor(now / 600) * 600 - 600 * (59 - i), avg: (i % 4) / 2, peak: 1 + (i % 5), servers: 1 + (i % 2), fps: 58, ping: 90 }));
const RANGE = { at: "x", heat: [], funnel: { sessions: 40, loaded: 38, spawn: 36, move: 22, play: 8, alone: 14, tuto: 6, stay30: 27 }, campaign: { sessions: 80, players: 61, played: 0, complete: true },
  pos: { snaps: 42, play: Array.from({ length: 60 }, (_, i) => [(i % 10) - 5, Math.floor(i / 10) - 3, 1 + (i * 7) % 20]), lobby: Array.from({ length: 60 }, (_, i) => [(i % 10) - 5, Math.floor(i / 10) - 3, 1 + (i * 7) % 20]) } };
const live = (servers, playing) => ({
  pub: { at: "2026-10-21T00:00:00Z", game: { data: [{ name: "Snow Chase", playing, visits: 4211, favoritedCount: 53, maxPlayers: 12, created: "2026-09-21T13:14:14Z", updated: "2026-10-20T09:23:34Z" }] }, votes: { data: [{ upVotes: 32, downVotes: 2 }] }, badges: [{ name: "Welcome", statistics: { awardedCount: 1074, winRatePercentage: 1 } }], servers: { data: servers }, passes: { gamePasses: [{ name: "VIP", price: 299, isForSale: true }] }, icon: { data: [] } },
  live: { at: "x", fresh: { event: now - 30, sample: now - 60, beat: now - 20 }, days: ["a", "b"], totals: { sessions: 23, players: 19, medianSec: 84, bounce: 39.1, premium: 8.7, newAccounts: 30.4, deaths: 41, purchases: 2 }, flow, servers: [], sessions: [], regions: [{ name: "US", n: 15 }], devices: [{ name: "mobile", n: 14 }], sources: [{ name: "direct", n: 20 }] },
});
const STATES = {
  "aucun serveur listé": live([], 1),
  "deux serveurs": live([{ id: "f8301d86-3612", playing: 7, maxPlayers: 12, fps: 59.9, ping: 24 }, { id: "a1b2c3d4-0000", playing: 3, maxPlayers: 12, fps: 40, ping: 80 }], 10),
};
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 820, height: 1000 }, { width: 1360, height: 900 }];
const TABS = ["apercu", "live", "joueurs", "pub", "jeu", "data"];

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(vp, st, scheme = "dark") {
  const pg = await browser.newPage({ viewport: vp, colorScheme: scheme });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/*", (route) => {
    const u = route.request().url(), j = (o) => route.fulfill({ body: JSON.stringify(o), contentType: "application/json" });
    if (u === "http://x/") return route.fulfill({ body: html, contentType: "text/html" });
    if (u.includes("ads-journal")) return route.fulfill({ body: ads, contentType: "text/plain" });
    if (u.includes("/api/snapshot")) return route.fulfill({ body: parts[+u.split("p=")[1]] || "", contentType: "text/plain", status: parts[+u.split("p=")[1]] ? 200 : 404 });
    if (u.includes("/api/range")) return j(RANGE);
    if (u.includes("/api/live")) return j(STATES[st].live);
    if (u.includes("/api/public")) return j(STATES[st].pub);
    return route.abort();
  });
  await pg.goto("http://x/");
  await pg.waitForTimeout(1200);
  pg.errs = errs;
  return pg;
}
const goTab = async (pg, t) => { await pg.click(`.nv[data-t=${t}]`); await pg.waitForTimeout(250); };

for (const [name] of Object.entries(STATES)) {
  test(`carte « en ligne » (${name}) : une ligne par texte et hauteur stable`, async () => {
    for (const vp of VIEWPORTS) {
      const pg = await open(vp, name);
      await goTab(pg, "live");
      const sizes = new Set();
      for (const age of [1, 8, 59, 95, 400, 4000]) {
        await pg.evaluate((a) => { S.liveAt = Date.now() - a * 1000; tick(); }, age);
        const m = await pg.evaluate(() => {
          const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.4; return { h: Math.round(b.height), lines: Math.round(b.height / lh), t: e.textContent }; };
          return { hero: r(".hero"), left: r(".hero > div"), bl: r(".hero .bl2"), nt: r(".hero .nt"), ago: r("#ago"), cd: r("#cd") };
        });
        assert.ok(m.hero, "carte absente");
        for (const k of ["bl", "nt", "ago"]) assert.ok(m[k].lines <= 1, `${name} @${vp.width}px : « ${m[k].t} » sur ${m[k].lines} lignes (age ${age} s)`);
        assert.ok(m.ago.t.length <= 40, `texte de fraîcheur trop long : ${m.ago.t}`);
        sizes.add(m.hero.h + "/" + m.left.h);
      }
      assert.equal(sizes.size, 1, `${name} @${vp.width}px : la hauteur de la carte change avec le temps (${[...sizes]})`);
      assert.deepEqual(pg.errs, []);
      await pg.close();
    }
  });
}

test("aucun débordement horizontal, sur tous les onglets et sous-onglets", async () => {
  for (const vp of VIEWPORTS) {
    const pg = await open(vp, "deux serveurs");
    for (const t of TABS) {
      await goTab(pg, t);
      const chips = await pg.$$eval("#view > .chips:first-child .chip", (c) => c.length);
      for (let i = 0; i < Math.max(chips, 1); i++) {
        if (chips) { await pg.evaluate((k) => document.querySelectorAll("#view > .chips:first-child .chip")[k]?.click(), i); await pg.waitForTimeout(150); }
        const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        assert.ok(o.sw <= o.iw + 1, `${t}#${i} @${vp.width}px : défilement horizontal (${o.sw} > ${o.iw})`);
      }
    }
    assert.deepEqual(pg.errs, []);
    await pg.close();
  }
});

test("textes concis : pas de paragraphe long, pas de sous-titre sur plus de 2 lignes", async () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const pg = await open(vp, "aucun serveur listé");
    for (const t of TABS) {
      await goTab(pg, t);
      const chips = await pg.$$eval("#view > .chips:first-child .chip", (c) => c.length);
      for (let i = 0; i < Math.max(chips, 1); i++) {
        if (chips) { await pg.evaluate((k) => document.querySelectorAll("#view > .chips:first-child .chip")[k]?.click(), i); await pg.waitForTimeout(150); }
        const bad = await pg.evaluate(() => {
          const out = [];
          const lim = [[".sub", 95, 2], [".es", 130, 3], [".vh span", 100, 2], [".vr .t", 40, 2], [".vr .x", 90, 3], ["#cd", 60, 1], [".ins li span", 115, 3]];
          for (const [q, max, maxLines] of lim) document.querySelectorAll(q).forEach((e) => {
            const n = e.textContent.trim().length, lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.4, lines = Math.round(e.getBoundingClientRect().height / lh);
            if (n > max) out.push(`${q} : ${n} car. > ${max} — « ${e.textContent.trim().slice(0, 60)}… »`);
            else if (lines > maxLines) out.push(`${q} : ${lines} lignes > ${maxLines} — « ${e.textContent.trim().slice(0, 60)}… »`);
          });
          return out;
        });
        assert.deepEqual(bad, [], `${t}#${i} @${vp.width}px`);
      }
    }
    await pg.close();
  }
});
