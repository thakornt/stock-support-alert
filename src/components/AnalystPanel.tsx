import { currentTarget, type ProfileData } from "@/lib/profile/describe";
import type { Tier } from "@/lib/support/types";

const usd = (n: number) => (n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
const pct = (from: number, to: number) => {
  const v = (to / from - 1) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
};
const TIER_BG: Record<Tier, string> = { minor: "bg-warning", intermediate: "bg-caution", major: "bg-danger" };

/**
 * What brokerage analysts say, as two bars: how many say buy / hold / sell, and the range of their 12-month price
 * targets next to today's price and the support levels (how far down the levels are, how far up the targets).
 * Opinions, shown as such: no "strong buy" badge.
 */
export function AnalystPanel({
  profile: p,
  price,
  levels,
  today,
}: {
  profile: ProfileData | null;
  price: number | null;
  levels: { tier: Tier; price: number }[];
  today: string;
}) {
  if (!p) return null;
  const buy = (p.recStrongBuy ?? 0) + (p.recBuy ?? 0);
  const hold = p.recHold ?? 0;
  const sell = (p.recSell ?? 0) + (p.recStrongSell ?? 0);
  const total = buy + hold + sell;
  const mean = currentTarget(p, today);
  const now = price ?? p.lastClose ?? null;
  if (total === 0 && mean === null) return null;

  const low = mean !== null ? (p.targetLow ?? mean) : null;
  const high = mean !== null ? (p.targetHigh ?? mean) : null;
  let range: { lo: number; hi: number } | null = null;
  if (mean !== null && low !== null && high !== null && now !== null) {
    const values = [low, high, now, ...levels.map((l) => l.price)];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.04;
    range = { lo: lo - pad, hi: hi + pad };
  }
  const at = (v: number) => (range ? `${((v - range.lo) / (range.hi - range.lo)) * 100}%` : "0%");

  return (
    <section aria-label="มุมมองนักวิเคราะห์" className="tile space-y-4 px-3.5 py-3.5">
      <h3 className="text-sm font-medium">มุมมองนักวิเคราะห์</h3>

      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-elevated" role="img" aria-label={`ซื้อ ${buy} ถือ ${hold} ขาย ${sell}`}>
            <span className="bg-success" style={{ width: `${(buy / total) * 100}%` }} />
            <span className="bg-muted/50" style={{ width: `${(hold / total) * 100}%` }} />
            <span className="bg-danger" style={{ width: `${(sell / total) * 100}%` }} />
          </div>
          <p className="flex flex-wrap gap-x-3 text-xs">
            <span className="text-success">ซื้อ {buy}</span>
            <span className="text-muted">ถือ {hold}</span>
            <span className="text-danger">ขาย {sell}</span>
            <span className="text-muted">
              · จาก {total} คน{p.recPeriod ? ` (${p.recPeriod.slice(5, 7)}/${p.recPeriod.slice(0, 4)})` : ""}
            </span>
          </p>
        </div>
      )}

      {range && mean !== null && low !== null && high !== null && now !== null && (
        <div className="space-y-2">
          <p className="text-xs text-muted">ราคาเป้าหมาย 12 เดือน เทียบราคาตอนนี้และแนวรับ</p>
          <div
            className="relative h-6"
            role="img"
            aria-label={`ราคาเป้าหมายต่ำสุด ${usd(low)} เฉลี่ย ${usd(mean)} สูงสุด ${usd(high)} ราคาตอนนี้ ${usd(now)}`}
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-elevated" />
            {/* the analysts' range */}
            <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/30" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
            {/* support levels */}
            {levels.map((l) => (
              <span key={l.tier} className={`absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${TIER_BG[l.tier]}`} style={{ left: at(l.price) }} />
            ))}
            {/* average target */}
            <span className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: at(mean) }} />
            {/* today */}
            <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_3px_var(--raised)]" style={{ left: at(now) }} />
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted">ต่ำสุด</dt>
              <dd className="font-mono tabular-nums">
                {usd(low)} <span className="text-muted">{pct(now, low)}</span>
              </dd>
            </div>
            <div className="text-center">
              <dt className="text-primary">เฉลี่ย</dt>
              <dd className="font-mono tabular-nums">
                {usd(mean)} <span className="text-muted">{pct(now, mean)}</span>
              </dd>
            </div>
            <div className="text-right">
              <dt className="text-muted">สูงสุด</dt>
              <dd className="font-mono tabular-nums">
                {usd(high)} <span className="text-muted">{pct(now, high)}</span>
              </dd>
            </div>
          </dl>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-foreground" aria-hidden="true" /> ราคาตอนนี้ {usd(now)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-0.5 rounded-full bg-primary" aria-hidden="true" /> เป้าเฉลี่ย
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-0.5 rounded-full bg-danger" aria-hidden="true" /> ขีดสี = แนวรับ
            </span>
          </p>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        ความเห็นของนักวิเคราะห์โบรกเกอร์ ซึ่งส่วนใหญ่มักแนะนำซื้อและตั้งราคาเป้าหมายสูงเกินจริง — ใช้ดูว่าตลาดคาดหวังอะไร ไม่ใช่ราคาที่จะไปถึง
      </p>
    </section>
  );
}
