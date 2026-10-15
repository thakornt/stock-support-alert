import { describe, expect, it } from "vitest";
import { currentTarget, describeProfile, type ProfileData } from "./describe";
import { parseNasdaqTarget } from "./nasdaq";

describe("parseNasdaqTarget", () => {
  it("reads the consensus average, high and low", () => {
    const json = { data: { symbol: "msft", consensusOverview: { lowPriceTarget: 440, highPriceTarget: 725, priceTarget: 591.14, buy: 34, sell: 0, hold: 1 } } };
    expect(parseNasdaqTarget(json)).toEqual({ targetMean: 591.14, targetHigh: 725, targetLow: 440 });
  });

  it("has no target for a symbol without one (an ETF answers with an empty consensus)", () => {
    expect(parseNasdaqTarget({ data: { consensusOverview: { priceTarget: null } }, status: { bCodeMessage: [{ code: 1002 }] } })).toBeNull();
    expect(parseNasdaqTarget({ data: null })).toBeNull();
    expect(parseNasdaqTarget(null)).toBeNull();
    expect(parseNasdaqTarget({ data: { consensusOverview: { priceTarget: 0 } } })).toBeNull();
  });
});

const profile = (over: Partial<ProfileData>): ProfileData =>
  ({ symbol: "MSFT", historyAt: null, fundamentalsAt: null, lastClose: 533.69, ...over }) as ProfileData;

describe("currentTarget", () => {
  it("shows a target until it is more than 14 days old", () => {
    const p = profile({ targetMean: 591.14, targetUpdated: "2026-10-01" });
    expect(currentTarget(p, "2026-10-15")).toBe(591.14);
    expect(currentTarget(p, "2026-10-16")).toBeNull();
    expect(currentTarget(profile({ targetMean: null }), "2026-10-15")).toBeNull();
  });

  it("names the source of the target in the footnote, and leaves out an old one", () => {
    const fresh = describeProfile(profile({ targetMean: 591.14, targetHigh: 725, targetLow: 440, targetUpdated: "2026-10-15", targetSource: "nasdaq" }), 533.69, "2026-10-15");
    expect(fresh.lines.find((l) => l.key === "target")?.value).toBe("$591.14 (+11%)");
    expect(fresh.footnote).toContain("ราคาเป้าหมายจาก Nasdaq");
    const old = describeProfile(profile({ targetMean: 591.14, targetUpdated: "2026-09-01", targetSource: "nasdaq" }), 533.69, "2026-10-15");
    expect(old.lines.find((l) => l.key === "target")).toBeUndefined();
  });
});
