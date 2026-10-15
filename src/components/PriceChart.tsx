"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_RANGE, priceDomain, RANGES, TOUCH_TIERS, type ChartData, type RangeId, type TouchOutcome } from "@/lib/chart/series";
import { TIER_LABEL_TH, type Tier } from "@/lib/support/types";
import { Spinner } from "./Spinner";

/** Drawn at the real width of the card (measured), so the labels keep their size on a phone and on a desktop. */
const PAD = { top: 10, right: 58, bottom: 22, left: 4 };
const heightFor = (width: number) => Math.round(Math.min(240, Math.max(170, width * 0.48)));

/** Same colours as the tier badges. */
const TIER_STROKE: Record<Tier, string> = { minor: "text-warning", intermediate: "text-caution", major: "text-danger" };

const usd = (n: number) => (n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
const OUTCOME_LABEL: Record<TouchOutcome, string> = { held: "รับได้", broken: "หลุด", unclear: "ไม่ชัด", open: "ยังไม่จบ" };

/** One request per symbol and range per page view (the data changes once a day). */
const cache = new Map<string, Promise<ChartData>>();
function load(symbol: string, range: RangeId): Promise<ChartData> {
  const key = `${symbol}:${range}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/history/${encodeURIComponent(symbol)}?range=${range}`).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ChartData;
    });
    p.catch(() => cache.delete(key)); // a failure may be retried later
    cache.set(key, p);
  }
  return p;
}

function dateLabel(d: string, weekly: boolean): string {
  const [y, m, day] = d.split("-");
  return weekly ? `${m}/${y}` : `${day}/${m}/${y.slice(2)}`;
}

/** Labels on the right edge, pushed apart so they never overlap. */
function spread(ys: { y: number; key: string }[], gap = 13): Map<string, number> {
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  const out = new Map<string, number>();
  let last = -Infinity;
  for (const s of sorted) {
    const y = Math.max(s.y, last + gap);
    out.set(s.key, y);
    last = y;
  }
  return out;
}

function Chart({ data, levels, symbol, width: W }: { data: ChartData; levels: { tier: Tier; price: number }[]; symbol: string; width: number }) {
  const gradient = useId();
  const H = heightFor(W);
  const pts = data.points;
  const t0 = Date.parse(pts[0].d);
  const t1 = Date.parse(pts[pts.length - 1].d);
  const [lo, hi] = priceDomain(pts, levels.map((l) => l.price));
  const x = (d: string) => PAD.left + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const inView = (v: number) => v >= lo && v <= hi;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const area = `${line}L${x(pts[pts.length - 1].d).toFixed(1)},${H - PAD.bottom}L${x(pts[0].d).toFixed(1)},${H - PAD.bottom}Z`;
  const last = pts[pts.length - 1];
  const shown = levels.filter((l) => inView(l.price));
  const labels = spread([...shown.map((l) => ({ key: l.tier, y: y(l.price) })), { key: "last", y: y(last.c) }]);
  const mid = pts[Math.floor(pts.length / 2)];
  const first = pts[0].c;
  const change = ((last.c - first) / first) * 100;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`กราฟราคาปิด ${symbol} ช่วง ${RANGES.find((r) => r.id === data.range)?.label}: จาก ${usd(first)} เป็น ${usd(last.c)} (${change >= 0 ? "+" : ""}${change.toFixed(1)}%) พร้อมเส้นแนวรับปัจจุบัน`}
      width={W}
      height={H}
      className="block select-none"
    >
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* baseline */}
      <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-border" strokeWidth={1} />

      {/* price */}
      <g className="text-primary">
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.d)} cy={y(last.c)} r={3.5} fill="currentColor" />
      </g>

      {/* current support levels */}
      {shown.map((l) => (
        <g key={l.tier} className={TIER_STROKE[l.tier]}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(l.price)} y2={y(l.price)} stroke="currentColor" strokeWidth={1.25} strokeDasharray="5 4" opacity={0.85} />
          <text x={W - PAD.right + 6} y={labels.get(l.tier)! + 4} fill="currentColor" fontSize={11} fontFamily="var(--font-plex-mono)">
            {usd(l.price)}
          </text>
        </g>
      ))}
      <text x={W - PAD.right + 6} y={labels.get("last")! + 4} className="fill-foreground" fontSize={11} fontWeight={600} fontFamily="var(--font-plex-mono)">
        {usd(last.c)}
      </text>

      {/* past touches of the levels (backtest replay) */}
      {data.touches.filter((t) => inView(t.level) && Date.parse(t.d) >= t0).map((t, i) => {
        const cx = x(t.d);
        const cy = y(t.level);
        return (
          <g key={`${t.d}-${t.tier}-${i}`}>
            <title>{`${t.d} · ${TIER_LABEL_TH[t.tier]} ${usd(t.level)} · ${OUTCOME_LABEL[t.outcome]}`}</title>
            {t.outcome === "held" ? (
              <circle cx={cx} cy={cy} r={3.5} className="fill-success stroke-background" strokeWidth={1} />
            ) : t.outcome === "broken" ? (
              <circle cx={cx} cy={cy} r={3.5} className="fill-background stroke-danger" strokeWidth={1.75} />
            ) : (
              <circle cx={cx} cy={cy} r={2.5} className="fill-muted" opacity={0.7} />
            )}
          </g>
        );
      })}

      {/* dates */}
      {[pts[0], mid, last].map((p, i) => (
        <text
          key={i}
          x={i === 0 ? PAD.left : i === 2 ? W - PAD.right : x(p.d)}
          y={H - 6}
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          className="fill-muted"
          fontSize={11}
          fontFamily="var(--font-plex-mono)"
        >
          {dateLabel(p.d, data.weekly)}
        </text>
      ))}
    </svg>
  );
}

/** Shown while a range loads: the outline of a chart, pulsing, with a spinner, so the space is visibly busy. */
function ChartSkeleton() {
  return (
    <div role="status" className="absolute inset-0 overflow-hidden rounded-xl bg-raised">
      <svg viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full animate-pulse text-muted">
        <path d="M0,88 C30,80 45,60 70,66 S110,92 140,70 S190,30 220,44 S270,70 320,36" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {[52, 74, 92].map((y) => (
          <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted">
        <Spinner className="text-primary" />
        กำลังโหลดกราฟ…
      </span>
    </div>
  );
}

/**
 * Daily closes (weekly over 5 years) with the current support levels as dashed lines and every past touch of a level
 * from the backtest replay: filled = held, ring = broke. Choosing the range only changes what is shown, so visitors
 * of the read-only site may use it too.
 */
export function PriceChart({ symbol, levels }: { symbol: string; levels: { tier: Tier; price: number }[] }) {
  const [range, setRange] = useState<RangeId>(DEFAULT_RANGE);
  const [state, setState] = useState<{ range: RangeId; data: ChartData | null; error: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(symbol, range).then(
      (data) => !cancelled && setState({ range, data, error: false }),
      () => !cancelled && setState({ range, data: null, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  const current = state?.range === range ? state : null; // null while the chosen range loads
  const data = current?.data ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">ราคาปิด{data?.weekly ? "รายสัปดาห์" : "รายวัน"}</span>
        <div role="radiogroup" aria-label="ช่วงเวลาของกราฟ" className="flex rounded-full bg-raised p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              onClick={() => setRange(r.id)}
              className={`min-h-9 min-w-11 cursor-pointer rounded-full px-2.5 font-mono text-xs transition-colors duration-150 ${
                range === r.id ? "bg-foreground font-medium text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={box} className="relative w-full" style={{ height: heightFor(width || 360) }}>
        {current === null ? (
          <ChartSkeleton />
        ) : current.error ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-muted">โหลดกราฟไม่ได้ ลองเปิดใหม่อีกครั้ง</p>
        ) : !data || data.points.length < 2 ? (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">ยังไม่มีราคาย้อนหลัง จะแสดงหลังรอบคำนวณรายวัน</p>
        ) : width > 0 ? (
          <Chart data={data} levels={levels} symbol={symbol} width={width} />
        ) : (
          <ChartSkeleton />
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 16 4" className="h-1 w-4 text-muted" aria-hidden="true">
            <line x1="0" x2="16" y1="2" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          แนวรับปัจจุบัน
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-success" aria-hidden="true" /> เคยแตะแล้วรับได้
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full ring-[1.5px] ring-danger" aria-hidden="true" /> เคยแตะแล้วหลุด
        </span>
        {TOUCH_TIERS[range].length < 3 && <span>(จุดในช่วงนี้: เฉพาะ{TOUCH_TIERS[range].map((t) => TIER_LABEL_TH[t]).join(" และ ")})</span>}
      </p>
    </div>
  );
}
