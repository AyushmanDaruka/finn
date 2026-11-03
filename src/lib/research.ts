// Pull side: on-demand research for ANY listed ticker, from primary sources only.
//   Numbers  → computed in code from the filed financial tables (exact, free).
//   Words    → management's own transcripts; every quote is verified verbatim before it is shown.
//   Judgment → one reasoning call that compares what was promised with what was delivered.
import { llm, hasKey, ledger } from "./llm";
import { readPdf, paged, type PdfDoc } from "./pdf";
import { getCompany, row, type CompanyData, type Table } from "./screener";
import type { CostEntry } from "./types";

export type Verdict = "delivered" | "partly" | "missed" | "moved" | "pending" | "unverifiable";

export interface PromiseItem {
  id: string;
  said: string; // call period, e.g. "Jul 2026"
  speaker?: string;
  quote: string;
  page: number;
  url: string; // transcript PDF
  metric: string;
  target: string;
  horizon: string;
  verdict?: Verdict;
  evidence?: string;
}

export interface Flag {
  tone: "good" | "bad" | "watch";
  text: string;
}

export interface Research {
  symbol: string;
  name: string;
  generatedAt: string;
  url: string;
  basis: string;
  isBank: boolean;
  about: string;
  ratios: Record<string, string>;
  business?: { line: string; segments: { name: string; note: string }[]; page?: number; url?: string };
  quarters: { labels: string[]; sales: (number | null)[]; ebitda: (number | null)[]; pat: (number | null)[]; opm: (number | null)[] };
  annual: { labels: string[]; sales: (number | null)[]; ebitda: (number | null)[]; pat: (number | null)[]; opm: (number | null)[] };
  growth: { sales3y: number | null; pat3y: number | null; sales5y: number | null; pat5y: number | null };
  balance?: { labels: string[]; debt: (number | null)[]; de: (number | null)[]; ccc: (number | null)[]; debtorDays: (number | null)[] };
  cash?: { labels: string[]; cfo: (number | null)[]; fcf: (number | null)[]; pat: (number | null)[]; conversion5y: number | null };
  flags: Flag[];
  promises?: { items: PromiseItem[]; score: number | null; summary: string; dropped: number; calls: { period: string; url: string }[] };
  bullBear?: { bull: { point: string; basis: string }[]; bear: { point: string; basis: string }[] };
  cost: CostEntry[];
  notes: string[]; // honest caveats (e.g. "no transcripts available")
}

/* ---------- deterministic lenses ---------- */

const last = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
const cagr = (a: number | null | undefined, b: number | null | undefined, yrs: number) =>
  a && b && a > 0 && b > 0 ? (Math.pow(b / a, 1 / yrs) - 1) * 100 : null;

function annualCols(t?: Table) {
  if (!t) return [] as number[];
  return t.headers.map((h, i) => (/^[A-Z][a-z]{2} \d{4}$/.test(h) ? i : -1)).filter((i) => i >= 0);
}

function lenses(c: CompanyData) {
  const notes: string[] = [];
  const flags: Flag[] = [];

  const qi = last(c.quarters?.headers.map((_, i) => i) ?? [], 12);
  const qv = (...p: string[]) => qi.map((i) => row(c.quarters, ...p)[i] ?? null);
  const quarters = {
    labels: qi.map((i) => c.quarters!.headers[i]),
    sales: qv("Sales", "Revenue"),
    ebitda: c.isBank ? qi.map(() => null) : qv("Operating Profit"),
    pat: qv("Net Profit"),
    opm: c.isBank ? qi.map(() => null) : qv("OPM"),
  };

  const ai = last(annualCols(c.pl), 6);
  const av = (t: Table | undefined, cols: number[], ...p: string[]) => cols.map((i) => row(t, ...p)[i] ?? null);
  const annual = {
    labels: ai.map((i) => c.pl!.headers[i]),
    sales: av(c.pl, ai, "Sales", "Revenue"),
    ebitda: c.isBank ? ai.map(() => null) : av(c.pl, ai, "Operating Profit"),
    pat: av(c.pl, ai, "Net Profit"),
    opm: c.isBank ? ai.map(() => null) : av(c.pl, ai, "OPM"),
  };
  const s = annual.sales, p = annual.pat, n = s.length - 1;
  const growth = {
    sales3y: cagr(s[n - 3], s[n], 3), pat3y: cagr(p[n - 3], p[n], 3),
    sales5y: cagr(s[n - 5], s[n], 5), pat5y: cagr(p[n - 5], p[n], 5),
  };

  // Margin direction (last FY vs 3 years earlier)
  const o = annual.opm;
  if (o[n] != null && o[n - 3] != null) {
    const d = (o[n]! - o[n - 3]!) as number;
    if (Math.abs(d) >= 2) flags.push({ tone: d > 0 ? "good" : "bad", text: `Operating margin ${d > 0 ? "expanded" : "compressed"} ${Math.abs(d).toFixed(0)} pts in 3 years (${o[n - 3]}% → ${o[n]}%)` });
  }
  if (growth.sales3y != null && growth.pat3y != null && Math.abs(growth.sales3y - growth.pat3y) > 5)
    flags.push({
      tone: growth.pat3y > growth.sales3y ? "good" : "watch",
      text: `Profit grew ${growth.pat3y > growth.sales3y ? "faster" : "slower"} than sales over 3 yrs (${growth.pat3y.toFixed(0)}% vs ${growth.sales3y.toFixed(0)}% CAGR)`,
    });

  let balance: Research["balance"], cash: Research["cash"];
  if (c.isBank) {
    notes.push("Lender: debt, working-capital and cash-conversion lenses don't apply the same way — shown for non-financials only.");
  } else {
    const bi = last(annualCols(c.bs), 5);
    const debt = av(c.bs, bi, "Borrowings");
    const eq = bi.map((i) => (row(c.bs, "Equity Capital")[i] ?? 0) + (row(c.bs, "Reserves")[i] ?? 0));
    const de = debt.map((d, k) => (d != null && eq[k] ? +(d / eq[k]).toFixed(2) : null));
    const ri = last(annualCols(c.eff), 5);
    balance = {
      labels: bi.map((i) => c.bs!.headers[i]),
      debt,
      de,
      ccc: av(c.eff, ri, "Cash Conversion Cycle"),
      debtorDays: av(c.eff, ri, "Debtor Days"),
    };
    const lde = de.at(-1);
    if (lde != null) flags.push(lde > 1 ? { tone: "bad", text: `Leveraged: debt is ${lde}× equity` } : lde < 0.1 ? { tone: "good", text: `Virtually debt-free (D/E ${lde})` } : { tone: lde > 0.5 ? "watch" : "good", text: `Debt/equity ${lde}` });
    const cc = balance.ccc.filter((x) => x != null) as number[];
    if (cc.length >= 3 && cc.at(-1)! - cc.at(-3)! > 15) flags.push({ tone: "watch", text: `Working capital stretching: cash cycle ${cc.at(-3)} → ${cc.at(-1)} days in 2 yrs` });

    const ci = last(annualCols(c.cf), 5);
    const cfo = av(c.cf, ci, "Cash from Operating");
    const labels = ci.map((i) => c.cf!.headers[i]);
    const patByYear = labels.map((l) => {
      const k = c.pl!.headers.indexOf(l);
      return k >= 0 ? row(c.pl, "Net Profit")[k] ?? null : null;
    });
    const sum = (a: (number | null)[]) => a.reduce<number>((t, x) => t + (x ?? 0), 0);
    const conv = sum(patByYear) > 0 ? Math.round((sum(cfo) / sum(patByYear)) * 100) : null;
    cash = { labels, cfo, fcf: av(c.cf, ci, "Free Cash Flow"), pat: patByYear, conversion5y: conv };
    if (conv != null)
      flags.push(conv < 70 ? { tone: "bad", text: `Weak cash conversion: only ${conv}% of 5-yr profit arrived as operating cash` } : conv >= 100 ? { tone: "good", text: `Profits are real: ${conv}% of 5-yr profit converted to operating cash` } : { tone: "watch", text: `${conv}% of 5-yr profit converted to operating cash` });
  }
  return { quarters, annual, growth, balance, cash, flags, notes };
}

/* ---------- grounding: a quote is shown only if it is really in the transcript ---------- */

const norm = (s: string) =>
  s.toLowerCase().replace(/(?<!\d)\.|\.(?!\d)/g, " ").replace(/[^a-z0-9%.]+/g, " ").replace(/\s+/g, " ").trim();
export function verifyQuote(doc: PdfDoc, quote: string, page: number): number | null {
  const q = norm(quote);
  const words = q.split(" ");
  const grams = words.length < 6 ? [q] : words.slice(0, words.length - 5).map((_, i) => words.slice(i, i + 6).join(" "));
  const check = (t: string) => grams.filter((g) => t.includes(g)).length / grams.length >= 0.7;
  const order = [page - 1, page - 2, page, ...doc.pages.keys()];
  for (const i of order) if (i >= 0 && i < doc.pages.length && check(norm(doc.pages[i]))) return i + 1;
  return null;
}

/* ---------- LLM steps ---------- */

const PRIMARY_ONLY =
  "Use ONLY the supplied primary documents and tables. Do not use outside knowledge about this company, news, or broker views. If the material doesn't say it, don't say it.";

async function extractPromises(symbol: string, period: string, url: string, doc: PdfDoc) {
  const text = paged(doc).slice(0, 180_000);
  const out = await llm<{ items: Omit<PromiseItem, "id" | "said" | "url">[] }>({
    tier: "extract",
    step: `${symbol}: guidance from ${period} call`,
    system: PRIMARY_ONLY,
    doc: text,
    prompt: `This is ${symbol}'s earnings-call transcript (${period}). Extract management's explicit forward-looking commitments that can later be checked against reported numbers: revenue/volume growth, margins (EBITDA/operating), profit, capex, debt, order book/inflow, capacity, launches with dates.
Rules: management speakers only (not analysts). Prefer statements with a number or a clear direction and a time frame. Skip vague aspiration ("we remain optimistic").
quote = verbatim from the transcript, ≤45 words, copied exactly. page = the [[page N]] it appears on. metric = short noun phrase ("Revenue growth", "EBITDA margin"). target = what was promised, compact ("15–20% YoY", "~11%", "₹1,200 Cr"). horizon = when ("FY27", "H2 FY27", "next 2-3 years", "near term").
Return at most 7, most consequential first.`,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { speaker: { type: "string" }, quote: { type: "string" }, page: { type: "integer" }, metric: { type: "string" }, target: { type: "string" }, horizon: { type: "string" } },
            required: ["quote", "page", "metric", "target", "horizon"],
          },
        },
      },
      required: ["items"],
    },
  });
  return out.items;
}

function actualsTable(r: ReturnType<typeof lenses>) {
  const line = (label: string, xs: (number | null)[]) => `${label}: ${xs.map((x) => (x == null ? "–" : x)).join(" | ")}`;
  const q = r.quarters, a = r.annual;
  const yoy = q.sales.map((v, i) => (i >= 4 && v && q.sales[i - 4] ? `${(((v as number) / (q.sales[i - 4] as number) - 1) * 100).toFixed(1)}%` : "–"));
  return [
    `QUARTERLY (₹ Cr; quarter-end month; Indian FY: Jun=Q1, Sep=Q2, Dec=Q3, Mar=Q4; e.g. "Sep 2026" = Q2 FY27)`,
    line("Period", q.labels as never),
    line("Revenue", q.sales),
    `Revenue YoY: ${yoy.join(" | ")}`,
    line("EBITDA", q.ebitda),
    line("EBITDA margin %", q.opm),
    line("PAT", q.pat),
    `ANNUAL (fiscal year ending)`,
    line("Period", a.labels as never),
    line("Revenue", a.sales),
    line("EBITDA margin %", a.opm),
    line("PAT", a.pat),
    r.balance ? line("Borrowings (" + r.balance.labels.join(", ") + ")", r.balance.debt) : "",
    r.cash ? line("Operating cash flow (" + r.cash.labels.join(", ") + ")", r.cash.cfo) : "",
  ].join("\n");
}

async function judge(symbol: string, items: PromiseItem[], actuals: string) {
  return llm<{ verdicts: { id: string; verdict: Verdict; evidence: string }[]; summary: string }>({
    tier: "reason",
    step: `${symbol}: promised vs delivered`,
    system: PRIMARY_ONLY,
    prompt: `You audit management credibility. Below: guidance statements from ${symbol}'s last several earnings calls (oldest first), then the reported numbers.

For each statement decide:
- delivered: the reported numbers meet the target in the stated horizon
- partly: directionally right but short of the number, or only part met
- missed: horizon has passed (or the trend makes it clearly unreachable) and numbers fall short
- moved: a LATER call in this list quietly revised the same target (lower, later, or reframed) — cite which call
- pending: horizon not yet reached and no later revision
- unverifiable: the tables can't measure this metric (e.g. market share, segment numbers not in tables)
evidence = one tight sentence with the specific reported numbers and periods you compared (e.g. "Q1–Q2 FY27 revenue grew 11% and 9% YoY vs 'mid-teens' guided"). No adjectives.
summary = one sentence a portfolio manager would want: the pattern in this management's promises (e.g. "Delivers on growth, consistently over-promises on margins").

GUIDANCE:
${items.map((p) => `[${p.id}] (${p.said} call) ${p.metric} → ${p.target} by ${p.horizon}. Quote: "${p.quote}"`).join("\n")}

REPORTED NUMBERS:
${actuals}`,
    schema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["delivered", "partly", "missed", "moved", "pending", "unverifiable"] }, evidence: { type: "string" } }, required: ["id", "verdict", "evidence"] },
        },
        summary: { type: "string" },
      },
      required: ["verdicts", "summary"],
    },
  });
}

async function business(symbol: string, about: string, period: string, url: string, doc: PdfDoc) {
  return llm<{ line: string; segments: { name: string; note: string }[]; page: number }>({
    tier: "cheap",
    step: `${symbol}: business snapshot`,
    system: PRIMARY_ONLY,
    doc: paged(doc, 0, 6).slice(0, 40_000),
    prompt: `Company profile: "${about}". Using management's opening remarks in this ${period} earnings-call transcript, give: line = what the company does and makes money from, ≤22 words, plain English; segments = up to 4 business segments with a ≤12-word note each on how it did this quarter (numbers if stated); page = main page used.`,
    schema: {
      type: "object",
      properties: { line: { type: "string" }, segments: { type: "array", items: { type: "object", properties: { name: { type: "string" }, note: { type: "string" } }, required: ["name", "note"] } }, page: { type: "integer" } },
      required: ["line", "segments"],
    },
  });
}

async function bullBear(symbol: string, r: Omit<Research, "bullBear" | "cost">, actuals: string) {
  const ctx = [
    actuals,
    "FLAGS: " + r.flags.map((f) => f.text).join("; "),
    r.promises ? "PROMISE AUDIT: " + r.promises.summary + "\n" + r.promises.items.map((p) => `${p.metric} ${p.target} (${p.said}) → ${p.verdict}: ${p.evidence}`).join("\n") : "",
    r.business ? "BUSINESS: " + r.business.line + " " + r.business.segments.map((s) => `${s.name}: ${s.note}`).join("; ") : "",
  ].join("\n\n");
  return llm<{ bull: { point: string; basis: string }[]; bear: { point: string; basis: string }[] }>({
    tier: "reason",
    step: `${symbol}: bull vs bear`,
    system: PRIMARY_ONLY,
    prompt: `Write the tightest possible bull and bear case for ${symbol} — 3 points each, ≤18 words per point, each anchored in a specific number or audit finding below (basis = the figure/finding used, ≤10 words). No generic statements that could apply to any company.\n\n${ctx}`,
    schema: {
      type: "object",
      properties: Object.fromEntries(["bull", "bear"].map((k) => [k, { type: "array", items: { type: "object", properties: { point: { type: "string" }, basis: { type: "string" } }, required: ["point", "basis"] } }])),
      required: ["bull", "bear"],
    },
  });
}

/* ---------- orchestration ---------- */

const SCORE: Partial<Record<Verdict, number>> = { delivered: 1, partly: 0.5, moved: 0.25, missed: 0 };

export async function research(symbol: string, progress: (msg: string) => void = () => {}): Promise<Research> {
  const ledgerStart = ledger.length;
  progress("Reading filed financials");
  const c = await getCompany(symbol);
  const L = lenses(c);
  const base: Omit<Research, "cost"> = {
    symbol: c.symbol, name: c.name, generatedAt: new Date().toISOString(), url: c.url, basis: c.basis, isBank: c.isBank,
    about: c.about, ratios: c.ratios, quarters: L.quarters, annual: L.annual, growth: L.growth, balance: L.balance, cash: L.cash, flags: L.flags, notes: L.notes,
  };

  const calls = c.concalls.filter((x) => x.transcript).slice(0, 4).reverse(); // oldest → newest
  if (!hasKey()) base.notes.push("Model offline — showing the numbers-only view.");
  else if (!calls.length) base.notes.push("No earnings-call transcripts filed — promise audit unavailable.");
  else {
    progress(`Fetching ${calls.length} earnings-call transcripts`);
    const docs = await Promise.all(calls.map((k) => readPdf(k.transcript!).catch(() => null)));
    const items: PromiseItem[] = [];
    let dropped = 0;
    for (const [i, k] of calls.entries()) {
      const d = docs[i];
      if (!d || d.scanned) continue;
      progress(`Reading ${k.period} call for guidance`);
      const got = await extractPromises(c.symbol, k.period, k.transcript!, d).catch(() => []);
      for (const g of got) {
        const page = verifyQuote(d, g.quote, g.page);
        if (page == null) { dropped++; continue; } // not verbatim in the source → never shown
        items.push({ ...g, page, id: `p${items.length + 1}`, said: k.period, url: k.transcript! });
      }
    }
    if (items.length) {
      progress("Checking promises against reported numbers");
      const actuals = actualsTable(L);
      const j = await judge(c.symbol, items, actuals);
      for (const v of j.verdicts) Object.assign(items.find((p) => p.id === v.id) ?? {}, { verdict: v.verdict, evidence: v.evidence });
      const judged = items.filter((p) => p.verdict && SCORE[p.verdict] !== undefined);
      base.promises = {
        items,
        score: judged.length >= 2 ? Math.round((judged.reduce((s, p) => s + SCORE[p.verdict!]!, 0) / judged.length) * 100) : null,
        summary: j.summary,
        dropped,
        calls: calls.map((k) => ({ period: k.period, url: k.transcript! })),
      };
    }
    const latest = calls.at(-1)!, ld = docs.at(-1);
    if (ld && !ld.scanned) {
      progress("Summarising the business");
      const b = await business(c.symbol, c.about, latest.period, latest.transcript!, ld).catch(() => null);
      if (b) base.business = { ...b, url: latest.transcript };
    }
    progress("Building bull & bear");
    base.bullBear = (await bullBear(c.symbol, base, actualsTable(L)).catch(() => undefined)) ?? undefined;
  }
  return { ...base, cost: ledger.slice(ledgerStart) };
}
