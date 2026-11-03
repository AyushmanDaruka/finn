// Push-side enrichment: what turns a filing into something worth reading.
import { llm, hasKey } from "./llm";
import { readPdf, paged, type PdfDoc } from "./pdf";
import { row, type CompanyData } from "./screener";
import { TIER_OF, type RawAnn } from "./triage";
import { CATEGORIES, type Announcement, type Headline, type ManagementEnrichment, type ResultsEnrichment } from "./types";

/* ---------- 1. ambiguous filings: one batched cheap call for the whole digest ---------- */

export async function classifyBatch(items: RawAnn[]) {
  if (!items.length || !hasKey()) return new Map<string, { category: Announcement["category"]; score: number; line: string }>();
  const out = await llm<{ id: string; category: Announcement["category"]; score: number; line: string }[]>({
    tier: "cheap",
    step: `classify ${items.length} ambiguous filings`,
    system:
      "You triage Indian stock-exchange filings for a long-only investor. Score materiality 0-100: 80+ could move the stock today, 35-79 worth knowing, <35 routine. Awards, CSR, product PR, office moves and procedural notices are routine. Write `line` as a ≤14-word plain-English takeaway; no hype, no adjectives.",
    prompt: `Classify each filing into one of: ${CATEGORIES.join(", ")}.\n\n${JSON.stringify(items.map((i) => ({ id: i.id, company: i.company, subject: i.title, summary: i.summary })))}`,
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, category: { type: "string", enum: [...CATEGORIES] }, score: { type: "integer" }, line: { type: "string" } },
        required: ["id", "category", "score", "line"],
      },
    },
  });
  return new Map(out.map((o) => [o.id, o]));
}

/* ---------- 2. quarterly results: the four headline numbers, QoQ and YoY ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shift = (label: string, months: number) => {
  const [m, y] = label.split(" ");
  const i = MONTHS.indexOf(m) + Number(y) * 12 - months;
  return `${MONTHS[i % 12]} ${Math.floor(i / 12)}`;
};

/** Baseline from the exchange-reported quarterly table — free, and our cross-check for the LLM read. */
export function resultsFromTable(c: CompanyData, quarter?: string): ResultsEnrichment | null {
  const q = c.quarters;
  if (!q) return null;
  const cur = quarter && q.headers.includes(quarter) ? quarter : q.headers.at(-1)!;
  const pick = (vals: (number | null)[]): Headline => {
    const at = (h: string) => (q.headers.indexOf(h) >= 0 ? vals[q.headers.indexOf(h)] ?? null : null);
    return { current: at(cur), prevQ: at(shift(cur, 3)), yearAgoQ: at(shift(cur, 12)) };
  };
  return {
    kind: "results",
    quarter: cur,
    basis: c.basis,
    unit: "₹ Cr",
    revenue: pick(row(q, "Sales", "Revenue")),
    // Screener's "Operating Profit" = revenue − operating expenses = EBITDA (ex other income). Not meaningful for lenders.
    ebitda: c.isBank ? { current: null, prevQ: null, yearAgoQ: null } : pick(row(q, "Operating Profit")),
    pbt: pick(row(q, "Profit before tax")),
    pat: pick(row(q, "Net Profit")),
    isBank: c.isBank,
    source: "screener",
  };
}

/** Pick the pages of a results filing that actually hold the P&L statement (chunking = fewer tokens). */
function plPages(d: PdfDoc, prefer: "consolidated" | "standalone") {
  const scored = d.pages.map((t, i) => {
    const s = t.toLowerCase();
    let sc = 0;
    if (/revenue from operations|total income|interest earned/.test(s)) sc += 3;
    if (/profit before tax|profit \/ \(loss\) before tax|profit\/\(loss\) before/.test(s)) sc += 3;
    if (/finance costs?|depreciation/.test(s)) sc += 2;
    if (/quarter ended|three months ended/.test(s)) sc += 2;
    if (s.includes(prefer)) sc += 3;
    if (/review report|auditor/.test(s)) sc -= 3;
    return { i, sc };
  });
  return scored.filter((x) => x.sc >= 8).sort((a, b) => b.sc - a.sc).slice(0, 3).map((x) => x.i).sort((a, b) => a - b);
}

type Col = { revenue: number | null; pbt: number | null; pat: number | null; finance: number | null; dep: number | null; other: number | null };

export async function resultsFromFiling(url: string, c: CompanyData): Promise<ResultsEnrichment | null> {
  const base = resultsFromTable(c);
  if (!hasKey()) return base;
  try {
    const d = await readPdf(url, true);
    const pages = plPages(d, c.basis);
    const useText = !d.scanned && pages.length > 0;
    const x = await llm<{ basis: string; unit: string; periods: string[]; cur: Col; prevQ: Col; yearAgoQ: Col }>({
      tier: "extract",
      step: `${c.symbol}: read results filing`,
      doc: useText ? pages.map((p) => `[[page ${p + 1}]]\n${d.pages[p]}`).join("\n\n") : undefined,
      pdf: useText ? undefined : d.bytes,
      prompt: `From this quarterly results filing, extract the ${c.basis.toUpperCase()} statement of profit and loss (if absent, use standalone and say so).
Columns needed: the latest quarter (cur), the immediately preceding quarter (prevQ), and the same quarter of the previous year (yearAgoQ). Ignore half-year/year columns.
Fields: revenue = Revenue from operations (for banks: Interest earned + Other income = Total income); pbt = profit before tax (after exceptional items); pat = profit for the period (total, before OCI); finance = finance costs; dep = depreciation & amortisation; other = other income.
Copy numbers exactly as printed (negative for losses), in the filing's unit. unit = the filing's stated unit (e.g. "₹ crore", "₹ lakh", "₹ million"). periods = the three column headers as printed.`,
      schema: {
        type: "object",
        properties: {
          basis: { type: "string", enum: ["consolidated", "standalone"] },
          unit: { type: "string" },
          periods: { type: "array", items: { type: "string" } },
          ...Object.fromEntries(
            ["cur", "prevQ", "yearAgoQ"].map((k) => [
              k,
              { type: "object", properties: Object.fromEntries(["revenue", "pbt", "pat", "finance", "dep", "other"].map((f) => [f, { type: ["number", "null"] }])) },
            ]),
          ),
        },
        required: ["basis", "unit", "periods", "cur", "prevQ", "yearAgoQ"],
      },
    });
    const u = x.unit.toLowerCase();
    const toCr = (n: number | null | undefined) =>
      n == null ? null : u.includes("lakh") || u.includes("lac") ? n / 100 : u.includes("million") || u.includes("mn") ? n / 10 : u.includes("crore") || u.includes("cr") ? n : n / 1e7;
    // EBITDA is not a line item in Indian filings — compute it, don't ask a model for arithmetic.
    const ebitda = (k: Col) =>
      c.isBank || k.pbt == null || k.finance == null || k.dep == null ? null : toCr(k.pbt + k.finance + k.dep - (k.other ?? 0));
    const h = (f: (k: Col) => number | null): Headline => ({ current: f(x.cur), prevQ: f(x.prevQ), yearAgoQ: f(x.yearAgoQ) });
    const out: ResultsEnrichment = {
      kind: "results",
      quarter: base?.quarter ?? x.periods[0] ?? "",
      basis: x.basis as ResultsEnrichment["basis"],
      unit: "₹ Cr",
      revenue: h((k) => toCr(k.revenue)),
      ebitda: h(ebitda),
      pbt: h((k) => toCr(k.pbt)),
      pat: h((k) => toCr(k.pat)),
      isBank: c.isBank,
      source: "filing",
    };
    // Trust, but verify: the filing read must agree with the exchange-reported table.
    if (base && !c.isBank) {
      const off = (a: number | null, b: number | null) => (a && b ? Math.abs(a / b - 1) : 0);
      const worst = Math.max(off(out.revenue.current, base.revenue.current), off(out.pbt.current, base.pbt.current), off(out.pat.current, base.pat.current));
      out.crossCheck =
        worst < 0.03
          ? { ok: true, note: "Matches exchange-reported figures" }
          : { ok: false, note: `Differs from exchange table by ${(worst * 100).toFixed(0)}% — showing the table` };
      if (!out.crossCheck.ok) return { ...base, crossCheck: out.crossCheck };
      // Some filings omit a comparison column (e.g. no previous quarter) — fill those cells from the table, and say so.
      let filled = false;
      for (const k of ["revenue", "ebitda", "pbt", "pat"] as const)
        for (const col of ["current", "prevQ", "yearAgoQ"] as const)
          if (out[k][col] == null && base[k][col] != null) ((out[k][col] = base[k][col]), (filled = true));
      if (filled) out.crossCheck.note += " · missing columns filled from exchange table";
    }
    return out;
  } catch (e) {
    console.warn(`results extraction failed for ${c.symbol}:`, (e as Error).message);
    return base;
  }
}

/* ---------- 3. management change: who are they? ---------- */

export async function management(url: string, symbol: string, company: string, summary: string): Promise<ManagementEnrichment | null> {
  if (!hasKey()) return null;
  try {
    const d = await readPdf(url);
    // SEBI requires appointment filings to carry a "brief profile" — so the bio comes from the filing itself (primary, free).
    const x = await llm<{ changes: ManagementEnrichment["changes"] }>({
      tier: "cheap",
      step: `${symbol}: parse management change`,
      doc: paged(d, 0, 6).slice(0, 24000),
      prompt: `List each person whose role changes in this filing by ${company}. role = the position (e.g. "Chief Financial Officer"). change = appointed | resigned | retired | other. effective = date as written. bio = for appointees only: their background as stated in the filing's brief profile — prior employers/roles and education, ≤40 words, facts only; omit if the filing has no profile. Exchange summary for context: "${summary}"`,
      schema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, role: { type: "string" }, change: { type: "string", enum: ["appointed", "resigned", "retired", "other"] }, effective: { type: "string" }, bio: { type: "string" } },
              required: ["name", "role", "change"],
            },
          },
        },
        required: ["changes"],
      },
    });
    // Web lookup only when the filing has no profile (needs a key with search quota; skipped silently otherwise).
    for (const p of x.changes.filter((p) => p.change === "appointed" && !p.bio).slice(0, 2)) {
      try {
        const r = await llm<{ value: string; sources: string[] }>({
          tier: "extract",
          step: `${symbol}: background of ${p.name}`,
          search: true,
          prompt: `In at most 2 sentences (≤45 words), give the professional background of ${p.name}, newly appointed ${p.role} at ${company} (India): previous employers/roles and education. Facts only. If you cannot find this specific person, reply exactly "UNKNOWN".`,
        });
        if (r.value && !/UNKNOWN/.test(r.value)) Object.assign(p, { bio: r.value.trim(), bioSources: r.sources });
      } catch {}
    }
    return { kind: "management", changes: x.changes };
  } catch (e) {
    console.warn(`management parse failed for ${symbol}:`, (e as Error).message);
    return null;
  }
}

export { TIER_OF };
