// Rule-first triage. Exchange subject lines are semi-standardised (SEBI LODR categories),
// so ordered regexes classify most filings for free. Only what rules can't place
// confidently is sent to a cheap LLM (see enrich.ts).
import type { Announcement, Category, Tier } from "./types";

type Rule = { cat: Category; re: RegExp; score: number; why: string };

// Order matters: first match wins. Scores are base materiality (0-100).
const RULES: Rule[] = [
  // Routine paperwork first, so "Newspaper Publication of results" doesn't rank as results.
  { cat: "unclassified", re: /newspaper publication|trading window|74\s*\(5\)|loss of share cert|duplicate share|investor complaints|compliance certificate|secretarial compliance|esg|business responsibility|book closure.*agm|copy of newspaper|monitoring agency/i, score: 5, why: "Routine compliance paperwork" },
  { cat: "unclassified", re: /allotment of esop|esps|esop|rsu/i, score: 8, why: "ESOP allotment — routine dilution, tiny" },
  { cat: "earnings_call", re: /earnings call|conference call|concall|transcript|audio recording|analyst.*(meet|call).*(recording|transcript)/i, score: 20, why: "Earnings-call logistics" },
  { cat: "results", re: /financial results|outcome of board meeting.*result|results? for the (quarter|period)/i, score: 90, why: "Quarterly results filed" },
  { cat: "litigation", re: /insolvency|nclt|cirp|default|penalt|show cause|regulatory action|litigation|dispute|order passed|sebi order|demand order|gst.*(order|demand)|income tax.*(order|demand)|fraud/i, score: 70, why: "Legal / regulatory action" },
  { cat: "management_change", re: /resignation|retire|change in (management|directorate|key managerial)|appointment of (?:.*)(ceo|cfo|managing director|md|whole[- ]time|chief)|cessation|superannuat|re-?appointment/i, score: 60, why: "Change at the top" },
  { cat: "mna", re: /acquisition|amalgamation|merger|demerger|scheme of arrangement|joint venture|\bjv\b|stake (sale|purchase)|divest|disinvest|takeover|open offer|investment in .*subsidiar/i, score: 75, why: "M&A / corporate restructuring" },
  { cat: "fund_raise", re: /\bqip\b|rights issue|preferential (issue|allotment)|buy-?back|raising of funds|issue of securities|commercial paper|non-convertible|\bncd|debentures|fund rais/i, score: 55, why: "Capital raise / return" },
  { cat: "credit_rating", re: /credit rating|rating/i, score: 35, why: "Credit rating action" },
  { cat: "pledging", re: /pledge|encumbrance|regulation 31|reg\.? 31/i, score: 50, why: "Promoter pledge change" },
  { cat: "insider_trading", re: /regulation 7\(2\)|reg\.? 7\(2\)|29\(1\)|29\(2\)|sast|insider trading|acquisition of shares by promoter/i, score: 40, why: "Promoter / insider dealing" },
  { cat: "investor_meetings", re: /analyst|investor meet|institutional investor|investor conference|investor presentation/i, score: 15, why: "Investor meeting / deck" },
  { cat: "dividend", re: /dividend/i, score: 30, why: "Dividend" },
  { cat: "bonus_split", re: /bonus|split|sub-?division/i, score: 45, why: "Bonus / split" },
  { cat: "capex", re: /capex|capacity expansion|new (plant|facility|unit)|commission(ing|ed) of|greenfield|brownfield|expansion/i, score: 50, why: "Capacity / capex" },
  { cat: "postal_ballot", re: /postal ballot/i, score: 10, why: "Postal ballot" },
  { cat: "agm_egm", re: /\bagm\b|\begm\b|annual general meeting|extra-?ordinary general|shareholders meeting/i, score: 10, why: "Shareholder meeting" },
  { cat: "press_release", re: /bagging|receiving of orders|order (win|received|bagged)|award of (order|contract)|letter of award|press release|media release|launch|partnership|clarification|updates?$/i, score: 35, why: "Company news" },
  { cat: "results", re: /board meeting (intimation|outcome)|outcome of (the )?board meeting/i, score: 20, why: "Board meeting notice" },
];

// Modifiers lift or sink an item within its category, from cues in the text.
const MODS: { re: RegExp; delta: number; why: string; cats?: Category[] }[] = [
  { re: /\b(ceo|chief executive|cfo|chief financial|managing director|\bmd\b|chairman)\b/i, delta: 25, why: "CXO-level", cats: ["management_change"] },
  { re: /company secretary|compliance officer|senior management personnel|group head|superannuat/i, delta: -25, why: "below CXO", cats: ["management_change"] },
  { re: /independent director|non-executive/i, delta: -15, why: "board seat, non-executive", cats: ["management_change"] },
  { re: /downgrade|negative/i, delta: 40, why: "downgrade", cats: ["credit_rating"] },
  { re: /wholly[- ]owned subsidiary|incorporat(ed|ion) of .*subsidiary/i, delta: -35, why: "internal: wholly-owned subsidiary", cats: ["mna"] },
  { re: /upgrade|positive/i, delta: 15, why: "upgrade", cats: ["credit_rating"] },
  { re: /reaffirm/i, delta: -15, why: "just reaffirmed", cats: ["credit_rating"] },
  { re: /intimation|prior intimation|to consider|will be held|scheduled/i, delta: -40, why: "only a notice of a future event", cats: ["results", "fund_raise", "investor_meetings", "earnings_call"] },
  { re: /(₹|rs\.?|inr)\s*[\d,]+(\.\d+)?\s*(crore|cr\b|bn|billion)/i, delta: 10, why: "has a disclosed ₹ value", cats: ["press_release", "capex", "fund_raise"] },
  { re: /special dividend|interim dividend/i, delta: 10, why: "", cats: ["dividend"] },
  { re: /record date/i, delta: -10, why: "record-date logistics", cats: ["dividend", "bonus_split"] },
];

export const TIER_OF = (score: number): Tier => (score >= 70 ? "critical" : score >= 35 ? "notable" : "routine");

export type RawAnn = Pick<Announcement, "id" | "symbol" | "company" | "title" | "summary" | "date" | "url">;

/** Returns null when rules can't decide confidently → LLM fallback. */
/** Largest ₹ amount mentioned, in crore. "₹6,95,418" → 0.0695, "₹54.06 lakh" → 0.54, "Rs 2,635 crore" → 2635. */
export function rupeesCr(text: string): number | null {
  const re = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|million|mn\b|billion|bn\b)?/gi;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    const u = (m[2] ?? "").toLowerCase();
    const cr = u.startsWith("cr") ? n : /^la/.test(u) ? n / 100 : /^(mi|mn)/.test(u) ? n / 10 : /^(bi|bn)/.test(u) ? n * 100 : n / 1e7;
    if (Number.isFinite(cr)) best = Math.max(best ?? 0, cr);
  }
  return best;
}

const fmtCr = (cr: number) => (cr >= 1 ? `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : `₹${(cr * 100).toFixed(1)} lakh`);

export function classify(
  a: RawAnn,
  ctx: { mcapCr?: number } = {},
): Pick<Announcement, "category" | "score" | "tier" | "reason" | "classifiedBy"> | null {
  const subject = a.title.replace(/^announcement under regulation 30 \(lodr\)\s*-?\s*/i, "");
  const text = `${subject} ${a.summary}`;
  let rule = RULES.find((r) => r.re.test(subject)) ?? RULES.find((r) => r.re.test(a.summary));
  if (!rule) return null;
  // A board-meeting outcome whose summary says results were approved IS the results filing.
  // Results often arrive under another subject ("Dividend Updates", "Board Meeting Outcome") — the summary tells.
  const approvesResults = /results?/i.test(a.summary) && /approv|announc|report/i.test(a.summary) && !/to consider|will consider/i.test(a.summary);
  if ((rule.why === "Board meeting notice" && /outcome/i.test(subject)) || (rule.cat === "dividend" && approvesResults))
    rule = { cat: "results", re: rule.re, score: 85, why: rule.cat === "dividend" ? "Results (filed with dividend)" : "Results approved at board meeting" };
  // "Press release" and "Updates" are grab-bags: a rule can file them, but only the body says if it matters.
  if (rule.cat === "press_release" && !/order|award|contract/i.test(text)) return null;

  let score = rule.score;
  const why = [rule.why];
  for (const m of MODS) {
    if ((!m.cats || m.cats.includes(rule.cat)) && m.re.test(text)) {
      score += m.delta;
      if (m.why) why.push(m.why);
    }
  }
  // Materiality is relative: a ₹7 lakh fine is noise for a ₹10 lakh-crore bank, not for a small-cap.
  const amt = rupeesCr(text);
  if (amt !== null && ctx.mcapCr && ["litigation", "press_release", "mna", "capex", "fund_raise"].includes(rule.cat)) {
    const pct = (amt / ctx.mcapCr) * 100;
    if (pct < 0.01) {
      score = Math.min(score, 25);
      why.push(`immaterial: ${fmtCr(amt)} vs ${fmtCr(ctx.mcapCr)} market cap`);
    } else if (pct > 1) {
      score += 15;
      why.push(`${fmtCr(amt)} ≈ ${pct.toFixed(1)}% of market cap`);
    }
  }
  score = Math.max(0, Math.min(100, score));
  return { category: rule.cat, score, tier: TIER_OF(score), reason: why.join(" · "), classifiedBy: "rules" };
}
