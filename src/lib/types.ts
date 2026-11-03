// Shared shapes for the push (digest/alerts) and pull (research) sides.

export const CATEGORIES = [
  "results",
  "mna",
  "fund_raise",
  "management_change",
  "litigation",
  "insider_trading",
  "earnings_call",
  "investor_meetings",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "postal_ballot",
  "agm_egm",
  "pledging",
  "unclassified",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** critical = interrupts you, notable = in the digest, routine = collapsed */
export type Tier = "critical" | "notable" | "routine";

export interface Announcement {
  id: string; // stable hash of url
  symbol: string;
  company: string;
  title: string; // exchange subject line
  summary: string; // exchange one-liner
  date: string; // ISO with offset
  url: string; // primary BSE PDF
  category: Category;
  classifiedBy: "rules" | "llm";
  score: number; // 0-100 materiality
  tier: Tier;
  reason: string; // why FINN ranked it here — always shown to the user
  enrichment?: Enrichment;
  related?: { title: string; url: string }[]; // same story filed several times (results + deck + press release)
}

export type Enrichment = ResultsEnrichment | ManagementEnrichment | OneLiner;

export interface Headline {
  current: number | null;
  prevQ: number | null; // QoQ base
  yearAgoQ: number | null; // YoY base
}
export interface ResultsEnrichment {
  kind: "results";
  quarter: string; // e.g. "Sep 2026"
  basis: "consolidated" | "standalone";
  unit: string; // "₹ Cr"
  revenue: Headline;
  ebitda: Headline;
  pbt: Headline;
  pat: Headline;
  isBank?: boolean;
  source: "filing" | "screener"; // filing = LLM read the PDF; screener = table fallback
  crossCheck?: { ok: boolean; note: string }; // filing vs screener table
  takeaway?: string;
}

export interface ManagementEnrichment {
  kind: "management";
  changes: {
    name: string;
    role: string;
    change: "appointed" | "resigned" | "retired" | "other";
    effective?: string;
    bio?: string; // web-sourced, push-side enrichment
    bioSources?: string[];
  }[];
}

export interface OneLiner {
  kind: "oneliner";
  text: string;
}

export interface PricePoint {
  d: string; // yyyy-mm-dd
  c: number; // close
  v: number; // volume
}

export interface Holding {
  symbol: string;
  name: string;
  sector: string;
  cap: "Large" | "Mid" | "Small";
  screenerId?: string;
}

export interface CostEntry {
  step: string;
  model: string;
  inTok: number;
  outTok: number;
  usd: number;
  cached?: boolean;
}

export interface Digest {
  generatedAt: string;
  holdings: (Holding & { prices: PricePoint[] })[];
  announcements: Announcement[];
  cost: CostEntry[];
  stats: { total: number; byRules: number; byLlm: number };
}
