"use client";
import { useEffect, useState } from "react";
import type { Digest } from "@/lib/types";
import { DEFAULTS, type Settings } from "@/lib/signals";
import Today from "./Today";
import Alerts from "./Alerts";
import Research from "./Research";
import Engine from "./Engine";

const TABS = [
  { id: "today", label: "Today", icon: "◉" },
  { id: "alerts", label: "Alerts", icon: "◇" },
  { id: "research", label: "Research", icon: "⌕" },
  { id: "engine", label: "Engine", icon: "≡" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const KEY = "finn.settings.v1";

export default function App({ d, demo }: { d: Digest; demo: string[] }) {
  const [tab, setTab] = useState<Tab>("today");
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [initial, setInitial] = useState<string>();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setS({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {}
    // Deep links: #research/DIXON opens a report; ?w=7d sets the digest window.
    const [h, arg] = location.hash.slice(1).split("/") as [Tab, string?];
    if (TABS.some((t) => t.id === h)) setTab(h);
    if (h === "research" && arg) setInitial(arg.toUpperCase());
    const w = { "24h": 24, "3d": 72, "7d": 168, "30d": 720 }[new URLSearchParams(location.search).get("w") ?? ""];
    if (w) setS((p) => ({ ...p, windowH: w }));
  }, []);

  const set = (p: Partial<Settings>) =>
    setS((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); window.scrollTo(0, 0); };

  const asOf = new Date(d.generatedAt);
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] pb-28">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-bg/85 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-baseline justify-between">
          <div className="text-[17px] font-bold tracking-tight">
            FINN<span className="text-accent">.</span>
          </div>
          <div className="text-[11px] text-muted">
            {asOf.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · as of{" "}
            {asOf.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
          </div>
        </div>
      </header>

      <main className="px-4 pt-4">
        {tab === "today" && <Today d={d} s={s} set={set} />}
        {tab === "alerts" && <Alerts d={d} s={s} set={set} />}
        {tab === "research" && <Research demo={demo} holdings={d.holdings.map((h) => h.symbol)} initial={initial} />}
        {tab === "engine" && <Engine d={d} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[480px] justify-around">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => go(t.id)} className={`flex w-20 flex-col items-center gap-0.5 py-1 text-[11px] ${tab === t.id ? "text-ink" : "text-muted"}`}>
              <span className={`text-[18px] leading-none ${tab === t.id ? "text-accent" : ""}`}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
