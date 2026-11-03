"use client";
import { useEffect, useRef, useState } from "react";
import type { PromiseItem, Research as R, Verdict } from "@/lib/research";
import { Bars, Card, Chip, SectionTitle, Src, cr } from "./ui";

const VERDICT: Record<Verdict, { label: string; tone: "up" | "down" | "watch" | "plain"; icon: string }> = {
  delivered: { label: "Delivered", tone: "up", icon: "✓" },
  partly: { label: "Partly", tone: "watch", icon: "◐" },
  missed: { label: "Missed", tone: "down", icon: "✕" },
  moved: { label: "Goalposts moved", tone: "down", icon: "↪" },
  pending: { label: "Pending", tone: "plain", icon: "…" },
  unverifiable: { label: "Can't verify", tone: "plain", icon: "?" },
};

export default function Research({ demo, holdings, initial }: { demo: string[]; holdings: string[]; initial?: string }) {
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<{ name: string; symbol: string }[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [data, setData] = useState<R | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.length < 2) return setSugg([]);
    timer.current = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setSugg).catch(() => {}), 250);
  }, [q]);

  useEffect(() => {
    if (initial) run(initial);
  }, [initial]);

  async function run(symbol: string) {
    history.replaceState(null, "", `#research/${symbol}`);
    setQ(""); setSugg([]); setData(null); setErr(""); setSteps([]); setBusy(true);
    try {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(symbol)}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const l of lines.filter(Boolean)) {
          const m = JSON.parse(l);
          if (m.type === "progress") setSteps((s) => [...s, m.msg]);
          if (m.type === "done") setData(m.data);
          if (m.type === "error") setErr(m.msg);
        }
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q.trim() && run(sugg[0]?.symbol ?? q.trim())}
          placeholder="Any NSE company or ticker…"
          className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] outline-none placeholder:text-muted focus:border-accent/60"
        />
        {sugg.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-xl">
            {sugg.map((x) => (
              <button key={x.symbol} onClick={() => run(x.symbol)} className="flex w-full justify-between px-4 py-2.5 text-left text-[13px] hover:bg-surface">
                <span className="truncate">{x.name}</span>
                <span className="num text-muted">{x.symbol}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!data && !busy && (
        <>
          <SectionTitle>Ready to open</SectionTitle>
          <div className="flex flex-wrap gap-2">{demo.map((s) => <Chip key={s} tone="accent" onClick={() => run(s)}>{s}</Chip>)}</div>
          <SectionTitle>Your holdings</SectionTitle>
          <div className="flex flex-wrap gap-1.5">{holdings.map((s) => <Chip key={s} onClick={() => run(s)}>{s}</Chip>)}</div>
          <p className="mt-6 px-1 text-[12px] leading-relaxed text-muted">
            Research reads only primary sources: the company’s filed financials and its own earnings-call transcripts. No news, no broker notes, no model memory. Every quote is checked word-for-word against the transcript before it is shown.
          </p>
        </>
      )}
      {busy && (
        <Card className="mt-4">
          {steps.map((s, i) => (
            <div key={i} className={`flex items-center gap-2 py-1 text-[13px] ${i === steps.length - 1 ? "text-ink" : "text-muted"}`}>
              <span>{i === steps.length - 1 ? "◌" : "✓"}</span>
              {s}
            </div>
          ))}
          {!steps.length && <div className="text-[13px] text-muted">Starting…</div>}
          <div className="mt-2 text-[11px] text-muted">First read of a new company takes ~1 minute. It is cached after that.</div>
        </Card>
      )}
      {err && <Card className="mt-4 text-[13px] text-down">{err}</Card>}
      {data && <Report r={data} />}
    </div>
  );
}

function Report({ r }: { r: R }) {
  const usd = r.cost.reduce((a, c) => a + c.usd, 0);
  const calls = r.cost.filter((c) => !c.cached).length;
  const tiles: [string, string][] = [
    ["Price", r.ratios["Current Price"]],
    ["Mkt cap", r.ratios["Market Cap"]?.replace(" Cr.", " Cr")],
    ["P/E", r.ratios["Stock P/E"]],
    ["ROCE", r.ratios["ROCE"]],
    ["ROE", r.ratios["ROE"]],
    ["Sales 3y CAGR", r.growth.sales3y == null ? "–" : `${r.growth.sales3y.toFixed(0)}%`],
  ];
  return (
    <div className="rise">
      <div className="mt-5 px-1">
        <h1 className="text-[22px] font-semibold tracking-tight">{r.name}</h1>
        <p className="mt-1 text-[13px] leading-snug text-ink-2">{r.business?.line ?? r.about}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {tiles.map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
            <div className="num truncate text-[14px] font-semibold">{v ?? "–"}</div>
          </div>
        ))}
      </div>

      {r.promises ? <Promises p={r.promises} /> : null}

      <SectionTitle>Trajectory · quarterly</SectionTitle>
      <Card className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 text-[11px] text-muted">Revenue ₹ Cr</div>
          <Bars labels={r.quarters.labels} values={r.quarters.sales} />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted">{r.isBank ? "Net profit ₹ Cr" : "EBITDA margin %"}</div>
          <Bars labels={r.quarters.labels} values={r.isBank ? r.quarters.pat : r.quarters.opm} fmt={(n) => (r.isBank ? cr(n) : `${n}%`)} />
        </div>
      </Card>

      {r.flags.length > 0 && (
        <>
          <SectionTitle>What the numbers say</SectionTitle>
          <Card className="space-y-2">
            {r.flags.map((f, i) => (
              <div key={i} className="flex gap-2 text-[13px] leading-snug">
                <span className={f.tone === "good" ? "text-up" : f.tone === "bad" ? "text-down" : "text-watch"}>{f.tone === "good" ? "▲" : f.tone === "bad" ? "▼" : "◆"}</span>
                <span className="text-ink-2">{f.text}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      {r.business?.segments.length ? (
        <>
          <SectionTitle right={r.business.url ? <Src href={`${r.business.url}#page=${r.business.page ?? 1}`}>Transcript</Src> : null}>Business this quarter</SectionTitle>
          <Card className="divide-y divide-line !py-1">
            {r.business.segments.map((s) => (
              <div key={s.name} className="py-2.5">
                <div className="text-[13px] font-medium">{s.name}</div>
                <div className="text-[12px] text-ink-2">{s.note}</div>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {r.cash && r.balance && (
        <>
          <SectionTitle>Cash & balance sheet · annual</SectionTitle>
          <Card className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-[11px] text-muted">Operating cash vs profit</div>
              <Pairs labels={r.cash.labels} a={r.cash.cfo} b={r.cash.pat} />
              <div className="mt-1 text-[11px] text-ink-2">
                5-yr conversion <span className="num font-semibold text-ink">{r.cash.conversion5y ?? "–"}%</span>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted">Debt / equity</div>
              <Bars labels={r.balance.labels} values={r.balance.de} fmt={(n) => `${n}×`} />
              <div className="mt-1 text-[11px] text-ink-2">
                Cash cycle <span className="num font-semibold text-ink">{r.balance.ccc.filter((x) => x != null).at(-1) ?? "–"} days</span>
              </div>
            </div>
          </Card>
        </>
      )}

      {r.bullBear && (
        <>
          <SectionTitle>Bull vs bear</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["bull", "bear"] as const).map((k) => (
              <Card key={k} className="!p-3.5">
                <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${k === "bull" ? "text-up" : "text-down"}`}>{k}</div>
                <ul className="space-y-2.5">
                  {r.bullBear![k].map((p, i) => (
                    <li key={i} className="text-[13px] leading-snug">
                      {p.point}
                      <div className="mt-0.5 text-[11px] text-muted">based on: {p.basis}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      {r.notes.length > 0 && <div className="mt-4 space-y-1 px-1 text-[11px] text-muted">{r.notes.map((n) => <p key={n}>{n}</p>)}</div>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-[11px] text-muted">
        <span>
          {calls} model calls · <span className="num">${usd.toFixed(4)}</span> at paid rates · {r.basis} figures
        </span>
        <Src href={r.url}>Filed financials</Src>
      </div>
    </div>
  );
}

function Promises({ p }: { p: NonNullable<R["promises"]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const counts = p.items.reduce<Record<string, number>>((m, x) => ((m[x.verdict ?? "pending"] = (m[x.verdict ?? "pending"] ?? 0) + 1), m), {});
  const [showAll, setShowAll] = useState(false);
  const checkable = (x: PromiseItem) => showAll || x.verdict !== "unverifiable";
  const unver = p.items.filter((x) => x.verdict === "unverifiable").length;
  const byCall = p.calls.map((c) => ({ ...c, items: p.items.filter((x) => x.said === c.period && checkable(x)) })).filter((c) => c.items.length).reverse();
  const score = p.score;
  return (
    <>
      <SectionTitle right={<span className="text-[11px] text-muted">last {p.calls.length} earnings calls</span>}>Promised vs delivered</SectionTitle>
      <Card>
        <div className="flex items-center gap-4">
          <Ring v={score} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted">Management credibility</div>
            <p className="mt-0.5 text-[14px] font-medium leading-snug">{p.summary}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(Object.keys(VERDICT) as Verdict[]).filter((v) => counts[v]).map((v) => (
            <Chip key={v} tone={VERDICT[v].tone}>
              {VERDICT[v].icon} {counts[v]} {VERDICT[v].label.toLowerCase()}
            </Chip>
          ))}
        </div>
      </Card>
      <div className="mt-2 space-y-2">
        {byCall.map((c) => (
          <div key={c.period}>
            <div className="mb-1 mt-3 flex items-center justify-between px-1 text-[11px] text-muted">
              <span>Said on the {c.period} call</span>
              <Src href={c.url}>Transcript</Src>
            </div>
            <div className="space-y-2">
              {c.items.map((x) => (
                <PromiseRow key={x.id} x={x} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {unver > 0 && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2 w-full rounded-2xl border border-dashed border-line px-4 py-2.5 text-left text-[12px] text-muted">
          {showAll ? "Hide" : "Show"} {unver} operational targets (capacity, segments, volumes) that filed financials can’t verify {showAll ? "▴" : "▾"}
        </button>
      )}
      <p className="mt-2 px-1 text-[11px] text-muted">
        Each quote is verified word-for-word in the transcript{p.dropped ? ` — ${p.dropped} extracted ${p.dropped === 1 ? "claim" : "claims"} failed that check and were discarded` : ""}.
      </p>
    </>
  );
}

function PromiseRow({ x, open, toggle }: { x: PromiseItem; open: boolean; toggle: () => void }) {
  const v = VERDICT[x.verdict ?? "pending"];
  return (
    <button onClick={toggle} className="block w-full rounded-2xl border border-line bg-surface p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">
            {x.metric}: <span className="text-accent">{x.target}</span>
          </div>
          <div className="text-[11px] text-muted">by {x.horizon}</div>
        </div>
        <Chip tone={v.tone}>
          {v.icon} {v.label}
        </Chip>
      </div>
      {x.evidence && <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{x.evidence}</p>}
      {open && (
        <div className="mt-2 border-l-2 border-accent/50 pl-3">
          <p className="text-[12px] italic leading-snug text-ink">“{x.quote}”</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
            {x.speaker && <span>— {x.speaker}</span>}
            <a href={`${x.url}#page=${x.page}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline">
              p.{x.page} ↗
            </a>
          </div>
        </div>
      )}
      {!open && <div className="mt-1 text-[10px] text-muted">tap for the exact quote</div>}
    </button>
  );
}

function Ring({ v }: { v: number | null }) {
  const r = 26, c = 2 * Math.PI * r;
  const tone = v == null ? "muted" : v >= 70 ? "up" : v >= 45 ? "watch" : "down";
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" className="shrink-0">
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--line)" strokeWidth={5} />
      {v != null && <circle cx={32} cy={32} r={r} fill="none" stroke={`var(--${tone})`} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 32 32)" />}
      <text x={32} y={37} textAnchor="middle" className="num" fontSize={16} fontWeight={600} fill="var(--ink)">
        {v ?? "–"}
      </text>
    </svg>
  );
}

/** Operating cash (solid) next to profit (outline) per year — single scale, so the gap reads directly. */
function Pairs({ labels, a, b }: { labels: string[]; a: (number | null)[]; b: (number | null)[] }) {
  const max = Math.max(...a.map((x) => Math.abs(x ?? 0)), ...b.map((x) => Math.abs(x ?? 0)), 1);
  const h = 84;
  return (
    <div>
      <svg viewBox={`0 0 ${labels.length * 24} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
        {labels.map((l, i) => {
          const ha = (Math.max(a[i] ?? 0, 0) / max) * (h - 2), hb = (Math.max(b[i] ?? 0, 0) / max) * (h - 2);
          return (
            <g key={l}>
              <title>{`${l}: cash ${cr(a[i])} vs profit ${cr(b[i])}`}</title>
              <rect x={i * 24 + 3} y={h - ha} width={8} height={Math.max(ha, 1)} rx={2} fill="var(--ink)" />
              <rect x={i * 24 + 13} y={h - hb + 1} width={7} height={Math.max(hb - 1, 1)} rx={2} fill="none" stroke="var(--ink-2)" strokeWidth={1.2} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-3 text-[10px] text-muted">
        <span>▮ cash from ops</span>
        <span>▯ net profit</span>
      </div>
    </div>
  );
}
