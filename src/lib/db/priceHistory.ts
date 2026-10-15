import type { Candle } from "@/lib/support/types";
import { sql, transaction } from "./client";

/** Re-written every run even when already stored: the last days can still be corrected by the data provider. */
const REWRITE_DAYS = 10;

/**
 * Keep `symbol`'s stored closes equal to `candles` (completed sessions, oldest first): new and recent days are
 * upserted, days older than the oldest candle are dropped. A normal daily run writes about REWRITE_DAYS rows; the
 * first run writes the whole history.
 */
export async function savePriceHistory(symbol: string, candles: Pick<Candle, "date" | "close">[]) {
  if (candles.length === 0) return;
  await transaction(async (tx) => {
    const [{ last }] = await tx<{ last: string | null }[]>`select max(day)::text as last from price_history where symbol = ${symbol}`;
    const from = last ? candles.length - Math.min(candles.length, REWRITE_DAYS + candles.filter((c) => c.date > last).length) : 0;
    const rows = candles.slice(from).map((c) => ({ symbol, day: c.date, close: c.close }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx`
        insert into price_history ${tx(rows.slice(i, i + 500))}
        on conflict (symbol, day) do update set close = excluded.close`;
    }
    await tx`delete from price_history where symbol = ${symbol} and day < ${candles[0].date}`;
  });
}

export interface Close {
  /** YYYY-MM-DD */
  day: string;
  close: number;
}

/** Closes from `from` (YYYY-MM-DD) on, oldest first. */
export async function listPriceHistory(symbol: string, from: string): Promise<Close[]> {
  return sql()<Close[]>`
    select day::text as day, close::float8 as close from price_history
    where symbol = ${symbol} and day >= ${from} order by day`;
}

/** Every tracked symbol's closes from `from` (YYYY-MM-DD) on, oldest first: one query for the whole list. */
export async function closesBySymbol(from: string): Promise<Map<string, number[]>> {
  const rows = await sql()<{ symbol: string; close: number }[]>`
    select symbol, close::float8 as close from price_history where day >= ${from} order by symbol, day`;
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const list = out.get(r.symbol);
    if (list) list.push(r.close);
    else out.set(r.symbol, [r.close]);
  }
  return out;
}
