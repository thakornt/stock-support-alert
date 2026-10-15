import { NextResponse } from "next/server";
import { buildChart, DEFAULT_RANGE, isRange, rangeStart, type ChartTouch } from "@/lib/chart/series";
import { listPriceHistory } from "@/lib/db/priceHistory";
import { listTouches } from "@/lib/db/supports";
import { listSymbols } from "@/lib/db/symbols";
import { nyToday } from "@/lib/market/calendar";
import { SYMBOL_PATTERN } from "@/lib/symbol";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set(["held", "broken", "unclear", "open"]);

/**
 * GET /api/history/NVDA?range=6m -> the price chart for a card (public, read-only, database only).
 * Closes come from the daily recalculation; touches from the replay of the levels over the stock's history.
 */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  const asked = new URL(request.url).searchParams.get("range");
  const range = isRange(asked) ? asked : DEFAULT_RANGE;
  if (!SYMBOL_PATTERN.test(symbol)) return NextResponse.json({ error: "invalid symbol" }, { status: 400 });

  try {
    const today = nyToday();
    const from = rangeStart(range, today);
    const [tracked, closes, touches] = await withTimeout(
      Promise.all([listSymbols(), listPriceHistory(symbol, from), listTouches(symbol, from)]),
      PAGE_DATA_TIMEOUT_MS,
      "load price history",
    );
    if (!tracked.includes(symbol)) return NextResponse.json({ error: "not tracked" }, { status: 404 });
    const chart = buildChart(
      range,
      today,
      closes.map((c) => ({ d: c.day, c: c.close })),
      touches.filter((t) => OUTCOMES.has(t.outcome)) as ChartTouch[],
    );
    // the data changes once a day: let the browser reuse it for a few minutes
    return NextResponse.json(chart, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    console.error("/api/history failed", symbol, err);
    return NextResponse.json({ error: "could not load the price history" }, { status: 503 });
  }
}
