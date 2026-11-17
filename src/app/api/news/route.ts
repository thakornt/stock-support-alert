import { after, NextResponse } from "next/server";
import { briefsOnDay } from "@/lib/db/news";
import { nyToday } from "@/lib/market/calendar";
import { NewsError, requestNewsBrief, runNewsBrief, type NewsErrorCode } from "@/lib/jobs/news";

export const dynamic = "force-dynamic";
/** The brief itself runs after the answer (after()), still inside this function's 300 s. */
export const maxDuration = 300;

const STATUS: Record<NewsErrorCode, number> = {
  not_configured: 503,
  no_symbols: 409,
  no_news: 404,
  limit: 429,
  busy: 409,
  timeout: 504,
  ai: 502,
  parse: 502,
};

const usedToday = () => briefsOnDay(nyToday()).catch(() => null);

/**
 * POST -> 202 { accepted, id, used }: "summarise the news now", fire and forget. The checks that can be made at once
 * (settings, a brief already running, the daily limit) answer here; collecting the news and the AI call (1-5 minutes)
 * run in the background, so a phone that locks its screen or a switched tab loses nothing. The page follows the run
 * with GET /api/news/status. Behind the login (proxy.ts).
 */
export async function POST() {
  let id: number;
  try {
    id = await requestNewsBrief();
  } catch (err) {
    if (err instanceof NewsError) return NextResponse.json({ error: err.message, used: await usedToday() }, { status: STATUS[err.code] });
    console.error("/api/news failed", err);
    return NextResponse.json({ error: "ส่งคำขอสรุปข่าวไม่สำเร็จ ลองใหม่อีกครั้ง", used: await usedToday() }, { status: 500 });
  }
  after(async () => {
    try {
      const brief = await runNewsBrief({ trigger: "manual", reservedId: id });
      console.log("news brief (manual)", JSON.stringify({ id: brief?.id, stocks: brief?.stocks.length, articles: brief?.refs.length }));
    } catch (err) {
      // already recorded on the brief row (status failed + reason) for the page to show
      console.error("news brief (manual) failed", err instanceof Error ? err.message : err);
    }
  });
  return NextResponse.json({ accepted: true, id, used: await usedToday() }, { status: 202 });
}
