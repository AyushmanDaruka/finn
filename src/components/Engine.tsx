"use client";
import type { Digest } from "@/lib/types";
import { Card, SectionTitle } from "./ui";

const PIPE: [string, string, string][] = [
  ["Rules", "free", "Exchange subject lines are semi-standard. Ordered rules classify most filings and size them against market cap — a ₹7 lakh fine is noise for a ₹10 lakh-crore bank."],
  ["Flash-Lite", "cheap", "Only filings the rules can't place, sent together in one batched call. Also parses people out of management-change filings."],
  ["Flash", "mid", "Reads long primary documents: the P&L pages of a results filing (not all 30 pages) and full earnings-call transcripts."],
  ["Pro", "rare", "The two judgment calls: did management deliver what it promised, and the bull/bear case."],
  ["Code", "free", "Arithmetic never goes to a model: EBITDA, QoQ/YoY, CAGR, cash conversion, D/E, unusual-move detection."],
  ["Cache", "free", "Every model call is keyed by a hash of its inputs. A document is read once, ever; re-runs cost nothing."],
];

export default function Engine({ d }: { d: Digest }) {
  const paid = d.cost.filter((c) => !c.cached);
  const usd = paid.reduce((s, c) => s + c.usd, 0);
  const byModel = paid.reduce<Record<string, { n: number; usd: number }>>((m, c) => ((m[c.model] ??= { n: 0, usd: 0 }), m[c.model].n++, (m[c.model].usd += c.usd), m), {});
  const ruled = d.stats.total ? Math.round((d.stats.byRules / d.stats.total) * 100) : 0;
  return (
    <div>
      <p className="px-1 text-[13px] leading-snug text-ink-2">
        FINN spends attention and money the same way: cheaply by default, expensively only where judgment is needed.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat k="filings by rules" v={`${ruled}%`} />
        <Stat k="model calls" v={String(paid.length)} />
        <Stat k="total cost" v={`$${usd.toFixed(3)}`} />
      </div>
      <p className="mt-2 px-1 text-[11px] text-muted">Runs on Gemini&rsquo;s free tier; cost shown at paid list prices. Last run: {d.stats.total} new filings, {d.stats.byRules} by rules, {d.stats.byLlm} by model.</p>

      <SectionTitle>Routing</SectionTitle>
      <div className="space-y-2">
        {PIPE.map(([name, tier, what]) => (
          <Card key={name} className="!p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold">{name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted">{tier}</span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-ink-2">{what}</p>
          </Card>
        ))}
      </div>

      {paid.length > 0 && (
        <>
          <SectionTitle>Spend by model</SectionTitle>
          <Card className="divide-y divide-line !py-1">
            {Object.entries(byModel).map(([m, x]) => (
              <div key={m} className="flex justify-between py-2 text-[12px]">
                <span className="text-ink-2">{m}</span>
                <span className="num">{x.n} calls · ${x.usd.toFixed(4)}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Sources</SectionTitle>
      <Card className="space-y-1.5 text-[12px] text-ink-2">
        <p>Filings, financial tables, transcripts, annual reports, EOD price & volume — via screener.in, linking to the original BSE PDFs.</p>
        <p>Research uses primary sources only. People backgrounds on management changes come from web search and are labelled as such.</p>
        <p className="text-muted">Data as of {new Date(d.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST · refreshed after every market close.</p>
      </Card>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <div className="num text-[18px] font-semibold">{v}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
    </div>
  );
}
