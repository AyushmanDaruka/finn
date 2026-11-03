"use client";
import { useMemo, useState } from "react";
import type { Announcement, Digest, ResultsEnrichment } from "@/lib/types";
import { CAT_LABEL, effectiveTier, inWindow, moves, type Move, type Settings } from "@/lib/signals";
import { Card, Chip, Delta, SectionTitle, Spark, Src, ago, cr, pct } from "./ui";

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 72, label: "3d" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

export default function Today({ d, s, set }: { d: Digest; s: Settings; set: (p: Partial<Settings>) => void }) {
  const asOf = Date.parse(d.generatedAt);
  const anns = useMemo(() => inWindow(d, s), [d, s]);
  const mv = useMemo(() => moves(d, s), [d, s]);
  const [showRoutine, setShowRoutine] = useState(false);

  const fresh = anns.filter((a) => !s.seen.includes(a.id));
  const critical = fresh.filter((a) => effectiveTier(a, s) === "critical").sort((a, b) => b.score - a.score);
  const notable = fresh.filter((a) => effectiveTier(a, s) === "notable").sort((a, b) => b.score - a.score);
  const routine = anns.filter((a) => a.tier === "routine");
  const cleared = anns.length - fresh.length;
  const markSeen = (id: string) => set({ seen: [...s.seen, id] });

  const brief = briefText(critical, notable, routine.length, mv);

  return (
    <div>
      {/* window picker */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {WINDOWS.map((w) => (
          <Chip key={w.h} onClick={() => set({ windowH: w.h })} active={s.windowH === w.h}>
            Last {w.label}
          </Chip>
        ))}
      </div>

      {/* FINN speaks first */}
      <div className="mt-5 px-1">
        <p className="text-[22px] font-semibold leading-snug tracking-tight">
          {critical.length ? (
            <>
              <span className="text-accent">{critical.length} {critical.length === 1 ? "thing needs" : "things need"} you.</span>{" "}
            </>
          ) : (
            <span className="text-accent">Nothing needs you. </span>
          )}
          <span className="text-ink-2">
            {notable.length} worth knowing{mv.length ? `, ${mv.length} unusual ${mv.length === 1 ? "move" : "moves"}` : ""}. {routine.length} routine filings hidden.
          </span>
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Listen text={brief} />
          {cleared > 0 && (
            <button className="text-[12px] text-muted underline underline-offset-2" onClick={() => set({ seen: s.seen.filter((id) => !anns.some((a) => a.id === id)) })}>
              {cleared} cleared · restore
            </button>
          )}
        </div>
      </div>

      {critical.length + notable.length < 3 && s.windowH < 168 && (
        <button onClick={() => set({ windowH: 168 })} className="mt-3 px-1 text-[13px] text-accent underline underline-offset-2">
          Quiet window — see the last 7 days →
        </button>
      )}

      {mv.length > 0 && (
        <>
          <SectionTitle>Unusual moves</SectionTitle>
          <div className="space-y-2">{mv.slice(0, 4).map((m) => <MoveRow key={m.symbol + m.d} m={m} />)}</div>
        </>
      )}

      {critical.length > 0 && <SectionTitle>Needs you</SectionTitle>}
      <div className="space-y-3">
        {critical.map((a) => (
          <FilingCard key={a.id} a={a} asOf={asOf} onSeen={() => markSeen(a.id)} big />
        ))}
      </div>

      {notable.length > 0 && <SectionTitle>Worth knowing</SectionTitle>}
      <div className="space-y-2">
        {notable.map((a) => (
          <FilingCard key={a.id} a={a} asOf={asOf} onSeen={() => markSeen(a.id)} />
        ))}
      </div>

      {!critical.length && !notable.length && (
        <Card className="mt-4 text-center text-[14px] text-ink-2">Inbox zero. Widen the window or check back after market close.</Card>
      )}

      <button onClick={() => setShowRoutine(!showRoutine)} className="mt-6 flex w-full items-center justify-between rounded-2xl border border-dashed border-line px-4 py-3 text-left text-[13px] text-muted">
        <span>
          {routine.length} routine filings hidden <span className="text-muted/70">· ESOPs, notices, newspaper ads…</span>
        </span>
        <span>{showRoutine ? "▴" : "▾"}</span>
      </button>
      {showRoutine && (
        <div className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
          {routine.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5">
              <div className="flex justify-between text-[12px]">
                <span className="font-medium text-ink-2">{a.symbol}</span>
                <span className="text-muted">{ago(a.date, asOf)}</span>
              </div>
              <div className="truncate text-[12px] text-muted">{a.summary || a.title}</div>
              <div className="text-[11px] text-muted/80">Hidden because: {a.reason}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function briefText(critical: Announcement[], notable: Announcement[], routine: number, mv: Move[]) {
  const parts = [`Good evening. ${critical.length || "Nothing"} ${critical.length === 1 ? "item needs" : "items need"} your attention.`];
  for (const a of critical.slice(0, 4)) {
    const e = a.enrichment;
    if (e?.kind === "results") {
      const y = pct(e.revenue.current, e.revenue.yearAgoQ), p = pct(e.pat.current, e.pat.yearAgoQ);
      parts.push(`${a.company} results: revenue ${y == null ? "" : `${y >= 0 ? "up" : "down"} ${Math.abs(y).toFixed(0)} percent`}, profit ${p == null ? "" : `${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(0)} percent`} year on year.`);
    } else parts.push(`${a.company}: ${a.summary || a.title}`);
  }
  for (const m of mv.slice(0, 2)) parts.push(`${m.name} moved ${m.ret.toFixed(1)} percent on ${m.volX.toFixed(1)} times normal volume.`);
  parts.push(`${notable.length} more worth knowing, and ${routine} routine filings I've set aside.`);
  return parts.join(" ");
}

function Listen({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  const toggle = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (on) return speechSynthesis.cancel(), setOn(false);
    const u = new SpeechSynthesisUtterance(text);
    u.voice = speechSynthesis.getVoices().find((v) => v.lang === "en-IN") ?? null;
    u.rate = 1.05;
    u.onend = () => setOn(false);
    speechSynthesis.speak(u);
    setOn(true);
  };
  return (
    <button onClick={toggle} className="inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-bg">
      {on ? "■ Stop" : "▶ Listen to brief"}
    </button>
  );
}

function MoveRow({ m }: { m: Move }) {
  return (
    <Card className="!p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold">{m.symbol}</span>
            <Delta v={m.ret} className="text-[13px]" />
            {m.volume && <Chip tone="watch">{m.volX.toFixed(1)}× vol</Chip>}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {new Date(m.d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ₹{cr(m.close)}
            {m.filing ? <> · likely why: <span className="text-ink-2">{CAT_LABEL[m.filing.category].toLowerCase()} filed {new Date(m.filing.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></> : " · no filing explains it"}
          </div>
        </div>
        <Spark data={m.spark} tone={m.ret >= 0 ? "up" : "down"} />
      </div>
    </Card>
  );
}

function FilingCard({ a, asOf, onSeen, big }: { a: Announcement; asOf: number; onSeen: () => void; big?: boolean }) {
  const e = a.enrichment;
  return (
    <Card className={big ? "" : "!p-3.5"}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[14px] font-semibold">{a.symbol}</span>
          <Chip tone={a.tier === "critical" ? "accent" : "plain"}>{CAT_LABEL[a.category]}</Chip>
        </div>
        <span className="shrink-0 text-[11px] text-muted">{ago(a.date, asOf)}</span>
      </div>

      {e?.kind === "results" ? (
        <ResultsBlock r={e} />
      ) : (
        <p className={`mt-2 ${big ? "text-[15px]" : "text-[13px]"} leading-snug text-ink`}>{e?.kind === "oneliner" ? e.text : a.summary || a.title}</p>
      )}

      {e?.kind === "management" && (
        <div className="mt-3 space-y-2">
          {e.changes.map((p, i) => (
            <div key={i} className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">{p.name}</span>
                <Chip tone={p.change === "appointed" ? "up" : p.change === "resigned" ? "down" : "plain"}>{p.change}</Chip>
              </div>
              <div className="text-[12px] text-ink-2">
                {p.role}
                {p.effective ? ` · from ${p.effective}` : ""}
              </div>
              {p.bio && <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{p.bio}</p>}
              {p.bio && <div className="mt-1 text-[10px] text-muted">{p.bioSources?.length ? `Background from the web · ${p.bioSources.length} sources` : "Profile as disclosed in the filing"}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] text-muted">
          <span className="text-accent/80">Why:</span> {a.reason}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-3">
          <Src href={a.url}>Filing</Src>
          {a.related?.length ? <span className="text-[11px] text-muted">+{a.related.length} related</span> : null}
        </div>
        <button onClick={onSeen} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-2 active:bg-surface-2">
          ✓ Clear
        </button>
      </div>
    </Card>
  );
}

function ResultsBlock({ r }: { r: ResultsEnrichment }) {
  const rows: [string, ResultsEnrichment["revenue"]][] = [
    ["Revenue", r.revenue],
    [r.isBank ? "EBITDA" : "EBITDA", r.ebitda],
    ["PBT", r.pbt],
    ["PAT", r.pat],
  ];
  const m = (h: ResultsEnrichment["revenue"], k: keyof ResultsEnrichment["revenue"]) => (h[k] != null && r.revenue[k] ? (h[k]! / r.revenue[k]!) * 100 : null);
  const mNow = m(r.ebitda, "current"), mYa = m(r.ebitda, "yearAgoQ");
  return (
    <div className="mt-2">
      <div className="text-[12px] text-ink-2">
        Q{qOf(r.quarter)} results · {r.basis} · ₹ Cr
      </div>
      <table className="mt-2 w-full text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted">
            <th className="pb-1 text-left font-medium"></th>
            <th className="pb-1 text-right font-medium">{r.quarter.replace(" 20", " '")}</th>
            <th className="pb-1 text-right font-medium">QoQ</th>
            <th className="pb-1 text-right font-medium">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, h]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-ink-2">{k}</td>
              {r.isBank && k === "EBITDA" ? (
                <td colSpan={3} className="py-1.5 text-right text-[11px] text-muted">n/a for lenders</td>
              ) : (
                <>
                  <td className="num py-1.5 text-right">{cr(h.current)}</td>
                  <td className="py-1.5 text-right"><Delta v={pct(h.current, h.prevQ)} /></td>
                  <td className="py-1.5 text-right"><Delta v={pct(h.current, h.yearAgoQ)} /></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {mNow != null && mYa != null && (
        <div className="mt-2 text-[12px] text-ink-2">
          EBITDA margin <span className="num text-ink">{mNow.toFixed(1)}%</span>,{" "}
          <span className={mNow >= mYa ? "text-up" : "text-down"}>
            {mNow >= mYa ? "up" : "down"} {Math.abs((mNow - mYa) * 100).toFixed(0)} bps YoY
          </span>
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-muted">
        {r.source === "filing" ? "Read from the results filing" : "From exchange-reported quarterly figures"}
        {r.crossCheck ? ` · ${r.crossCheck.ok ? "✓" : "⚠"} ${r.crossCheck.note}` : ""}
        {!r.isBank && " · EBITDA = PBT + finance cost + D&A − other income"}
      </div>
    </div>
  );
}

const qOf = (q: string) => ({ Jun: 1, Sep: 2, Dec: 3, Mar: 4 })[q.split(" ")[0] as "Jun"] + " FY" + String(Number(q.split(" ")[1]) + (q.startsWith("Mar") ? 0 : 1)).slice(2);
