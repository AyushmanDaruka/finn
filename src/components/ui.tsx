"use client";
import type { ReactNode } from "react";

export const cr = (n: number | null | undefined) =>
  n == null ? "–" : Math.abs(n) >= 1e7 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1000 ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

export const pct = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;

export const ago = (iso: string, asOf: number) => {
  const h = (asOf - Date.parse(iso)) / 3600e3;
  return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

export function Delta({ v, suffix = "%", className = "" }: { v: number | null; suffix?: string; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={`num text-muted ${className}`}>–</span>;
  const up = v >= 0;
  return (
    <span className={`num ${up ? "text-up" : "text-down"} ${className}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}
      {suffix}
    </span>
  );
}

export function Chip({ children, tone = "plain", onClick, active }: { children: ReactNode; tone?: "plain" | "accent" | "up" | "down" | "watch"; onClick?: () => void; active?: boolean }) {
  const t = {
    plain: active ? "bg-ink text-bg border-ink" : "border-line text-ink-2",
    accent: "border-accent/40 text-accent bg-accent/10",
    up: "border-up/40 text-up bg-up/10",
    down: "border-down/40 text-down bg-down/10",
    watch: "border-watch/40 text-watch bg-watch/10",
  }[tone];
  const C = onClick ? "button" : "span";
  return (
    <C onClick={onClick} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${t}`}>
      {children}
    </C>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rise rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Src({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
      {children} ↗
    </a>
  );
}

/** Single-series sparkline: 2px line, last point marked. */
export function Spark({ data, w = 96, h = 28, tone }: { data: number[]; w?: number; h?: number; tone?: "up" | "down" }) {
  const xs = data.filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const min = Math.min(...xs), max = Math.max(...xs), r = max - min || 1;
  const pts = xs.map((v, i) => [(i / (xs.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / r) * (h - 6)]);
  const t = tone ?? (xs.at(-1)! >= xs[0] ? "up" : "down");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={`var(--${t})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={2.5} fill={`var(--${t})`} />
    </svg>
  );
}

/** Single-series bars with per-bar hover value; negative bars drop below the baseline in the down colour. */
export function Bars({ labels, values, h = 84, fmt = cr, highlightLast = true }: { labels: string[]; values: (number | null)[]; h?: number; fmt?: (n: number) => string; highlightLast?: boolean }) {
  const vs = values.map((v) => v ?? 0);
  const max = Math.max(...vs.map(Math.abs), 1);
  const hasNeg = vs.some((v) => v < 0);
  const base = hasNeg ? h / 2 : h;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${values.length * 20} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none" role="img">
        {vs.map((v, i) => {
          const bh = (Math.abs(v) / max) * (hasNeg ? h / 2 - 2 : h - 2);
          const y = v >= 0 ? base - bh : base;
          const last = highlightLast && i === vs.length - 1;
          return (
            <g key={i}>
              <title>{`${labels[i]}: ${values[i] == null ? "–" : fmt(values[i]!)}`}</title>
              <rect x={i * 20 + 3} y={0} width={14} height={h} fill="transparent" />
              <rect x={i * 20 + 3} y={y} width={14} height={Math.max(bh, 1)} rx={3} fill={v < 0 ? "var(--down)" : last ? "var(--ink)" : "var(--ink-2)"} opacity={last ? 1 : 0.45} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted num">
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </div>
    </div>
  );
}
