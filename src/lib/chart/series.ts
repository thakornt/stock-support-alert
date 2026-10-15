/** Shared by the server and the browser: plain data only, no imports from server code. */

export const RANGES = [
  { id: "3m", label: "3M", days: 92 },
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 366 },
  { id: "5y", label: "5Y", days: 1830 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];
export const DEFAULT_RANGE: RangeId = "6m";

export const isRange = (v: unknown): v is RangeId => RANGES.some((r) => r.id === v);

export type TouchOutcome = "held" | "broken" | "unclear" | "open";

/** One day (or one week, for long ranges) of the chart. */
export interface ChartPoint {
  /** YYYY-MM-DD */
  d: string;
  c: number;
}

/** A past touch of a support level, from the backtest replay (support_tests). */
export interface ChartTouch {
  d: string;
  level: number;
  tier: "minor" | "intermediate" | "major";
  outcome: TouchOutcome;
}

export interface ChartData {
  range: RangeId;
  /** points are weekly closes (the 5-year view), else daily */
  weekly: boolean;
  points: ChartPoint[];
  touches: ChartTouch[];
}

const DAY_MS = 86_400_000;

/** First day of a range ending `today` (YYYY-MM-DD). */
export function rangeStart(range: RangeId, today: string): string {
  const days = RANGES.find((r) => r.id === range)!.days;
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week that contains `day`, as a key. */
function weekKey(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
}

/** The last close of every week (keeps the 5-year chart at ~260 points, light on a phone). */
export function weeklyCloses(points: ChartPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  let key = "";
  for (const p of points) {
    const k = weekKey(p.d);
    if (k === key) out[out.length - 1] = p;
    else {
      out.push(p);
      key = k;
    }
  }
  return out;
}

/** Most touch markers shown (the newest). */
export const MAX_TOUCHES = 60;

/**
 * Which tiers' touches a range shows. The first support is touched several times a month, so over a year or five its
 * dots would crowd out everything else: longer ranges keep the rarer, more important tiers.
 */
export const TOUCH_TIERS: Record<RangeId, ChartTouch["tier"][]> = {
  "3m": ["minor", "intermediate", "major"],
  "6m": ["minor", "intermediate", "major"],
  "1y": ["intermediate", "major"],
  "5y": ["major"],
};

/**
 * The chart for one range: closes from the range's first day (weekly for 5 years), and the backtest touches that fall
 * inside it (of the tiers that range shows, newest MAX_TOUCHES).
 */
export function buildChart(range: RangeId, today: string, closes: ChartPoint[], touches: ChartTouch[]): ChartData {
  const from = rangeStart(range, today);
  const daily = closes.filter((p) => p.d >= from);
  const weekly = range === "5y";
  const tiers = TOUCH_TIERS[range];
  const inRange = touches.filter((t) => t.d >= from && tiers.includes(t.tier)).sort((a, b) => a.d.localeCompare(b.d));
  return {
    range,
    weekly,
    points: weekly ? weeklyCloses(daily) : daily,
    touches: inRange.slice(-MAX_TOUCHES),
  };
}

/**
 * The price axis: every close plus the current support levels (so their lines are on the chart), with a small margin.
 * A level far below everything (more than `maxBelow`, e.g. 35%) is left off rather than squash the price line.
 */
export function priceDomain(points: ChartPoint[], levels: number[], maxBelow = 0.35): [number, number] {
  if (points.length === 0) return [0, 1];
  let lo = Math.min(...points.map((p) => p.c));
  let hi = Math.max(...points.map((p) => p.c));
  for (const l of levels) {
    if (l >= lo * (1 - maxBelow)) lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  const pad = (hi - lo) * 0.06 || hi * 0.02 || 1;
  return [lo - pad, hi + pad];
}
