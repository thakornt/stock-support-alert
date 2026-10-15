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
