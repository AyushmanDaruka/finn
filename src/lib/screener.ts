// Screener.in is our single plumbing layer: financial tables, filings feed,
// transcript/annual-report links (pointing at the original BSE PDFs) and EOD price/volume.
import * as cheerio from "cheerio";
import { createHash } from "crypto";
import type { Announcement, PricePoint } from "./types";

const BASE = "https://www.screener.in";
const UA = "Mozilla/5.0 (compatible; FINN/0.1; research prototype)";
const MIN_GAP_MS = 700; // be polite: one request at a time, spaced out

let last = 0;
async function throttle() {
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

export async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 0; i < tries; i++) {
    await throttle();
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (res.ok) return res.text();
    if (res.status === 404) throw new Error(`404 ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1))); // 429/5xx backoff
  }
  throw new Error(`fetch failed ${url}`);
}

export async function fetchBuffer(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/* ---------- financial tables ---------- */

export interface Table {
  headers: string[]; // period labels, e.g. "Sep 2026", "Mar 2026", "TTM"
  rows: { label: string; values: (number | null)[] }[];
}

export function num(s: string): number | null {
  const t = s.replace(/[₹,%\s+]/g, "").replace(/[–—]/g, "-");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Find a row by label prefix (labels carry "+" expanders and tooltips). */
export function row(t: Table | undefined, ...prefixes: string[]): (number | null)[] {
  if (!t) return [];
  for (const p of prefixes) {
    const r = t.rows.find((x) => x.label.toLowerCase().startsWith(p.toLowerCase()));
    if (r) return r.values;
  }
  return [];
}

export interface CompanyData {
  symbol: string;
  name: string;
  screenerId: string;
  bseCode?: string;
  url: string;
  about: string;
  ratios: Record<string, string>;
  isBank: boolean;
  basis: "consolidated" | "standalone";
  quarters?: Table;
  pl?: Table;
  bs?: Table;
  cf?: Table;
  eff?: Table; // efficiency ratios (debtor days, CCC, ROCE)
  annualReports: { title: string; url: string }[];
  concalls: { period: string; transcript?: string; ppt?: string }[];
}

function parseTable($: cheerio.CheerioAPI, section: string): Table | undefined {
  const t = $(`#${section} table.data-table`).first();
  if (!t.length) return undefined;
  const headers = t.find("thead th").map((_, e) => $(e).text().trim()).get().slice(1);
  const rows = t
    .find("tbody tr")
    .map((_, r) => {
      const cells = $(r).find("td").map((__, e) => $(e).text().replace(/\s+/g, " ").trim()).get();
      return { label: cells[0].replace(/\s*\+$/, ""), values: cells.slice(1).map(num) };
    })
    .get()
    .filter((r) => r.label && r.label !== "Raw PDF");
  return rows.length ? { headers, rows } : undefined;
}

async function loadPage(symbol: string, consolidated: boolean) {
  const url = `${BASE}/company/${encodeURIComponent(symbol)}/${consolidated ? "consolidated/" : ""}`;
  const $ = cheerio.load(await fetchText(url));
  return { url, $ };
}

export async function getCompany(symbol: string): Promise<CompanyData> {
  symbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
  let { url, $ } = await loadPage(symbol, true);
  let basis: CompanyData["basis"] = "consolidated";
  // Companies without subsidiaries have an empty consolidated view — fall back.
  if (!row(parseTable($, "quarters"), "Sales", "Revenue").some((v) => v !== null)) {
    ({ url, $ } = await loadPage(symbol, false));
    basis = "standalone";
  }

  const ratios: Record<string, string> = {};
  $("#top-ratios li").each((_, e) => {
    ratios[$(e).find(".name").text().trim()] = $(e).find(".value").text().replace(/\s+/g, " ").trim();
  });

  const bseLink = $('a[href*="bseindia.com/stock-share-price"]').attr("href") ?? "";
  const quarters = parseTable($, "quarters");

  return {
    symbol,
    name: $("h1").first().text().trim(),
    screenerId: $("[data-company-id]").first().attr("data-company-id") ?? "",
    bseCode: bseLink.match(/\/(\d{6})\//)?.[1],
    url,
    about: $(".company-profile .about p").text().replace(/\s+/g, " ").trim(),
    ratios,
    isBank: !!quarters?.rows.some((r) => r.label.startsWith("Financing Profit")),
    basis,
    quarters,
    pl: parseTable($, "profit-loss"),
    bs: parseTable($, "balance-sheet"),
    cf: parseTable($, "cash-flow"),
    eff: parseTable($, "ratios"),
    annualReports: $("#documents .annual-reports li a")
      .map((_, e) => ({ title: $(e).text().replace(/\s+/g, " ").trim().split(" from ")[0], url: $(e).attr("href") ?? "" }))
      .get()
      .filter((a) => a.url.endsWith(".pdf")),
    concalls: $("#documents .concalls li")
      .map((_, li) => {
        const a = $(li).find("a.button-chip");
        return {
          period: $(li).find("div").first().text().trim(),
          transcript: a.filter((__, x) => $(x).text().trim() === "Transcript").attr("href"),
          ppt: a.filter((__, x) => $(x).text().trim() === "PPT").attr("href"),
        };
      })
      .get(),
  };
}

/* ---------- filings feed ---------- */

export async function getAnnouncements(screenerId: string, symbol: string, company: string) {
  const $ = cheerio.load(await fetchText(`${BASE}/announcements/recent/${screenerId}/`));
  return $("ul.list-links li a")
    .map((_, a) => {
      const meta = $(a).find("div").first();
      const date = meta.find("time").attr("datetime") ?? "";
      const summary = meta.text().replace(/\s+/g, " ").trim().replace(/^[^-]*-\s*/, "").replace(/…$/, "…");
      meta.remove();
      const url = $(a).attr("href") ?? "";
      return { id: hash(url), symbol, company, title: $(a).text().replace(/\s+/g, " ").trim(), summary, date, url };
    })
    .get()
    .filter((x) => x.date) as Pick<Announcement, "id" | "symbol" | "company" | "title" | "summary" | "date" | "url">[];
}

/* ---------- EOD price & volume ---------- */

export async function getPrices(screenerId: string, days = 120): Promise<PricePoint[]> {
  const j = JSON.parse(await fetchText(`${BASE}/api/company/${screenerId}/chart/?q=Price-Volume&days=${days}`));
  const price = j.datasets.find((d: { metric: string }) => d.metric === "Price")?.values ?? [];
  const vol = new Map<string, number>(
    (j.datasets.find((d: { metric: string }) => d.metric === "Volume")?.values ?? []).map((v: [string, number]) => [v[0], v[1]]),
  );
  return price.map(([d, c]: [string, string]) => ({ d, c: Number(c), v: vol.get(d) ?? 0 }));
}

/* ---------- ticker search (pull side: any company) ---------- */

export async function search(q: string) {
  const j = JSON.parse(await fetchText(`${BASE}/api/company/search/?q=${encodeURIComponent(q)}&v=3&fts=1`));
  return (j as { name: string; url: string }[])
    .filter((x) => x.url?.startsWith("/company/"))
    .map((x) => ({ name: x.name, symbol: x.url.split("/")[2] }))
    .slice(0, 8);
}
