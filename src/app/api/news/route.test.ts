import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled: (() => Promise<void>)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => scheduled.push(fn) }));
const requestNewsBrief = vi.fn<() => Promise<number>>();
const runNewsBrief = vi.fn(async () => ({ id: 9, stocks: [], refs: [] }));
vi.mock("@/lib/jobs/news", async (orig) => ({ ...(await orig<typeof import("@/lib/jobs/news")>()), requestNewsBrief, runNewsBrief }));
const briefsOnDay = vi.fn(async () => 1);
const briefStatus = vi.fn(async () => ({ running: { id: 9, startedAt: "2026-11-17T13:00:00.000Z" }, latest: null, lastFailure: null }));
vi.mock("@/lib/db/news", () => ({ briefsOnDay, briefStatus }));
const isOwner = vi.fn(async () => true);
vi.mock("@/lib/viewer", () => ({ isOwner }));

const { POST } = await import("./route");
const status = await import("./status/route");
const { NewsError } = await import("@/lib/jobs/news");

beforeEach(() => {
  scheduled.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/news (fire and forget)", () => {
  it("answers 202 at once with the reserved brief, then makes it in the background", async () => {
    requestNewsBrief.mockResolvedValue(9);
    const res = await POST();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, id: 9, used: 1 });
    expect(runNewsBrief).not.toHaveBeenCalled();
    await scheduled[0]();
    expect(runNewsBrief).toHaveBeenCalledWith({ trigger: "manual", reservedId: 9 });
  });

  it("a failure in the background is only logged (the row keeps the reason): nothing throws", async () => {
    requestNewsBrief.mockResolvedValue(9);
    runNewsBrief.mockRejectedValueOnce(new NewsError("AI ตอบไม่ทัน", "timeout"));
    await POST();
    await expect(scheduled[0]()).resolves.toBeUndefined();
  });

  it("answers at once when it cannot start: already running, daily limit, no settings", async () => {
    for (const [code, http] of [["busy", 409], ["limit", 429], ["not_configured", 503]] as const) {
      requestNewsBrief.mockRejectedValueOnce(new NewsError("x", code));
      const res = await POST();
      expect(res.status).toBe(http);
    }
    expect(scheduled).toHaveLength(0);
  });
});

describe("GET /api/news/status", () => {
  it("tells the owner what is running and the usage; visitors get 401", async () => {
    const res = await status.GET();
    expect(await res.json()).toEqual({ running: { id: 9, startedAt: "2026-11-17T13:00:00.000Z" }, latest: null, lastFailure: null, used: 1 });
    isOwner.mockResolvedValueOnce(false);
    expect((await status.GET()).status).toBe(401);
  });
});
