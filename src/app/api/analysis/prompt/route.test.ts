import { beforeEach, describe, expect, it, vi } from "vitest";

const manualPrompt = vi.fn();
class AnalysisError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}
vi.mock("@/lib/jobs/analysis", () => ({ manualPrompt, AnalysisError }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x/api/analysis/prompt", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/analysis/prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the text to paste, for the chosen goals, and the code key when names are hidden", async () => {
    manualPrompt.mockResolvedValue({ text: "PROMPT", codes: null });
    const res = await post({ goals: ["value", "growth"] });
    expect(await res.json()).toEqual({ text: "PROMPT", codes: null });
    expect(manualPrompt).toHaveBeenCalledWith(["growth", "value"], { anonymous: false });
    manualPrompt.mockResolvedValue({ text: "P", codes: { S01: "NVDA" } });
    expect(await (await post({ anonymous: true })).json()).toEqual({ text: "P", codes: { S01: "NVDA" } });
    expect(manualPrompt).toHaveBeenLastCalledWith([], { anonymous: true });
    expect((await post({ anonymous: "yes" })).status).toBe(400);
  });

  it("rejects bad input, and reports 'nothing to analyse' and failures without details", async () => {
    expect((await post("nope")).status).toBe(400);
    expect((await post({ goals: ["x"] })).status).toBe(400);
    manualPrompt.mockRejectedValueOnce(new AnalysisError("ยังไม่มีหุ้น", "no_symbols"));
    expect((await post({})).status).toBe(409);
    manualPrompt.mockRejectedValueOnce(new Error("db password wrong"));
    const res = await post({});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("password");
  });
});
