import type { StockNews } from "@/lib/news/types";
import { currentTarget, type ProfileData } from "@/lib/profile/describe";
import type { TrackedSymbol } from "@/lib/db/symbols";
import type { TrackSummary } from "@/lib/support/track";
import { METHOD_LABEL, type Method, type Tier } from "@/lib/support/types";
import { FACTORS, type FactorId } from "./factors";
import { GOALS, MAX_PICKS, type GoalId } from "./types";

const DAY_MS = 86_400_000;
const round = (n: number | null | undefined, digits = 1): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(digits));

export interface StockInput {
  symbol: string;
  price: number | null;
  fundamentals: {
    pe: number | null;
    forwardPe: number | null;
    revenueGrowthPct: number | null;
    netMarginPct: number | null;
    dividendYieldPct: number | null;
    beta: number | null;
  };
  risk: {
    high52w: number | null;
    /** price versus the 52-week high, percent (-12 = 12% below) */
    fromHigh52wPct: number | null;
    /** worst fall from a peak in the available history, percent (-66 = fell 66%) */
    maxDrawdownPct: number | null;
    daysToEarnings: number | null;
  };
  supportLevels: {
    tier: Tier;
    level: number;
    method: string;
    /** swing-low zones only */
    zoneLow: number | null;
    bounces: number | null;
    /** percent the price is above the level (negative = below it) */
    distanceAbovePct: number | null;
    /** how this stock's past touches of this tier went: held / total, versus a random level at the same distance */
    pastHeld: string | null;
    pastRandomHeldPct: number | null;
  }[];
  /** a support level that broke recently and the price is still under */
  recentBreak: { tier: Tier; level: number; date: string } | null;
  /** brokerage analysts' latest month of ratings and their average 12-month price target (opinions, often optimistic) */
  analysts: { buy: number; hold: number; sell: number; month: string; targetMean: number | null; targetVsPricePct: number | null } | null;
  /** the latest news brief's reading of this stock (AI summary of free news), or null when there is none recent */
  news: { direction: string; impact: string; summary: string; points: string[] } | null;
  /** Finnhub's industry, or null */
  industry: string | null;
  /**
   * Comparable figures computed by the system (see FACTORS in ./factors) with the stock's percentile among the stocks
   * being ranked: 0 = lowest value, 100 = highest. A factor that cannot be computed for this stock is absent.
   */
  factors: Partial<Record<FactorId, { value: number; percentile: number }>>;
}

/** The facts the AI may use, per stock, computed from our own data (numbers only: nothing free-text reaches the prompt). */
export function buildStockInput(
  s: TrackedSymbol,
  price: number | null,
  profile: ProfileData | undefined,
  track: TrackSummary,
  today: string,
  news: StockNews | null = null,
  factors: StockInput["factors"] = {},
): StockInput {
  const p = profile;
  const high = p?.high52w ?? null;
  const earningsDays = p?.nextEarnings ? Math.round((Date.parse(`${p.nextEarnings}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null;
  const brk = track.recentBreak;
  const stillBelow = brk !== null && price !== null && price < Math.min(brk.level, brk.zoneLow ?? brk.level);

  return {
    symbol: s.symbol,
    price: round(price, 2),
    fundamentals: {
      pe: round(p?.pe),
      forwardPe: round(p?.forwardPe),
      revenueGrowthPct: round(p?.revenueGrowth),
      netMarginPct: round(p?.netMargin),
      dividendYieldPct: round(p?.dividendYield, 2),
      beta: round(p?.beta, 2),
    },
    risk: {
      high52w: round(high, 2),
      fromHigh52wPct: price !== null && high ? round((price / high - 1) * 100) : null,
      maxDrawdownPct: p?.maxDrawdown === undefined || p.maxDrawdown === null ? null : round(p.maxDrawdown * 100, 0),
      daysToEarnings: earningsDays !== null && earningsDays >= 0 ? earningsDays : null,
    },
    supportLevels: s.levels.map((l) => {
      const r = track.records[l.tier];
      const total = r.held + r.broken + r.unclear;
      return {
        tier: l.tier,
        level: round(l.price, 2)!,
        method: METHOD_LABEL[l.method as Method] ?? l.method,
        zoneLow: l.zoneLow !== null && l.zoneLow < l.price ? round(l.zoneLow, 2) : null,
        bounces: l.touches,
        distanceAbovePct: price !== null ? round(((price - l.price) / l.price) * 100) : null,
        pastHeld: total > 0 ? `${r.held}/${total}` : null,
        pastRandomHeldPct: total > 0 ? round((r.expectedHeld / total) * 100, 0) : null,
      };
    }),
    recentBreak: brk !== null && stillBelow ? { tier: brk.tier, level: round(brk.level, 2)!, date: brk.resolvedOn ?? brk.touchedOn } : null,
    analysts: analystsOf(p, price, today),
    news: news
      ? { direction: news.direction, impact: news.impact, summary: news.summary, points: news.points.map((x) => `(${x.kind}) ${x.text}`) }
      : null,
    industry: p?.industry ?? null,
    factors,
  };
}

/** What the AI may and may not do; shared by the in-app run and the prompt the user copies to a chat. */
const RULES = `You are a careful research assistant for ONE individual investor who already follows a short list of US stocks. From that list, pick the stocks most worth a closer look for a purchase NOW, given the investor's goals.

Rules:
- Use ONLY the JSON data you are given. Never invent figures, news beyond the "news" field, earnings results, ratings, or events. If a figure you would need is null, say it is unknown; do not guess.
- Do not predict future prices and do not promise returns. This is not financial advice. Rank by how well each stock FITS THE GOALS on the given data, and say what could go wrong.
- Support levels are reference prices where the price turned up before. The investor's own backtest found that buying at them has NOT been shown to beat buying on other days, so never present a level as a buy signal or a floor. Use them only to comment on where the price sits relative to them. "pastHeld" is how often this stock's past touches of that TIER held (every past first/next/major support, whichever method produced it: not this exact line), "pastRandomHeldPct" is the same rate for a random level at the same distance: a level only means something if pastHeld is clearly above it. When you cite pastHeld, say it is the record of that tier. An empty "supportLevels" means the price is below every level the method finds (a new low), not that data is missing.
- Valuation: when "forwardPe" is clearly above "pe" (more than 15% higher), analysts expect earnings to FALL: say so as a risk and never call that stock cheap or attractively valued on P/E. When forwardPe is clearly below pe, earnings are expected to grow.
- "analysts" are brokerage analysts' ratings and average price target: opinions, not facts. They lean heavily to "buy" (sell ratings are rare) and targets are usually optimistic, so treat them as one weak input, mention them as opinions, and never as a predicted price.
- "news" is an earlier AI summary of free news sources about the stock (may be incomplete or late; points marked (opinion) are writers' views, (inference) are guesses). Use it only as context, call it "ข่าว", and never add news that is not there. null = no recent news was found, not that nothing happened.
- "factors" are figures the system computed for every stock in the same way, each with its "percentile" among the stocks in this list (0 = the lowest value, 100 = the highest). A percentile is not good or bad by itself: a low "pe" percentile means cheaper than the others, a low "vol1y" percentile means calmer. Use the percentiles to compare stocks fairly, and the values when you cite numbers. Factor definitions are given below the data.
- A factor or figure that is missing means the data does not exist for that stock (a company with losses has no P/E, a fund has no revenue). Judge each stock on the figures it HAS: never count a missing figure against it, and never prefer a company because it is large, famous or familiar to you. Smaller, less-known stocks deserve the same scrutiny and the same chance as household names.
- Give a verdict for EVERY stock in the data: "fit" is high, medium or low against the goals, or unknown only when the figures the goals need are missing; "note" is one Thai sentence citing a number. Then choose the picks only from stocks with fit high or medium, best first.
- Be willing to pick fewer than ${MAX_PICKS} if fewer stocks really fit. Never pick a stock that is not in the data.
- Write in Thai. Keep each reason/risk to one short sentence that cites a number from the data.`;

/** The in-app run parses the reply, so it must be JSON. */
function analystsOf(p: ProfileData | undefined, price: number | null, today: string): StockInput["analysts"] {
  if (!p) return null;
  const buy = (p.recStrongBuy ?? 0) + (p.recBuy ?? 0);
  const hold = p.recHold ?? 0;
  const sell = (p.recSell ?? 0) + (p.recStrongSell ?? 0);
  const target = currentTarget(p, today);
  if (!p.recPeriod && target === null) return null;
  return {
    buy,
    hold,
    sell,
    month: p.recPeriod ? p.recPeriod.slice(0, 7) : "",
    targetMean: round(target, 2),
    targetVsPricePct: target !== null && price !== null && price > 0 ? round((target / price - 1) * 100) : null,
  };
}

export const SYSTEM_PROMPT = `${RULES}

Reply with ONE JSON object and nothing else (no markdown fences), exactly in this shape:
{
  "summary": "2-3 Thai sentences: what the ranking favours and the main caution",
  "verdicts": [
    { "symbol": "TICKER", "fit": "high", "note": "one Thai sentence citing a number" }
  ],
  "picks": [
    { "symbol": "TICKER", "rank": 1, "reasons": ["..."], "risks": ["..."], "entryNote": "one Thai sentence on the price versus the support levels" }
  ],
  "caveats": ["Thai sentences about data gaps or limits that affect this ranking"]
}
"verdicts" has one entry for every stock in the data. "picks" is ordered best first, at most ${MAX_PICKS}, each with 2-4 reasons and 1-3 risks.`;

/** The same rules for a person to paste into any AI chat (no API, no quota): asks for a readable Thai answer instead of JSON. */
export const MANUAL_PROMPT_RULES = `${RULES}

Answer in readable Thai: a 2-3 sentence summary, then a short verdict for EVERY stock (fit high / medium / low / unknown and one sentence citing a number), then the picks best first (at most ${MAX_PICKS}), each with 2-4 reasons, 1-3 risks and one sentence on the price versus its support levels, then the data gaps or limits that affect the ranking.`;

/** Stocks are identified by codes; nothing in the data names the company. */
const ANONYMOUS_NOTE =
  "The stocks are identified by codes (S01, S02, ...) on purpose: judge them only on the data and do not try to guess which companies they are. Dollar prices are hidden (level / price fields are 0 or null): use the percentage distances.";

export function buildUserPrompt(goals: GoalId[], stocks: StockInput[], today: string, { anonymous = false }: { anonymous?: boolean } = {}): string {
  const goalText =
    goals.length === 0
      ? "- No specific goal chosen: judge the overall balance of growth, valuation and risk."
      : GOALS.filter((g) => goals.includes(g.id)).map((g) => `- ${g.prompt}`).join("\n");
  return `Today (New York date): ${today}. Prices are the latest available.

Investor goals (all together; a stock that fits several ranks higher):
${goalText}

${anonymous ? `${ANONYMOUS_NOTE}\n\n` : ""}Stocks (JSON):
${JSON.stringify(stocks)}

Factor definitions:
${FACTORS.map((f) => `- ${f.id}${f.unit && f.unit !== "n" ? ` (${f.unit})` : ""}: ${f.definition}`).join("\n")}`;
}

const oneSignificant = (n: number) => {
  if (n <= 0) return n;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.round(n / mag) * mag;
};

/**
 * The same stocks with the tickers replaced by codes (S01...) and without what names the company or gives it away:
 * news summaries (they quote names), dollar prices (a $221 chip maker is easy to guess: distances in % stay), and an
 * exact market cap (rounded to one significant figure). Not a guarantee (industry and size still narrow it down), but
 * it removes the brand from the judgement. Returns the inputs and the code -> ticker map to translate the answer back.
 */
export function anonymize(stocks: StockInput[]): { stocks: StockInput[]; codes: Map<string, string> } {
  const codes = new Map<string, string>();
  const out = stocks.map((s, i): StockInput => {
    const code = `S${String(i + 1).padStart(2, "0")}`;
    codes.set(code, s.symbol);
    const cap = s.factors.marketCapB;
    return {
      ...s,
      symbol: code,
      price: null,
      news: null,
      risk: { ...s.risk, high52w: null },
      supportLevels: s.supportLevels.map((l) => ({ ...l, level: 0, zoneLow: null })),
      recentBreak: s.recentBreak ? { ...s.recentBreak, level: 0 } : null,
      analysts: s.analysts ? { ...s.analysts, targetMean: null } : null,
      factors: cap ? { ...s.factors, marketCapB: { ...cap, value: oneSignificant(cap.value) } } : s.factors,
    };
  });
  return { stocks: out, codes };
}
