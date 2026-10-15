import { beforeEach, describe, expect, it, vi } from "vitest";

const lastRunDay = vi.fn();
const briefStartedWithin = vi.fn();
vi.mock("@/lib/db/jobRuns", () => ({ lastRunDay, markRun: vi.fn() }));
vi.mock("@/lib/db/news", async (orig) => ({ ...(await orig<typeof import("@/lib/db/news")>()), briefStartedWithin }));

const { briefCatchUpDue } = await import("./news");

/** New York wall-clock time on a date in October 2026 (EDT, UTC-4). */
const ny = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`);

beforeEach(() => {
  vi.clearAllMocks();
  lastRunDay.mockResolvedValue("2026-10-14");
  briefStartedWithin.mockResolvedValue(false);
});

describe("briefCatchUpDue (the hourly run makes a missing brief)", () => {
  it("is due on a trading day between 08:30 and 16:00 New York while today's brief is missing", async () => {
    expect(await briefCatchUpDue(ny("2026-10-15", "09:15"))).toBe(true);
    expect(await briefCatchUpDue(ny("2026-10-15", "15:15"))).toBe(true);
  });

  it("is not due outside that window, on a weekend, or once today's brief exists", async () => {
    expect(await briefCatchUpDue(ny("2026-10-15", "07:15"))).toBe(false);
    expect(await briefCatchUpDue(ny("2026-10-15", "16:15"))).toBe(false);
    expect(await briefCatchUpDue(ny("2026-10-17", "10:15"))).toBe(false); // Saturday
    lastRunDay.mockResolvedValue("2026-10-15");
    expect(await briefCatchUpDue(ny("2026-10-15", "10:15"))).toBe(false);
  });

  it("waits while another brief has just started (the 08:30 run may still be working)", async () => {
    briefStartedWithin.mockResolvedValue(true);
    expect(await briefCatchUpDue(ny("2026-10-15", "08:35"))).toBe(false);
    expect(briefStartedWithin).toHaveBeenCalledWith(10);
  });
});
