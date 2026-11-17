import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  briefStatus: vi.fn(async () => ({ running: null, latest: null, lastFailure: null }) as { running: { id: number; startedAt: string } | null; latest: null; lastFailure: null }),
  startBrief: vi.fn<() => Promise<number | null>>(async () => 5),
  failBrief: vi.fn(async () => {}),
  listCompanyNames: vi.fn(async () => [{ symbol: "NVDA", name: "NVIDIA Corp", checkedAt: null }]),
  articlesBetween: vi.fn(async () => []),
};
vi.mock("@/lib/db/news", async (orig) => ({ ...(await orig<typeof import("@/lib/db/news")>()), ...db }));
vi.mock("@/lib/db/jobRuns", () => ({ lastRunDay: vi.fn(async () => null), markRun: vi.fn() }));

const { requestNewsBrief, runNewsBrief } = await import("./news");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_API_KEY", "k");
  vi.stubEnv("AI_MODEL", "m");
  vi.stubEnv("FINNHUB_API_KEY", ""); // collecting is skipped: no network in tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requestNewsBrief (the button's quick checks)", () => {
  it("reserves a manual brief", async () => {
    expect(await requestNewsBrief(new Date("2026-11-17T15:00:00Z"))).toBe(5);
    expect(db.startBrief).toHaveBeenCalledWith("2026-11-17", "manual", "m", 3);
  });

  it("refuses while one is already running, or when the day's limit is used", async () => {
    db.briefStatus.mockResolvedValueOnce({ running: { id: 4, startedAt: "x" }, latest: null, lastFailure: null });
    await expect(requestNewsBrief()).rejects.toMatchObject({ code: "busy" });
    db.startBrief.mockResolvedValueOnce(null);
    await expect(requestNewsBrief()).rejects.toMatchObject({ code: "limit" });
  });

  it("refuses without AI settings, before reserving anything", async () => {
    vi.stubEnv("AI_API_KEY", "");
    await expect(requestNewsBrief()).rejects.toMatchObject({ code: "not_configured" });
    expect(db.startBrief).not.toHaveBeenCalled();
  });
});

describe("runNewsBrief with a reserved brief", () => {
  it("keeps a failure on the reserved row with its reason (instead of deleting it), and reserves nothing new", async () => {
    await expect(runNewsBrief({ trigger: "manual", reservedId: 5 })).rejects.toMatchObject({ code: "no_news" });
    expect(db.failBrief).toHaveBeenCalledWith(5, "ไม่มีข่าวใหม่ในช่วงนี้ให้สรุป");
    expect(db.startBrief).not.toHaveBeenCalled();
  });
});
