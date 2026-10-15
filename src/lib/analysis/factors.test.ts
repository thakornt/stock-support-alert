import { describe, expect, it } from "vitest";
import { computeFactors, formulaRanking, percentiles, type FactorSource, type FactorValues } from "./factors";

const base = (over: Partial<FactorSource> = {}): FactorSource => ({
  symbol: "X",
  price: null,
  closes: [],
  high52w: null,
  maxDrawdown: null,
  pe: null,
  forwardPe: null,
  revenueGrowth: null,
  netMargin: null,
  dividendYield: null,
  beta: null,
  marketCap: null,
  targetMean: null,
  ratings: null,
  firstSupport: null,
  firstTierRecord: null,
  news: null,
  ...over,
});

describe("computeFactors", () => {
  // 300 closes rising by 1 a day: 100, 101, ..., 399
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i);

  it("returns over fixed trading-day windows, measured from the current price", () => {
    const f = computeFactors(base({ price: 400, closes }));
    // 21 sessions back from the last close (399) is 378
    expect(f.ret1m).toBeCloseTo((400 / 378 - 1) * 100, 10);
    expect(f.ret3m).toBeCloseTo((400 / 336 - 1) * 100, 10);
    expect(f.ret6m).toBeCloseTo((400 / 273 - 1) * 100, 10);
    expect(f.ret12m).toBeCloseTo((400 / 147 - 1) * 100, 10);
    // lowest close of the last 252 is 148
    expect(f.rebound52wLow).toBeCloseTo((400 / 148 - 1) * 100, 10);
  });

  it("leaves out what it cannot compute instead of guessing", () => {
    const f = computeFactors(base({ price: 10, closes: closes.slice(0, 30) }));
    expect(f.ret1m).toBeDefined();
    expect(f.ret3m).toBeUndefined(); // not 63 sessions of history
    expect(f.vol1y).toBeUndefined(); // too short
    expect(f.pe).toBeUndefined();
    expect(computeFactors(base({ pe: -5, forwardPe: 20 })).epsGrowthImplied).toBeUndefined(); // losses: no P/E
  });

  it("realised volatility: annualised standard deviation of daily log returns", () => {
    // alternating +1% / -1%: daily log returns ±0.00995..., std ≈ 0.01, annualised ≈ 15.9%
    const zig = [100];
    for (let i = 1; i < 253; i++) zig.push(i % 2 ? zig[i - 1] * 1.01 : zig[i - 1] / 1.01);
    const v = computeFactors(base({ closes: zig })).vol1y!;
    const r = Math.log(1.01);
    const n = 252;
    const std = Math.sqrt((n * r * r) / (n - 1)); // mean is 0 for an even number of alternating steps
    expect(v).toBeCloseTo(std * Math.sqrt(252) * 100, 6);
  });

  it("valuation, analysts, size, support and news", () => {
    const f = computeFactors(
      base({
        price: 50,
        closes,
        high52w: 80,
        maxDrawdown: -0.6,
        pe: 30,
        forwardPe: 20,
        revenueGrowth: 12,
        netMargin: -5,
        dividendYield: 0,
        beta: 1.4,
        marketCap: 2.5e9,
        targetMean: 75,
        ratings: { buy: 6, hold: 3, sell: 1 },
        firstSupport: 48,
        firstTierRecord: { held: 12, total: 20, expectedHeld: 10 },
        news: { direction: "negative", impact: "high" },
      }),
    );
    expect(f.fromHigh52w).toBeCloseTo(-37.5, 10);
    expect(f.maxDrawdown).toBe(-60);
    expect(f.epsGrowthImplied).toBeCloseTo(50, 10); // 30 / 20 - 1: earnings expected to rise 50%
    expect(f.dividendYield).toBeUndefined(); // pays none: no figure, not "0 is low"
    expect(f.marketCapB).toBe(2.5);
    expect(f.targetUpside).toBeCloseTo(50, 10);
    expect(f.buyShare).toBe(60);
    expect(f.analystCount).toBe(10);
    expect(f.supportDistance).toBeCloseTo((50 / 48 - 1) * 100, 10);
    expect(f.supportEdge).toBeCloseTo(10, 10); // (12 - 10) / 20 = 10 percentage points
    expect(f.newsScore).toBe(-2);
  });

  it("needs 8 past touches before the support record means anything", () => {
    expect(computeFactors(base({ firstTierRecord: { held: 4, total: 7, expectedHeld: 3 } })).supportEdge).toBeUndefined();
  });
});

describe("percentiles", () => {
  it("0 = lowest, 100 = highest, ties share the average, missing stays missing", () => {
    expect(percentiles([10, undefined, 30, 20, 20])).toEqual([0, undefined, 100, 50, 50]);
    expect(percentiles([5])).toEqual([50]);
    expect(percentiles([undefined])).toEqual([undefined]);
  });
});

describe("formulaRanking", () => {
  const syms = ["A", "B", "C"];

  it("ranks by direction-adjusted percentiles: a lower P/E fits 'value' better", () => {
    const v: FactorValues[] = [
      { pe: 10, forwardPe: 9, epsGrowthImplied: 11, netMargin: 20 },
      { pe: 40, forwardPe: 30, epsGrowthImplied: 33, netMargin: 10 },
      { pe: 20, forwardPe: 18, epsGrowthImplied: 11, netMargin: 15 },
    ];
    const rows = formulaRanking(syms, v, ["value"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 3, 2]);
    expect(rows[0].score).toBeGreaterThan(rows[2].score!);
  });

  it("skips missing factors instead of penalising them, and gives up below half coverage", () => {
    const v: FactorValues[] = [
      { ret3m: 10, ret6m: 20, ret12m: 30, fromHigh52w: -5 },
      { ret6m: 50 }, // only 2 of 5 weight units: not enough for momentum
      { ret3m: 30, ret6m: 40, ret12m: 50, fromHigh52w: -1 },
    ];
    const rows = formulaRanking(syms, v, ["momentum"]);
    expect(rows[1]).toMatchObject({ score: null, rank: null });
    expect(rows[1].coverage).toBeCloseTo(2 / 5, 10);
    expect(rows[2].rank).toBe(1);
  });

  it("a stock without the goal's required figure does not fit it (score 0), and says why", () => {
    const v: FactorValues[] = [{ dividendYield: 3, netMargin: 10, vol1y: 20 }, { netMargin: 50, vol1y: 10 }, { dividendYield: 1, netMargin: 5, vol1y: 40 }];
    const rows = formulaRanking(syms, v, ["dividend"]);
    expect(rows[1]).toMatchObject({ score: 0, missingRequired: ["dividend"], rank: 3 });
    expect(rows[0].rank).toBe(1);
  });

  it("small companies rank first for 'smallcap'; no goal means the balanced mix", () => {
    const v: FactorValues[] = [{ marketCapB: 3000, analystCount: 60 }, { marketCapB: 0.35, analystCount: 12 }, { marketCapB: 35, analystCount: 9 }];
    expect(formulaRanking(syms, v, ["smallcap"]).map((r) => r.rank)).toEqual([3, 1, 2]);
    expect(formulaRanking(syms, [{ pe: 10 }, { pe: 20 }, { pe: 30 }], []).every((r) => r.score === null)).toBe(true); // balanced needs more than P/E
  });
});
