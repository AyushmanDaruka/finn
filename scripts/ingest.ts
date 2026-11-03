// Push pipeline: filings + EOD prices for the portfolio → data/digest.json.
// Runs after market close (GitHub Actions cron) or by hand: `npm run ingest`.
// Incremental: filings accumulate across runs and anything already enriched is never re-paid for.
import { readFile, writeFile, mkdir } from "fs/promises";
import { PORTFOLIO } from "../src/data/portfolio";
import { getAnnouncements, getCompany, getPrices, num, type CompanyData } from "../src/lib/screener";
import { classify, TIER_OF, type RawAnn } from "../src/lib/triage";
import { classifyBatch, management, resultsFromFiling, resultsFromTable } from "../src/lib/enrich";
import { hasKey, ledger, totalUsd } from "../src/lib/llm";
import type { Announcement, Digest } from "../src/lib/types";

const OUT = "data/digest.json";
const KEEP_DAYS = 30;

/** The quarter a results filing on `date` reports: the last quarter-end before it. */
function reportedQuarter(date: string) {
  const d = new Date(date);
  const qEnd = [2, 5, 8, 11].filter((m) => new Date(d.getFullYear(), m + 1, 0) < d).pop();
  return qEnd === undefined ? `Dec ${d.getFullYear() - 1}` : `${["Mar", "Jun", "Sep", "Dec"][[2, 5, 8, 11].indexOf(qEnd)]} ${d.getFullYear()}`;
}

async function main() {
  const prev: Digest | null = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
  const known = new Map<string, Announcement>((prev?.announcements ?? []).map((a) => [a.id, a]));
  const companies = new Map<string, CompanyData>();
  const holdings: Digest["holdings"] = [];
  const fresh: RawAnn[] = [];

  for (const h of PORTFOLIO) {
    try {
      const c = await getCompany(h.symbol);
      companies.set(h.symbol, c);
      holdings.push({ ...h, screenerId: c.screenerId, prices: await getPrices(c.screenerId, 120) });
      for (const a of await getAnnouncements(c.screenerId, h.symbol, h.name)) if (!known.has(a.id)) fresh.push(a);
      process.stdout.write(`✓ ${h.symbol} `);
    } catch (e) {
      console.warn(`\n✗ ${h.symbol}: ${(e as Error).message}`);
      const old = prev?.holdings.find((x) => x.symbol === h.symbol);
      if (old) holdings.push(old); // stale beats missing
    }
  }
  console.log(`\n${fresh.length} new filings`);

  // 1. Rules first (free). 2. Whatever rules can't place → one batched cheap-model call.
  const unsure: RawAnn[] = [];
  let byRules = 0;
  for (const a of fresh) {
    const mcapCr = num((companies.get(a.symbol)?.ratios["Market Cap"] ?? "").replace(/[^\d.]/g, "")) ?? undefined;
    const k = classify(a, { mcapCr });
    if (k) {
      known.set(a.id, { ...a, ...k });
      byRules++;
    } else unsure.push(a);
  }
  const llmOut = await classifyBatch(unsure).catch((e) => (console.warn("classify batch failed:", e.message), new Map()));
  for (const a of unsure) {
    const o = llmOut.get(a.id);
    known.set(a.id, o
      ? { ...a, category: o.category, score: o.score, tier: TIER_OF(o.score), classifiedBy: "llm", reason: "Read by model — rules were unsure", enrichment: { kind: "oneliner", text: o.line } }
      : { ...a, category: "press_release", score: 30, tier: "routine", classifiedBy: "llm", reason: "Rules unsure; model offline — unranked" });
  }

  // Drop old filings; fold repeat filings of one story (results + deck + press release) into one card.
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  let anns: Announcement[] = [...known.values()].filter((a) => Date.parse(a.date) > cutoff).map((a) => ({ ...a, related: undefined }));
  anns.sort((a, b) => b.score - a.score || Date.parse(b.date) - Date.parse(a.date));
  const merged: Announcement[] = [];
  for (const a of anns) {
    // Results cycles span ~2 weeks (notice → filing → deck → call); other stories ~3 days.
    const days = a.category === "results" ? 14 : 3;
    const lead = a.category !== "unclassified" &&
      merged.find((m) => m.symbol === a.symbol && m.category === a.category && Math.abs(Date.parse(m.date) - Date.parse(a.date)) < days * 864e5);
    if (lead) (lead.related ??= []).push({ title: a.title, url: a.url });
    else merged.push(a);
  }
  // A "board will consider results" notice is stale once the results themselves are out.
  for (const a of merged)
    if (a.category === "results" && /intimation/i.test(a.title) &&
        merged.some((r) => r.symbol === a.symbol && r.category === "results" && r.score >= 70 && Date.parse(r.date) > Date.parse(a.date))) {
      a.score = 10; a.tier = "routine"; a.reason = "Superseded — the results it announced are already out";
    }
  anns = merged;

  // Enrich only what earned attention, and only once.
  for (const a of anns.filter((x) => x.tier !== "routine")) {
    const c = companies.get(a.symbol);
    // What this item needs: a results card or a people card. A model one-liner alone doesn't count as done.
    const want = a.category === "results" && a.score >= 70 ? "results" : a.category === "management_change" ? "management" : null;
    const e = a.enrichment;
    if (!c || !want || (e?.kind === want && (e.kind !== "results" || e.source === "filing" || !hasKey()))) continue;
    if (a.category === "results" && a.score >= 70) {
      const q = reportedQuarter(a.date);
      const table = resultsFromTable(c, q);
      if (table?.quarter !== q) continue; // table not updated for this quarter yet — don't show a stale quarter
      // Read the statement itself, not the press release or deck filed alongside it.
      const stmt = [{ title: a.title, url: a.url }, ...(a.related ?? [])].find((x) => /financial results/i.test(x.title) && !/newspaper|media|presentation/i.test(x.title)) ?? a;
      a.enrichment = (await resultsFromFiling(stmt.url, c)) ?? table;
      console.log(`results card ${a.symbol} (${a.enrichment.kind === "results" ? a.enrichment.source : ""})`);
    } else if (a.category === "management_change") {
      a.enrichment = (await management(a.url, a.symbol, a.company, a.summary)) ?? a.enrichment;
      if (a.enrichment) console.log(`people card ${a.symbol}`);
    }
  }

  const digest: Digest = {
    generatedAt: new Date().toISOString(),
    holdings,
    announcements: anns.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    cost: [...(prev?.cost ?? []), ...ledger].slice(-200),
    stats: { total: fresh.length, byRules, byLlm: unsure.length },
  };
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(digest, null, 1));
  console.log(`wrote ${anns.length} filings · rules ${byRules}/${fresh.length} · LLM calls ${ledger.filter((c) => !c.cached).length} · $${totalUsd().toFixed(4)}`);
}

main();
