// One-off: rank candidate stocks by how much real activity they show this week (used to pick the demo portfolio).
import { getAnnouncements, getPrices, getCompany } from "../src/lib/screener";
import { classify } from "../src/lib/triage";

const CANDIDATES = process.argv.slice(2);
(async () => {
  for (const s of CANDIDATES) {
    try {
      const c = await getCompany(s);
      const [anns, px] = [await getAnnouncements(c.screenerId, c.symbol, c.name), await getPrices(c.screenerId, 40)];
      const week = anns.filter((a) => Date.now() - Date.parse(a.date) < 7 * 864e5);
      const cats = week.map((a) => { const k = classify(a); return k ? `${k.category}:${k.score}` : "LLM?"; });
      const last = px.at(-1)!, prev = px.at(-2)!;
      const avgV = px.slice(-21, -1).reduce((s, p) => s + p.v, 0) / 20;
      const mx = px.slice(-6).map((p, i, a) => (i ? Math.abs(p.c / a[i - 1].c - 1) * 100 : 0)).reduce((a, b) => Math.max(a, b));
      const mv = Math.max(...px.slice(-5).map((p) => p.v / avgV));
      console.log(`${s.padEnd(11)}|${c.isBank ? "BANK" : c.basis.slice(0, 4)}|Q:${c.quarters?.headers.at(-1)}|cc:${c.concalls.filter((x) => x.transcript).length}|${c.ratios["Market Cap"]}|d1:${((last.c / prev.c - 1) * 100).toFixed(1)}% max5d:${mx.toFixed(1)}% vol5d:${mv.toFixed(1)}x| ${cats.join(", ")}`);
    } catch (e) { console.log(s, "ERR", (e as Error).message); }
  }
})();
