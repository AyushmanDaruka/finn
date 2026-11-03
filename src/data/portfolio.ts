import type { Holding } from "@/lib/types";

// 18 holdings across 14 sectors and three size buckets. Picked from a scan of ~40 names
// (scripts/scan.ts) for a demo with real texture this week: fresh Q2 FY27 results, a chairman
// transition, M&A, NCLAT litigation, a credit-outlook change and two double-digit price moves.
export const PORTFOLIO: Holding[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy & Telecom", cap: "Large" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Private Bank", cap: "Large" },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Private Bank", cap: "Large" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", cap: "Large" },
  { symbol: "INFY", name: "Infosys", sector: "IT Services", cap: "Large" },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Infrastructure", cap: "Large" },
  { symbol: "ITC", name: "ITC", sector: "FMCG", cap: "Large" },
  { symbol: "SUNPHARMA", name: "Sun Pharma", sector: "Pharma", cap: "Large" },
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Paints", cap: "Large" },
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Metals", cap: "Large" },
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Conglomerate", cap: "Large" },
  { symbol: "TRENT", name: "Trent", sector: "Retail", cap: "Large" },
  { symbol: "PIDILITIND", name: "Pidilite Industries", sector: "Chemicals", cap: "Large" },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences", sector: "Pharma", cap: "Mid" },
  { symbol: "POLYCAB", name: "Polycab India", sector: "Cables & Wires", cap: "Mid" },
  { symbol: "DIXON", name: "Dixon Technologies", sector: "Electronics Mfg", cap: "Mid" },
  { symbol: "SUZLON", name: "Suzlon Energy", sector: "Renewables", cap: "Mid" },
  { symbol: "KAYNES", name: "Kaynes Technology", sector: "Electronics Mfg", cap: "Small" },
];

// Pull-side demo set: two holdings plus two names outside the portfolio (the engine is ticker-agnostic).
export const RESEARCH_DEMO = ["DIXON", "PERSISTENT", "POLYCAB", "COFORGE"];
