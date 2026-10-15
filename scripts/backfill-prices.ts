/**
 * Fill the price chart history (price_history) for every tracked symbol now, instead of waiting for the daily
 * recalculation. Only fetches and stores closes: no levels are recomputed and nothing is sent to LINE.
 * Costs 1 Twelve Data credit per symbol and pauses 61 s between batches of API_CREDITS_PER_MINUTE (free plan).
 *
 *   set -a; source .env.local; set +a; npm run backfill:prices
 */
import { config } from "@/lib/config";
import { sql } from "@/lib/db/client";
import { savePriceHistory } from "@/lib/db/priceHistory";
import { listSymbols } from "@/lib/db/symbols";
import { BATCH_PAUSE_MS, pause } from "@/lib/jobs/quotes";
import { lastCompletedSession } from "@/lib/market/calendar";
import { stockProvider } from "@/lib/stock";

async function main() {
  const symbols = await listSymbols();
  const session = lastCompletedSession(new Date());
  const size = config.apiCreditsPerMinute();
  for (let i = 0; i < symbols.length; i += size) {
    if (i > 0) await pause(BATCH_PAUSE_MS);
    const batch = symbols.slice(i, i + size);
    const { data, errors } = await stockProvider.getDailyCandles(batch, 1300);
    for (const [symbol, candles] of Object.entries(data)) {
      const completed = candles.filter((c) => c.date <= session);
      await savePriceHistory(symbol, completed);
      console.log(symbol, completed.length, "closes", completed[0]?.date, "→", completed[completed.length - 1]?.date);
    }
    for (const [symbol, error] of Object.entries(errors)) console.error(symbol, "failed:", error);
  }
  await sql().end();
}

main().catch(async (err) => {
  console.error(err);
  await sql().end().catch(() => {});
  process.exit(1);
});
