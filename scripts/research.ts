// Precompute research for the demo set (or any tickers passed): `npm run research -- DIXON TCS`
import { writeFile, mkdir } from "fs/promises";
import { research } from "../src/lib/research";
import { RESEARCH_DEMO } from "../src/data/portfolio";

(async () => {
  await mkdir("data/research", { recursive: true });
  for (const s of process.argv.length > 2 ? process.argv.slice(2) : RESEARCH_DEMO) {
    const t0 = Date.now();
    const r = await research(s, (m) => console.log(`  ${s}: ${m}`));
    await writeFile(`data/research/${r.symbol}.json`, JSON.stringify(r));
    const usd = r.cost.reduce((a, c) => a + c.usd, 0);
    console.log(`✓ ${s} in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${r.promises?.items.length ?? 0} promises (${r.promises?.dropped ?? 0} dropped by grounding) · score ${r.promises?.score ?? "–"} · $${usd.toFixed(4)}`);
  }
})();
