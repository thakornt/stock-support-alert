import { NextResponse } from "next/server";
import { briefsOnDay, briefStatus } from "@/lib/db/news";
import { nyToday } from "@/lib/market/calendar";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * GET -> { running, latest, lastFailure, used }: what the news page polls after "สรุปข่าวตอนนี้". Owner only: a failure
 * reason is about the setup (provider, quota), not something for visitors of the public site.
 */
export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const [status, used] = await Promise.all([briefStatus(), briefsOnDay(nyToday())]);
    return NextResponse.json({ ...status, used }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("/api/news/status failed", err);
    return NextResponse.json({ error: "อ่านสถานะไม่ได้" }, { status: 503 });
  }
}
