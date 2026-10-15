/** Shared by the server and the browser: plain data only, no imports from server code. */

export const GOALS = [
  {
    id: "growth",
    label: "เติบโต",
    hint: "รายได้โตเร็ว และนักวิเคราะห์คาดว่ากำไรจะเพิ่ม",
    prompt: "Growth: high revenue growth (revenueGrowthPct) and earnings expected to rise (forwardPe clearly below pe).",
  },
  {
    id: "dividend",
    label: "ปันผล",
    hint: "ผลตอบแทนปันผลสูงและน่าจะจ่ายต่อเนื่อง (หุ้นที่ไม่มีตัวเลขปันผลถือว่าไม่ตรงเป้าหมายนี้)",
    prompt:
      "Dividend income: meaningful dividendYieldPct that looks sustainable (positive net margin, not a yield inflated by a collapsed price). A stock with dividendYieldPct null does not fit this goal.",
  },
  {
    id: "value",
    label: "ราคาไม่แพง",
    hint: "P/E ไม่สูงเมื่อเทียบกำไร (ระวังหุ้นที่ถูกเพราะธุรกิจแย่)",
    prompt: "Valuation: reasonable pe / forwardPe for the quality of the business. Beware stocks that are cheap because the business is deteriorating.",
  },
  {
    id: "stable",
    label: "ความเสี่ยงต่ำ",
    hint: "ราคาแกว่งน้อย เคยลงลึกไม่มาก กำไรเป็นบวก",
    prompt: "Lower risk: low beta, shallow maxDrawdownPct, positive netMarginPct, no earnings announcement in the next few days.",
  },
  {
    id: "dip",
    label: "จังหวะใกล้แนวรับ",
    hint: "ราคาอยู่ใกล้ระดับแนวรับที่ยังไม่หลุด (ไม่เอาตัวที่เพิ่งหลุดแนวรับ)",
    prompt:
      "Entry timing: the price is close to a support level that has not broken (small distanceAbovePct on a level), and not far above its 52-week high. Skip stocks whose recentBreak is set.",
  },
  {
    id: "momentum",
    label: "โมเมนตัม",
    hint: "ราคากำลังขึ้นต่อเนื่อง 3–12 เดือน และอยู่ใกล้จุดสูงสุดของรอบปี",
    prompt: "Momentum: strong ret3m / ret6m / ret12m and the price near its 52-week high (fromHigh52w close to 0).",
  },
  {
    id: "potential",
    label: "ศักยภาพสูง (เสี่ยงสูง)",
    hint: "ราคาเป้าห่างจากราคาตอนนี้มาก รายได้โต บริษัทยังไม่ใหญ่ — ผันผวนและขาดทุนได้",
    prompt:
      "High potential, high risk: large targetUpside (an optimistic opinion, not a forecast), fast revenueGrowth, a smaller marketCapB. Volatility and losses are acceptable for this goal but must be named as risks.",
  },
  {
    id: "turnaround",
    label: "ฟื้นตัวจากจุดต่ำ",
    hint: "ลงมาไกลจากจุดสูงสุด แต่เริ่มเด้งขึ้นจากจุดต่ำสุดของรอบปี",
    prompt: "Turnaround: far below the 52-week high but rebounding from the 52-week low (rebound52wLow, ret1m above 0), better with positive newsScore.",
  },
  {
    id: "smallcap",
    label: "หุ้นเล็ก / ไม่เป็นที่นิยม",
    hint: "บริษัทขนาดเล็ก นักวิเคราะห์ตามน้อย (ตัวที่ไม่ทราบขนาดไม่เข้าเป้านี้)",
    prompt: "Small and less followed: small marketCapB and few analysts (analystCount). A stock whose marketCapB is unknown does not fit this goal.",
  },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];
export const GOAL_IDS: readonly string[] = GOALS.map((g) => g.id);

/** Keeps only known goal ids, once each, in the fixed order of GOALS; null when the input is not a list of strings. */
export function parseGoals(input: unknown): GoalId[] | null {
  if (!Array.isArray(input) || !input.every((g) => typeof g === "string")) return null;
  const chosen = new Set(input);
  if ([...chosen].some((g) => !GOAL_IDS.includes(g))) return null;
  return GOALS.filter((g) => chosen.has(g.id)).map((g) => g.id);
}

export const MAX_PICKS = 5;

export interface AnalysisPick {
  rank: number;
  symbol: string;
  /** price used for the analysis (display; not from the AI) */
  price: number | null;
  reasons: string[];
  risks: string[];
  /** what the AI says about the price versus the support levels */
  entryNote: string;
}

/** How well the AI thinks a stock fits the goals: every tracked stock gets one, so none is skipped silently. */
export const FITS = ["high", "medium", "low", "unknown"] as const;
export type Fit = (typeof FITS)[number];
export const FIT_LABEL: Record<Fit, string> = { high: "เข้าเป้ามาก", medium: "พอเข้าเป้า", low: "ไม่ค่อยเข้าเป้า", unknown: "ข้อมูลไม่พอ" };

export interface Verdict {
  symbol: string;
  fit: Fit;
  /** one Thai sentence */
  note: string;
}

/** The formula's rank (the yardstick next to the AI's), see src/lib/analysis/factors.ts */
export interface FormulaEntry {
  symbol: string;
  rank: number | null;
  score: number | null;
  /** share of the goals' weight that had data (0-1) */
  coverage: number;
  /** goals the stock cannot fit for lack of a required figure */
  missingRequired: string[];
}

export interface AnalysisView {
  id: number;
  /** ISO time */
  createdAt: string;
  model: string;
  goals: GoalId[];
  summary: string;
  picks: AnalysisPick[];
  caveats: string[];
  /** how many tracked stocks the AI looked at */
  universe: number;
  /** models tried before `model` that could not be used (empty for most runs) */
  skipped: { model: string; reason: string }[];
  /** the AI's verdict on every stock (empty for runs made before this existed) */
  verdicts: Verdict[];
  /** the formula ranking for the same goals and data */
  formula: FormulaEntry[];
  /** the AI saw codes (S01, S02...) instead of tickers, and no news */
  anonymized: boolean;
}
