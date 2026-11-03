// Client-safe: turns the digest + the investor's own rules into what FINN surfaces.
// Thresholds live with the user (localStorage), so changing "what counts as unusual" is instant.
import type { Announcement, Category, Digest } from "./types";

export interface Settings {
  windowH: number; // digest window
  pricePct: number; // |1-day move| ≥ this → alert
  volX: number; // volume ≥ this × 20-day average → alert
  cats: Category[]; // filing types that may interrupt
  seen: string[]; // cleared cards (inbox-zero)
}

export const DEFAULTS: Settings = {
  windowH: 24,
  pricePct: 4,
  volX: 2,
  cats: ["results", "mna", "management_change", "litigation", "fund_raise", "credit_rating", "pledging"],
  seen: [],
};

export const CAT_LABEL: Record<Category, string> = {
  results: "Results", mna: "M&A", fund_raise: "Fund raise", management_change: "Management", litigation: "Legal",
  insider_trading: "Insider deal", earnings_call: "Earnings call", investor_meetings: "Investor meet", credit_rating: "Credit rating",
  dividend: "Dividend", bonus_split: "Bonus/split", capex: "Capex", press_release: "News", postal_ballot: "Postal ballot",
  agm_egm: "AGM/EGM", pledging: "Pledge", unclassified: "Routine",
};

/** Windows are anchored to the data's as-of time, not the wall clock — the digest never silently goes empty. */
export const since = (d: Digest, hours: number) => Date.parse(d.generatedAt) - hours * 3600e3;

export function inWindow(d: Digest, s: Settings) {
  const t0 = since(d, s.windowH);
  return d.announcements.filter((a) => Date.parse(a.date) >= t0);
}

/** The user's watched categories can lift a filing into "needs you"; unwatched ones never interrupt. */
export function effectiveTier(a: Announcement, s: Settings) {
  if (a.tier === "critical" && !s.cats.includes(a.category)) return "notable";
  return a.tier;
}

export interface Move {
  symbol: string;
  name: string;
  d: string;
  ret: number; // %
  volX: number;
  close: number;
  price: boolean;
  volume: boolean;
  spark: number[];
  filing?: Announcement; // the likely "why" — a material filing in the two sessions before the move
}

export function moves(d: Digest, s: Settings, hours = s.windowH): Move[] {
  const t0 = since(d, Math.max(hours, 24));
  const out: Move[] = [];
  for (const h of d.holdings) {
    const p = h.prices;
    for (let i = 21; i < p.length; i++) {
      if (Date.parse(`${p[i].d}T15:30:00+05:30`) < t0) continue;
      const ret = (p[i].c / p[i - 1].c - 1) * 100;
      const avg = p.slice(i - 20, i).reduce((t, x) => t + x.v, 0) / 20;
      const vx = avg ? p[i].v / avg : 0;
      const price = Math.abs(ret) >= s.pricePct, volume = vx >= s.volX;
      if (!price && !volume) continue;
      // "Why" window = since the close two sessions back (trading days, so weekends don't break the link).
      const to = Date.parse(`${p[i].d}T15:30:00+05:30`), from = Date.parse(`${p[i - 2].d}T15:30:00+05:30`);
      const filing = d.announcements
        .filter((a) => a.symbol === h.symbol && a.tier !== "routine" && Date.parse(a.date) > from && Date.parse(a.date) <= to)
        .sort((a, b) => b.score - a.score)[0];
      out.push({ symbol: h.symbol, name: h.name, d: p[i].d, ret, volX: vx, close: p[i].c, price, volume, spark: p.slice(Math.max(0, i - 29), i + 1).map((x) => x.c), filing });
    }
  }
  return out.sort((a, b) => b.d.localeCompare(a.d) || Math.abs(b.ret) - Math.abs(a.ret));
}

export function dayChange(prices: { c: number }[]) {
  const n = prices.length;
  return n > 1 ? (prices[n - 1].c / prices[n - 2].c - 1) * 100 : 0;
}
