"use client";
import { useMemo } from "react";
import type { Digest } from "@/lib/types";
import { CAT_LABEL, DEFAULTS, dayChange, moves, since, type Settings } from "@/lib/signals";
import { Card, Chip, Delta, SectionTitle, Spark, Src, cr } from "./ui";

const WATCHABLE = ["results", "mna", "management_change", "litigation", "fund_raise", "credit_rating", "pledging", "insider_trading", "capex", "dividend", "bonus_split", "press_release"] as const;

export default function Alerts({ d, s, set }: { d: Digest; s: Settings; set: (p: Partial<Settings>) => void }) {
  // Alerts look back a fixed 7 days so the effect of moving a slider is visible immediately.
  const mv = useMemo(() => moves(d, s, 168), [d, s]);
  const filings = useMemo(
    () => d.announcements.filter((a) => Date.parse(a.date) >= since(d, 168) && a.tier !== "routine" && s.cats.includes(a.category)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    [d, s],
  );
  const toggle = (c: (typeof WATCHABLE)[number]) => set({ cats: s.cats.includes(c) ? s.cats.filter((x) => x !== c) : [...s.cats, c] });

  return (
    <div>
      <p className="px-1 text-[13px] leading-snug text-ink-2">
        You decide what “unusual” means. FINN watches all {d.holdings.length} holdings after every close and only interrupts when a rule fires.
      </p>

      <SectionTitle right={<button className="text-[11px] text-muted underline" onClick={() => set({ pricePct: DEFAULTS.pricePct, volX: DEFAULTS.volX, cats: DEFAULTS.cats })}>reset</button>}>
        Your rules
      </SectionTitle>
      <Card className="space-y-5">
        <Slider label="Price move in a day" value={s.pricePct} min={1} max={10} step={0.5} fmt={(v) => `±${v}%`} onChange={(v) => set({ pricePct: v })} />
        <Slider label="Volume vs 20-day average" value={s.volX} min={1.5} max={6} step={0.5} fmt={(v) => `${v}×`} onChange={(v) => set({ volX: v })} />
        <div>
          <div className="mb-2 text-[13px] text-ink-2">Filings allowed to interrupt</div>
          <div className="flex flex-wrap gap-1.5">
            {WATCHABLE.map((c) => (
              <Chip key={c} onClick={() => toggle(c)} active={s.cats.includes(c)}>
                {CAT_LABEL[c]}
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      <SectionTitle right={<span className="text-[11px] text-muted">last 7 days</span>}>Fired · {mv.length + filings.length}</SectionTitle>
      <div className="space-y-2">
        {mv.map((m) => (
          <Card key={m.symbol + m.d} className="!p-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[14px] font-semibold">{m.symbol}</span>
                  {m.price && <Chip tone={m.ret >= 0 ? "up" : "down"}>{m.ret >= 0 ? "+" : ""}{m.ret.toFixed(1)}% day</Chip>}
                  {m.volume && <Chip tone="watch">{m.volX.toFixed(1)}× volume</Chip>}
                </div>
                <div className="mt-1 text-[12px] text-muted">
                  {new Date(m.d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · close ₹{cr(m.close)}
                </div>
                {m.filing && <div className="mt-1 line-clamp-2 text-[12px] text-ink-2">↳ {m.filing.summary || m.filing.title}</div>}
              </div>
              <Spark data={m.spark} tone={m.ret >= 0 ? "up" : "down"} />
            </div>
          </Card>
        ))}
        {filings.map((a) => (
          <Card key={a.id} className="!p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                {a.symbol} <Chip tone="accent">{CAT_LABEL[a.category]}</Chip>
              </span>
              <span className="text-[11px] text-muted">{new Date(a.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] text-ink-2">{a.summary || a.title}</p>
            <div className="mt-1.5"><Src href={a.url}>Filing</Src></div>
          </Card>
        ))}
        {!mv.length && !filings.length && <Card className="text-center text-[13px] text-muted">No rule fired in the last 7 days. Loosen a threshold to see more.</Card>}
      </div>

      <SectionTitle>Portfolio · last close</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {d.holdings.map((h) => (
          <div key={h.symbol} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold">{h.symbol}</div>
              <div className="truncate text-[10px] text-muted">{h.sector}</div>
            </div>
            <Delta v={dayChange(h.prices)} className="text-[12px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="num font-semibold text-accent">{fmt(value)}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
