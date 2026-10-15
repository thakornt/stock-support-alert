import type { GoalId } from "./types";

/**
 * Comparable factors for the stocks being ranked, and a transparent formula ranking used as a yardstick next to the AI's
 * own ranking. Shared by the server and the browser (plain data only).

 *
 * Accuracy rules:
 *  - every factor comes from data the system actually holds, with the definition written next to it;
 *  - a missing figure is skipped, never treated as bad (a young biotech has no P/E: that says nothing about momentum);
 *  - a goal's score needs at least half of its weight covered by real data, otherwise the stock is "not enough data";
 *  - a goal's required figure missing (no dividend for the dividend goal) means the stock does not fit that goal.
 */

export type FactorId =
  | "ret1m" | "ret3m" | "ret6m" | "ret12m" | "vol1y" | "fromHigh52w" | "rebound52wLow" | "maxDrawdown"
  | "pe" | "forwardPe" | "epsGrowthImplied" | "revenueGrowth" | "netMargin" | "dividendYield" | "beta"
  | "marketCapB" | "targetUpside" | "buyShare" | "analystCount" | "supportDistance" | "supportEdge" | "newsScore";

export interface FactorDef {
  id: FactorId;
  label: string;
  unit: "%" | "x" | "$B" | "pp" | "" | "n";
  /** what the number means (shown to the AI and on the page) */
  definition: string;
}

export const FACTORS: FactorDef[] = [
  { id: "ret1m", label: "ผลตอบแทน 1 เดือน", unit: "%", definition: "price change over the last 21 trading days" },
  { id: "ret3m", label: "ผลตอบแทน 3 เดือน", unit: "%", definition: "price change over the last 63 trading days" },
  { id: "ret6m", label: "ผลตอบแทน 6 เดือน", unit: "%", definition: "price change over the last 126 trading days" },
  { id: "ret12m", label: "ผลตอบแทน 12 เดือน", unit: "%", definition: "price change over the last 252 trading days" },
  { id: "vol1y", label: "ความผันผวนจริง 1 ปี", unit: "%", definition: "annualised standard deviation of daily returns over the last 252 trading days" },
  { id: "fromHigh52w", label: "เทียบจุดสูงสุด 52 สัปดาห์", unit: "%", definition: "price versus the highest high of 52 weeks (-20 = 20% below it)" },
  { id: "rebound52wLow", label: "ฟื้นจากจุดต่ำสุด 52 สัปดาห์", unit: "%", definition: "price versus the lowest close of 52 weeks (+30 = 30% above it)" },
  { id: "maxDrawdown", label: "ลงลึกสุดในอดีต", unit: "%", definition: "worst fall from a peak close in ~5 years (-60 = fell 60%)" },
  { id: "pe", label: "P/E", unit: "x", definition: "price / trailing 12-month earnings per share (only when earnings are positive)" },
  { id: "forwardPe", label: "P/E ปีหน้า", unit: "x", definition: "price / expected next-year earnings per share" },
  { id: "epsGrowthImplied", label: "กำไรที่คาดว่าจะโต", unit: "%", definition: "pe / forwardPe - 1: positive = analysts expect earnings to rise, negative = to fall" },
  { id: "revenueGrowth", label: "รายได้โต (ปีต่อปี)", unit: "%", definition: "trailing 12-month revenue versus a year earlier" },
  { id: "netMargin", label: "อัตรากำไรสุทธิ", unit: "%", definition: "net income / revenue, trailing 12 months" },
  { id: "dividendYield", label: "ปันผล", unit: "%", definition: "annual dividend / price" },
  { id: "beta", label: "Beta", unit: "", definition: "sensitivity to the US market (1 = moves with it)" },
  { id: "marketCapB", label: "ขนาดบริษัท", unit: "$B", definition: "market capitalisation in billions of US dollars" },
  { id: "targetUpside", label: "อัพไซด์ถึงราคาเป้า", unit: "%", definition: "analysts' average 12-month target versus the price (an opinion, usually optimistic)" },
  { id: "buyShare", label: "สัดส่วนแนะนำซื้อ", unit: "%", definition: "share of analysts rating buy or strong buy" },
  { id: "analystCount", label: "จำนวนนักวิเคราะห์", unit: "n", definition: "how many analysts rate the stock (fewer = less followed)" },
  { id: "supportDistance", label: "ห่างแนวรับแรก", unit: "%", definition: "how far the price is above the first support level (null when the price is below every level or under a broken one)" },
  { id: "supportEdge", label: "แนวรับแรกดีกว่าระดับสุ่ม", unit: "pp", definition: "this stock's first-support tier held rate minus a random level's held rate, percentage points (needs 8+ past touches)" },
  { id: "newsScore", label: "ทิศทางข่าว", unit: "", definition: "latest AI news brief for the stock: +1 positive / -1 negative / 0 mixed or neutral, times impact (high 2, medium 1, low 0.5)" },
];

export const factorDef = (id: FactorId) => FACTORS.find((f) => f.id === id)!;

/** What the factors are computed from, per stock (all USD; closes oldest first, completed sessions). */
export interface FactorSource {
  symbol: string;
  price: number | null;
  closes: number[];
  high52w: number | null;
  maxDrawdown: number | null;
  pe: number | null;
  forwardPe: number | null;
  revenueGrowth: number | null;
  netMargin: number | null;
  dividendYield: number | null;
  beta: number | null;
  marketCap: number | null;
  targetMean: number | null;
  ratings: { buy: number; hold: number; sell: number } | null;
  /** first support level, null when there is none (below every level) or the price is under a recently broken one */
  firstSupport: number | null;
  firstTierRecord: { held: number; total: number; expectedHeld: number } | null;
  news: { direction: string; impact: string } | null;
}

export type FactorValues = Partial<Record<FactorId, number>>;

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const pct = (a: number, b: number) => (a / b - 1) * 100;

function trailingReturn(closes: number[], price: number, days: number): number | null {
  const base = closes[closes.length - 1 - days];
  return finite(base) && base > 0 ? pct(price, base) : null;
}

function realisedVol(closes: number[], days = 252): number | null {
  const w = closes.slice(-(days + 1));
  if (w.length < 60) return null; // too short to say anything
  const r: number[] = [];
  for (let i = 1; i < w.length; i++) if (w[i - 1] > 0 && w[i] > 0) r.push(Math.log(w[i] / w[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

const NEWS_DIR: Record<string, number> = { positive: 1, negative: -1, mixed: 0, neutral: 0 };
const NEWS_IMPACT: Record<string, number> = { high: 2, medium: 1, low: 0.5 };

/** Raw factor values for one stock; a factor that cannot be computed is left out. */
export function computeFactors(s: FactorSource): FactorValues {
  const out: FactorValues = {};
  const set = (id: FactorId, v: number | null | undefined) => {
    if (finite(v)) out[id] = v;
  };
  const price = s.price ?? s.closes[s.closes.length - 1] ?? null;
  if (finite(price) && price > 0) {
    set("ret1m", trailingReturn(s.closes, price, 21));
    set("ret3m", trailingReturn(s.closes, price, 63));
    set("ret6m", trailingReturn(s.closes, price, 126));
    set("ret12m", trailingReturn(s.closes, price, 252));
    if (finite(s.high52w) && s.high52w > 0) set("fromHigh52w", Math.min(0, pct(price, s.high52w)));
    const year = s.closes.slice(-252);
    if (year.length >= 60) set("rebound52wLow", pct(price, Math.min(...year)));
    if (finite(s.targetMean) && s.targetMean > 0) set("targetUpside", pct(s.targetMean, price));
    if (finite(s.firstSupport) && s.firstSupport > 0) set("supportDistance", pct(price, s.firstSupport));
    if (finite(s.marketCap) && s.marketCap > 0) set("marketCapB", s.marketCap / 1e9);
  }
  set("vol1y", realisedVol(s.closes));
  if (finite(s.maxDrawdown)) set("maxDrawdown", s.maxDrawdown * 100);
  if (finite(s.pe) && s.pe > 0) set("pe", s.pe);
  if (finite(s.forwardPe) && s.forwardPe > 0) set("forwardPe", s.forwardPe);
  if (finite(s.pe) && s.pe > 0 && finite(s.forwardPe) && s.forwardPe > 0) set("epsGrowthImplied", pct(s.pe, s.forwardPe));
  set("revenueGrowth", s.revenueGrowth);
  set("netMargin", s.netMargin);
  if (finite(s.dividendYield) && s.dividendYield > 0) set("dividendYield", s.dividendYield);
  set("beta", s.beta);
  if (s.ratings) {
    const total = s.ratings.buy + s.ratings.hold + s.ratings.sell;
    if (total > 0) {
      set("buyShare", (s.ratings.buy / total) * 100);
      set("analystCount", total);
    }
  }
  if (s.firstTierRecord && s.firstTierRecord.total >= 8) {
    set("supportEdge", ((s.firstTierRecord.held - s.firstTierRecord.expectedHeld) / s.firstTierRecord.total) * 100);
  }
  if (s.news && s.news.direction in NEWS_DIR && s.news.impact in NEWS_IMPACT) set("newsScore", NEWS_DIR[s.news.direction] * NEWS_IMPACT[s.news.impact]);
  return out;
}

/**
 * Percentile position of each stock's value among the stocks that have one: 0 = the lowest value, 100 = the highest
 * (ties share the average position; a factor only one stock has sits at 50). Says nothing about good or bad.
 */
export function percentiles(values: (number | undefined)[]): (number | undefined)[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => finite(x.v)).sort((a, b) => a.v - b.v);
  const out: (number | undefined)[] = values.map(() => undefined);
  const n = present.length;
  if (n === 0) return out;
  if (n === 1) {
    out[present[0].i] = 50;
    return out;
  }
  for (let k = 0; k < n; ) {
    let j = k;
    while (j + 1 < n && present[j + 1].v === present[k].v) j++;
    const avg = (k + j) / 2;
    for (let m = k; m <= j; m++) out[present[m].i] = (avg / (n - 1)) * 100;
    k = j + 1;
  }
  return out;
}

/** +1 = a higher value fits the goal better, -1 = a lower one does. */
interface Weight {
  factor: FactorId;
  weight: number;
  dir: 1 | -1;
}

/** "balanced" = no goal chosen; the others are the page's goals (GOALS in ./types). */
export type FormulaGoal = "balanced" | GoalId;

export const GOAL_WEIGHTS: Record<FormulaGoal, { weights: Weight[]; required?: FactorId }> = {
  balanced: {
    weights: [
      { factor: "revenueGrowth", weight: 1, dir: 1 },
      { factor: "epsGrowthImplied", weight: 1, dir: 1 },
      { factor: "pe", weight: 1, dir: -1 },
      { factor: "netMargin", weight: 1, dir: 1 },
      { factor: "ret6m", weight: 1, dir: 1 },
      { factor: "vol1y", weight: 1, dir: -1 },
    ],
  },
  growth: {
    weights: [
      { factor: "revenueGrowth", weight: 2, dir: 1 },
      { factor: "epsGrowthImplied", weight: 2, dir: 1 },
      { factor: "ret6m", weight: 1, dir: 1 },
    ],
  },
  dividend: {
    required: "dividendYield",
    weights: [
      { factor: "dividendYield", weight: 3, dir: 1 },
      { factor: "netMargin", weight: 1, dir: 1 },
      { factor: "vol1y", weight: 1, dir: -1 },
    ],
  },
  value: {
    weights: [
      { factor: "pe", weight: 2, dir: -1 },
      { factor: "forwardPe", weight: 2, dir: -1 },
      { factor: "epsGrowthImplied", weight: 1, dir: 1 },
      { factor: "netMargin", weight: 1, dir: 1 },
    ],
  },
  stable: {
    weights: [
      { factor: "vol1y", weight: 2, dir: -1 },
      { factor: "beta", weight: 1, dir: -1 },
      { factor: "maxDrawdown", weight: 1, dir: 1 },
      { factor: "netMargin", weight: 1, dir: 1 },
    ],
  },
  dip: {
    required: "supportDistance",
    weights: [
      { factor: "supportDistance", weight: 2, dir: -1 },
      { factor: "supportEdge", weight: 1, dir: 1 },
    ],
  },
  momentum: {
    weights: [
      { factor: "ret3m", weight: 1, dir: 1 },
      { factor: "ret6m", weight: 2, dir: 1 },
      { factor: "ret12m", weight: 1, dir: 1 },
      { factor: "fromHigh52w", weight: 1, dir: 1 },
    ],
  },
  potential: {
    weights: [
      { factor: "targetUpside", weight: 2, dir: 1 },
      { factor: "revenueGrowth", weight: 1, dir: 1 },
      { factor: "marketCapB", weight: 1, dir: -1 },
    ],
  },
  turnaround: {
    weights: [
      { factor: "fromHigh52w", weight: 1, dir: -1 },
      { factor: "rebound52wLow", weight: 2, dir: 1 },
      { factor: "ret1m", weight: 1, dir: 1 },
      { factor: "newsScore", weight: 1, dir: 1 },
    ],
  },
  smallcap: {
    required: "marketCapB",
    weights: [
      { factor: "marketCapB", weight: 3, dir: -1 },
      { factor: "analystCount", weight: 1, dir: -1 },
    ],
  },
};

const MIN_COVERAGE = 0.5;

export interface FormulaRow {
  symbol: string;
  /** 0-100 across the chosen goals, null = not enough data */
  score: number | null;
  /** 1 = best; null when score is null */
  rank: number | null;
  /** share of the chosen goals' weight that had data (0-1) */
  coverage: number;
  /** goals the stock cannot fit because their required figure is missing */
  missingRequired: FormulaGoal[];
}

/**
 * The yardstick ranking: per goal, the weighted average of the direction-adjusted percentiles the stock has data for
 * (null below MIN_COVERAGE; 0 when the goal's required figure is missing), then the mean over the chosen goals.
 */
export function formulaRanking(symbols: string[], values: FactorValues[], goals: FormulaGoal[]): FormulaRow[] {
  const chosen: FormulaGoal[] = goals.length > 0 ? goals : ["balanced"];
  const pctByFactor = new Map<FactorId, (number | undefined)[]>();
  for (const f of FACTORS) pctByFactor.set(f.id, percentiles(values.map((v) => v[f.id])));

  const rows: FormulaRow[] = symbols.map((symbol, i) => {
    const goalScores: number[] = [];
    let covered = 0;
    let total = 0;
    const missingRequired: FormulaGoal[] = [];
    for (const g of chosen) {
      const { weights, required } = GOAL_WEIGHTS[g];
      const sum = weights.reduce((a, w) => a + w.weight, 0);
      total += sum;
      if (required && values[i][required] === undefined) {
        missingRequired.push(g);
        goalScores.push(0); // does not fit this goal
        covered += sum;
        continue;
      }
      let acc = 0;
      let have = 0;
      for (const w of weights) {
        const p = pctByFactor.get(w.factor)![i];
        if (p === undefined) continue;
        acc += w.weight * (w.dir === 1 ? p : 100 - p);
        have += w.weight;
      }
      covered += have;
      if (have / sum >= MIN_COVERAGE) goalScores.push(acc / have);
    }
    const enough = goalScores.length === chosen.length;
    return {
      symbol,
      score: enough ? goalScores.reduce((a, b) => a + b, 0) / goalScores.length : null,
      rank: null,
      coverage: total > 0 ? covered / total : 0,
      missingRequired,
    };
  });

  // on equal scores, a stock that lacks a required figure goes last (paying no dividend is worse than the lowest dividend)
  const ranked = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score! || a.missingRequired.length - b.missingRequired.length || a.symbol.localeCompare(b.symbol));
  ranked.forEach((r, k) => (r.rank = k + 1));
  return rows;
}
