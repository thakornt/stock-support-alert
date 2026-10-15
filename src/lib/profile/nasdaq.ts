/**
 * Analysts' 12-month price targets from Nasdaq's website API (api.nasdaq.com, unofficial: free, no key, may change or
 * refuse at any time). Used because Finnhub's free plan refuses price targets. Best effort: any problem = no target.
 */

export interface PriceTarget {
  targetMean: number;
  targetHigh: number | null;
  targetLow: number | null;
}

/** Nasdaq answers 200 with `status.bCodeMessage` for an unknown symbol (e.g. an ETF): that is "none", not a failure. */
export class NasdaqError extends Error {}

const TIMEOUT_MS = 8000;
const HEADERS = {
  // the API refuses requests that do not look like they come from its own web pages
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36",
  Accept: "application/json",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** The consensus from a /api/analyst/<SYMBOL>/targetprice reply; null when it has no target. */
export function parseNasdaqTarget(json: unknown): PriceTarget | null {
  const data = (json as { data?: { consensusOverview?: Record<string, unknown> } | null } | null)?.data;
  const c = data?.consensusOverview;
  const mean = num(c?.priceTarget);
  if (!c || mean === null) return null;
  return { targetMean: mean, targetHigh: num(c.highPriceTarget), targetLow: num(c.lowPriceTarget) };
}

/** null = Nasdaq has no target for this symbol; throws NasdaqError when the request itself failed. */
export async function fetchNasdaqTarget(symbol: string, deadline?: AbortSignal): Promise<PriceTarget | null> {
  const signal = deadline ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline]) : AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/targetprice`, { headers: HEADERS, cache: "no-store", signal });
  } catch (err) {
    throw new NasdaqError(err instanceof Error ? err.message : "request failed");
  }
  if (!res.ok) throw new NasdaqError(`HTTP ${res.status}`);
  const json = await res.json().catch(() => {
    throw new NasdaqError("not JSON");
  });
  return parseNasdaqTarget(json);
}

/** "2,230,819,489,308" -> 2230819489308; anything else -> null. */
export function parseNasdaqMarketCap(json: unknown): number | null {
  const raw = (json as { data?: { summaryData?: { MarketCap?: { value?: unknown } } } | null } | null)?.data?.summaryData?.MarketCap?.value;
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The USD market cap from Nasdaq's quote summary (handles ADRs). null = none; throws NasdaqError on a failed request. */
export async function fetchNasdaqMarketCap(symbol: string, deadline?: AbortSignal): Promise<number | null> {
  const signal = deadline ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline]) : AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`, { headers: HEADERS, cache: "no-store", signal });
  } catch (err) {
    throw new NasdaqError(err instanceof Error ? err.message : "request failed");
  }
  if (!res.ok) throw new NasdaqError(`HTTP ${res.status}`);
  const json = await res.json().catch(() => {
    throw new NasdaqError("not JSON");
  });
  return parseNasdaqMarketCap(json);
}

/**
 * The USD market cap to use: Nasdaq's when it has one; otherwise shares x price, but only for a company Finnhub reports
 * in USD (for an ADR or a foreign filer, shares x the US price is wrong: TSM would come out 5x too big). Else unknown.
 */
export function marketCapUsd(nasdaq: number | null, facts: { sharesOutstanding: number | null; currency: string | null }, priceUsd: number | null): number | null {
  if (nasdaq !== null) return nasdaq;
  if (facts.currency === "USD" && facts.sharesOutstanding !== null && priceUsd !== null && priceUsd > 0) return facts.sharesOutstanding * 1e6 * priceUsd;
  return null;
}
