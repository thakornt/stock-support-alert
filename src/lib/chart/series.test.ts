import { describe, expect, it } from "vitest";
import { buildChart, isRange, MAX_TOUCHES, priceDomain, rangeStart, weeklyCloses, type ChartPoint, type ChartTouch } from "./series";

/** Weekdays from `from` for `n` days, closes 100, 101, ... */
function days(from: string, n: number): ChartPoint[] {
  const out: ChartPoint[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ d: d.toISOString().slice(0, 10), c: 100 + out.length });
    t += 86_400_000;
  }
  return out;
}

describe("ranges", () => {
  it("knows its four ranges and where each starts", () => {
    expect(["3m", "6m", "1y", "5y"].every(isRange)).toBe(true);
    expect(isRange("1m")).toBe(false);
    expect(rangeStart("3m", "2026-10-15")).toBe("2026-07-15");
    expect(rangeStart("1y", "2026-10-15")).toBe("2025-10-14");
  });
});

describe("weeklyCloses", () => {
  it("keeps the last close of each Monday-Sunday week", () => {
    const pts = days("2026-09-28", 10); // Mon 28 Sep .. Fri 9 Oct
    expect(weeklyCloses(pts)).toEqual([
      { d: "2026-10-02", c: 104 },
      { d: "2026-10-09", c: 109 },
    ]);
  });
});

describe("buildChart", () => {
  const closes = days("2021-10-01", 1300);
  const today = closes[closes.length - 1].d;

  it("cuts the closes to the range; 5 years is weekly", () => {
    const six = buildChart("6m", today, closes, []);
    expect(six.weekly).toBe(false);
    expect(six.points[0].d >= rangeStart("6m", today)).toBe(true);
    expect(six.points.length).toBeGreaterThan(120);
    expect(six.points.length).toBeLessThan(135);
    const five = buildChart("5y", today, closes, []);
    expect(five.weekly).toBe(true);
    expect(five.points.length).toBeGreaterThan(250);
    expect(five.points.length).toBeLessThan(270);
  });

  it("shows the rarer tiers only on the long ranges", () => {
    const tiers = ["minor", "intermediate", "major"] as const;
    const touches: ChartTouch[] = closes.slice(-40).map((p, i) => ({ d: p.d, level: p.c, tier: tiers[i % 3], outcome: "held" }));
    const seen = (range: "6m" | "1y" | "5y") => [...new Set(buildChart(range, today, closes, touches).touches.map((t) => t.tier))].sort();
    expect(seen("6m")).toEqual(["intermediate", "major", "minor"]);
    expect(seen("1y")).toEqual(["intermediate", "major"]);
    expect(seen("5y")).toEqual(["major"]);
  });

  it("keeps the touches inside the range, newest MAX_TOUCHES", () => {
    const touches: ChartTouch[] = closes.map((p) => ({ d: p.d, level: p.c - 5, tier: "minor", outcome: "held" }));
    const three = buildChart("3m", today, closes, touches);
    expect(three.touches.every((t) => t.d >= rangeStart("3m", today))).toBe(true);
    expect(three.touches).toHaveLength(MAX_TOUCHES);
    expect(three.touches[three.touches.length - 1].d).toBe(today);
  });
});

describe("priceDomain", () => {
  const pts = [{ d: "2026-01-01", c: 100 }, { d: "2026-01-02", c: 120 }];
  it("covers the closes and the support levels, with a margin", () => {
    const [lo, hi] = priceDomain(pts, [90, 95]);
    expect(lo).toBeLessThan(90);
    expect(hi).toBeGreaterThan(120);
  });
  it("leaves out a level far below the prices instead of squashing the line", () => {
    const [lo] = priceDomain(pts, [40]);
    expect(lo).toBeGreaterThan(90);
  });
});
