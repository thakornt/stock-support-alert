import { AiError, chat } from "@/lib/ai/client";
import { computeFactors, FACTORS, formulaRanking, percentiles, type FactorSource } from "@/lib/analysis/factors";
import { anonymize, buildStockInput, buildUserPrompt, MANUAL_PROMPT_RULES, SYSTEM_PROMPT, type StockInput } from "@/lib/analysis/prompt";
import { AnalysisParseError, parseAnalysis, type ParsedAnalysis } from "@/lib/analysis/parse";
import type { AnalysisPick, AnalysisView, FormulaEntry, GoalId } from "@/lib/analysis/types";
import { config } from "@/lib/config";
import { cancelAnalysis, finishAnalysis, getAnalysis, startAnalysis } from "@/lib/db/analyses";
import { latestBrief } from "@/lib/db/news";
import { closesBySymbol } from "@/lib/db/priceHistory";
import { listProfiles } from "@/lib/db/profiles";
import { listSupportTests } from "@/lib/db/supports";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { nyToday } from "@/lib/market/calendar";
import { withTimeout } from "@/lib/timeout";
import { currentTarget, toProfileData } from "@/lib/profile/describe";
import { summarizeTrack } from "@/lib/support/track";
import { getLivePrices } from "./livePrices";

const PRICE_BUDGET_MS = 8000;
/** Calendar days of closes to load: 252 trading days + 1 for the 12-month return and the volatility. */
const HISTORY_DAYS = 380;
/** A news brief older than this is not given to the AI (news goes stale fast). */
const NEWS_MAX_AGE_MS = 36 * 3_600_000;

export type AnalysisErrorCode = "bad_request" | "not_configured" | "no_symbols" | "limit" | "timeout" | "ai" | "parse";

/** `message` is user-safe (shown on the page). */
export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly code: AnalysisErrorCode,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

/**
 * Ask the AI to rank the tracked stocks for the given goals, and store the run.
 *
 * Order matters for cost: configuration and "is there anything to analyse" are checked first (free); then a run is
 * reserved (it counts toward AI_DAILY_LIMIT whatever happens next); only then are prices fetched and the provider called.
 */
export async function runAnalysis(goals: GoalId[], opts: { model?: string; anonymous?: boolean } = {}, now = new Date()): Promise<AnalysisView> {
  const missing = config.ai.missing();
  if (missing.length > 0) throw new AnalysisError(`ยังไม่ได้ตั้งค่า ${missing.join(", ")} ใน environment variables`, "not_configured");

  // The chosen model goes first; the others stay as fallbacks. Only models listed in AI_MODEL can be chosen.
  const configured = config.ai.models();
  if (opts.model !== undefined && !configured.includes(opts.model)) throw new AnalysisError("โมเดลที่เลือกไม่อยู่ในรายการ AI_MODEL", "bad_request");
  const models = opts.model === undefined ? configured : [opts.model, ...configured.filter((m) => m !== opts.model)];

  const data = await loadData();
  const day = nyToday(now);
  const id = await startAnalysis(day, goals, models[0], config.ai.dailyLimit());
  if (id === null) {
    throw new AnalysisError(`ใช้ครบ ${config.ai.dailyLimit()} ครั้งของวันนี้แล้ว (ปรับได้ด้วย AI_DAILY_LIMIT) ลองใหม่พรุ่งนี้`, "limit");
  }

  try {
    const anonymous = opts.anonymous === true;
    const { stocks, formula } = await prepare(data, day, goals);
    const sent = anonymous ? anonymize(stocks) : null;
    const reply = await chat({ system: SYSTEM_PROMPT, user: buildUserPrompt(goals, sent?.stocks ?? stocks, day, { anonymous }), models });
    const ids = sent ? [...sent.codes.keys()] : stocks.map((x) => x.symbol);
    const parsed = translate(parseAnalysis(reply.text, ids), sent?.codes ?? null);

    // A pick the AI itself judged a poor fit contradicts its own verdict: such a reply is not trusted on that stock.
    const contradicted = parsed.contradicted;
    const picks: AnalysisPick[] = parsed.picks
      .filter((p) => !contradicted.includes(p.symbol))
      .map((p, i) => ({ ...p, rank: i + 1, price: stocks.find((x) => x.symbol === p.symbol)?.price ?? null }));
    const caveats = contradicted.length
      ? [...parsed.caveats, `ตัด ${contradicted.join(", ")} ออกจากอันดับ เพราะ AI เลือกไว้แต่ประเมินเองว่าไม่ค่อยเข้าเป้า (คำตอบขัดกัน)`]
      : parsed.caveats;
    await finishAnalysis(id, {
      ok: true,
      model: reply.model,
      result: {
        summary: parsed.summary,
        picks,
        caveats,
        universe: data.tracked.length,
        skipped: reply.skipped,
        verdicts: parsed.verdicts,
        formula,
        anonymized: anonymous,
      },
    });
    const view = await getAnalysis(id);
    if (!view) throw new Error("analysis row missing after save");
    return view;
  } catch (err) {
    const error =
      err instanceof AnalysisParseError
        ? new AnalysisError(`${err.message} — ลองใหม่อีกครั้ง (หรือเลือกโมเดลที่ทำตามคำสั่งได้ดีกว่า)`, "parse")
        : err instanceof AiError
          ? new AnalysisError(err.message, err.kind === "timeout" ? "timeout" : "ai")
          : new AnalysisError("วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง", "ai");
    if (!(err instanceof AiError) && !(err instanceof AnalysisParseError)) console.error("analysis failed", err);
    // Only runs that produced a result count toward AI_DAILY_LIMIT: whatever went wrong, the reserved run is given back.
    await cancelAnalysis(id).catch((e) => console.error("could not give back the failed run", e));
    throw error;
  }
}

type Data = Awaited<ReturnType<typeof loadData>>;

/** Codes back to tickers, in the fields and in the AI's own sentences ("S03" -> "KYTX"). */
function translate(parsed: ParsedAnalysis, codes: Map<string, string> | null): ParsedAnalysis {
  if (!codes) return parsed;
  const sym = (c: string) => codes.get(c) ?? c;
  const text = (t: string) => t.replace(/\bS\d{2}\b/g, (c) => codes.get(c) ?? c);
  return {
    summary: text(parsed.summary),
    caveats: parsed.caveats.map(text),
    picks: parsed.picks.map((p) => ({ ...p, symbol: sym(p.symbol), reasons: p.reasons.map(text), risks: p.risks.map(text), entryNote: text(p.entryNote) })),
    verdicts: parsed.verdicts.map((v) => ({ ...v, symbol: sym(v.symbol), note: text(v.note) })),
    contradicted: parsed.contradicted.map(sym),
  };
}

/** Tracked stocks with their profiles and level history (database only). */
async function loadData() {
  // a little over a year of closes: returns up to 12 months and the realised volatility need 253
  const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [tracked, profiles, tests, brief, closes] = await Promise.all([
    listTrackedSymbols(),
    listProfiles().catch(() => []),
    listSupportTests().catch(() => []),
    latestBrief().catch(() => null),
    closesBySymbol(from).catch(() => new Map<string, number[]>()),
  ]);
  if (tracked.length === 0) throw new AnalysisError("ยังไม่มีหุ้นที่ track — เพิ่มที่หน้าจัดการหุ้นก่อน", "no_symbols");
  const news = brief && Date.now() - Date.parse(brief.createdAt) < NEWS_MAX_AGE_MS ? brief.stocks : [];
  return { tracked, profiles, tests, news, closes };
}

interface Prepared {
  stocks: StockInput[];
  formula: FormulaEntry[];
}

/**
 * What the AI gets per stock, with the current price (the shared live cache: Finnhub -> Yahoo, else the price saved by
 * the scheduled check; capped at 8 s so it plus the AI call fit the function's 300 s), the comparable factors with
 * their percentiles among these stocks, and the formula ranking for the same goals (kept for the page, NOT sent to the AI).
 */
async function prepare({ tracked, profiles, tests, news, closes }: Data, day: string, goals: GoalId[]): Promise<Prepared> {
  const live: Record<string, { price: number }> = await withTimeout(getLivePrices(tracked.map((s) => s.symbol)), PRICE_BUDGET_MS, "live prices")
    .then((r) => r.prices)
    .catch(() => ({}));

  const rows = tracked.map((s) => {
    const raw = profiles.find((x) => x.symbol === s.symbol);
    const profile = raw ? toProfileData(raw) : undefined;
    const track = summarizeTrack(tests.filter((t) => t.symbol === s.symbol), day);
    const price = live[s.symbol]?.price ?? s.price;
    const brief = news.find((n) => n.symbol === s.symbol) ?? null;
    const brk = track.recentBreak;
    const underBreak = brk !== null && price !== null && price < Math.min(brk.level, brk.zoneLow ?? brk.level);
    const minor = track.records.minor;
    const source: FactorSource = {
      symbol: s.symbol,
      price,
      closes: closes.get(s.symbol) ?? [],
      high52w: profile?.high52w ?? null,
      maxDrawdown: profile?.maxDrawdown ?? null,
      pe: profile?.pe ?? null,
      forwardPe: profile?.forwardPe ?? null,
      revenueGrowth: profile?.revenueGrowth ?? null,
      netMargin: profile?.netMargin ?? null,
      dividendYield: profile?.dividendYield ?? null,
      beta: profile?.beta ?? null,
      marketCap: profile?.marketCap ?? null,
      targetMean: profile ? currentTarget(profile, day) : null,
      ratings: profile?.recPeriod
        ? {
            buy: (profile.recStrongBuy ?? 0) + (profile.recBuy ?? 0),
            hold: profile.recHold ?? 0,
            sell: (profile.recSell ?? 0) + (profile.recStrongSell ?? 0),
          }
        : null,
      // levels are stored first support first; none = the price is below all of them
      firstSupport: underBreak ? null : (s.levels[0]?.price ?? null),
      firstTierRecord: { held: minor.held, total: minor.held + minor.broken + minor.unclear, expectedHeld: minor.expectedHeld },
      news: brief ? { direction: brief.direction, impact: brief.impact } : null,
    };
    return { s, profile, track, price, brief, values: computeFactors(source) };
  });

  const values = rows.map((r) => r.values);
  const pcts = new Map(FACTORS.map((f) => [f.id, percentiles(values.map((v) => v[f.id]))] as const));
  const stocks = rows.map((r, i) => {
    const factors: StockInput["factors"] = {};
    for (const f of FACTORS) {
      const v = r.values[f.id];
      const p = pcts.get(f.id)![i];
      if (v !== undefined && p !== undefined) factors[f.id] = { value: Number(v.toFixed(f.id === "marketCapB" ? 2 : 1)), percentile: Math.round(p) };
    }
    return buildStockInput(r.s, r.price, r.profile, r.track, day, r.brief, factors);
  });
  const formula = formulaRanking(
    rows.map((r) => r.s.symbol),
    values,
    goals,
  ).map((f) => ({ ...f, score: f.score === null ? null : Math.round(f.score * 10) / 10, coverage: Math.round(f.coverage * 100) / 100 }));
  return { stocks, formula };
}

/**
 * The same instructions and data as an in-app run, as one text to paste into any AI chat. No provider call, no quota,
 * no AI settings needed: the way out when the quota is used up or the provider is down.
 */
export async function manualPrompt(goals: GoalId[], { anonymous = false }: { anonymous?: boolean } = {}, now = new Date()): Promise<{ text: string; codes: Record<string, string> | null }> {
  const day = nyToday(now);
  const { stocks } = await prepare(await loadData(), day, goals);
  const sent = anonymous ? anonymize(stocks) : null;
  return {
    text: `${MANUAL_PROMPT_RULES}\n\n---\n\n${buildUserPrompt(goals, sent?.stocks ?? stocks, day, { anonymous })}`,
    // the person needs the key to read the answer; it never goes into the copied text
    codes: sent ? Object.fromEntries(sent.codes) : null,
  };
}
