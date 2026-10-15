"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatDateTime } from "@/lib/format/datetime";
import { factorDef, GOAL_WEIGHTS, type FormulaGoal } from "@/lib/analysis/factors";
import { FIT_LABEL, GOALS, type AnalysisView, type Fit, type GoalId } from "@/lib/analysis/types";
import { CheckIcon, CopyIcon, SparklesIcon } from "./icons";
import { Spinner } from "./Spinner";

const usd = (n: number) => `$${n.toFixed(2)}`;

const FIT_CLASS: Record<Fit, string> = {
  high: "text-success",
  medium: "text-foreground",
  low: "text-muted",
  unknown: "text-muted",
};

/** "สูตร #3" next to a pick: where the formula (the yardstick) put the same stock. */
function FormulaChip({ a, symbol }: { a: AnalysisView; symbol: string }) {
  const f = a.formula.find((x) => x.symbol === symbol);
  if (!f) return null;
  return (
    <span className="rounded-full bg-card px-2.5 py-0.5 text-xs text-muted" title="อันดับจากสูตรของระบบ สำหรับเป้าหมายและข้อมูลชุดเดียวกัน">
      สูตร {f.rank !== null ? `#${f.rank}` : "ข้อมูลไม่พอ"}
    </span>
  );
}

/** How the formula scores the chosen goals: the factors, their weights and which way is better. */
function FormulaExplained({ goals }: { goals: GoalId[] }) {
  const chosen: FormulaGoal[] = goals.length > 0 ? goals : ["balanced"];
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-foreground">สูตรคิดอันดับยังไง</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          แต่ละปัจจัยเทียบเป็นอันดับในกลุ่ม (percentile 0–100) แล้วถ่วงน้ำหนักตามเป้าหมาย ปัจจัยที่หุ้นตัวนั้นไม่มีข้อมูลจะถูกข้าม (ไม่นับเป็นข้อเสีย)
          ถ้าข้อมูลมีไม่ถึงครึ่งของน้ำหนัก จะขึ้นว่า &quot;ข้อมูลไม่พอ&quot; · หลายเป้าหมาย = เฉลี่ยคะแนนของแต่ละเป้า
        </p>
        {chosen.map((g) => (
          <p key={g}>
            <span className="text-foreground">{g === "balanced" ? "ภาพรวมสมดุล" : (GOALS.find((x) => x.id === g)?.label ?? g)}:</span>{" "}
            {GOAL_WEIGHTS[g].weights.map((w) => `${factorDef(w.factor).label} ${w.dir === 1 ? "สูงดี" : "ต่ำดี"} ×${w.weight}`).join(" · ")}
            {GOAL_WEIGHTS[g].required && ` (ต้องมีข้อมูล${factorDef(GOAL_WEIGHTS[g].required!).label} ไม่งั้นไม่เข้าเป้า)`}
          </p>
        ))}
      </div>
    </details>
  );
}

/** The AI's verdict on every stock next to the formula's rank, so a stock the AI passed over is visible and comparable. */
function Verdicts({ a }: { a: AnalysisView }) {
  if (a.verdicts.length === 0) return null;
  const pickRank = new Map(a.picks.map((p) => [p.symbol, p.rank]));
  const order: Record<Fit, number> = { high: 0, medium: 1, low: 2, unknown: 3 };
  const formula = new Map(a.formula.map((f) => [f.symbol, f]));
  const rows = [...a.verdicts].sort(
    (x, y) =>
      (pickRank.get(x.symbol) ?? 99) - (pickRank.get(y.symbol) ?? 99) ||
      order[x.fit] - order[y.fit] ||
      (formula.get(x.symbol)?.rank ?? 99) - (formula.get(y.symbol)?.rank ?? 99),
  );
  return (
    <section aria-label="ความเห็นของ AI ทุกตัว เทียบอันดับจากสูตร" className="surface space-y-3 p-4">
      <div>
        <h2 className="font-semibold">ทุกตัวที่ AI ดู เทียบอันดับจากสูตร</h2>
        <p className="mt-1 text-xs text-muted">AI ต้องให้ความเห็นครบทุกตัว · &quot;สูตร&quot; = อันดับที่ระบบคำนวณเองจากข้อมูลชุดเดียวกัน (AI ไม่เห็นตัวเลขนี้)</p>
      </div>
      <ul className="space-y-1.5">
        {rows.map((v) => {
          const f = formula.get(v.symbol);
          const ai = pickRank.get(v.symbol);
          return (
            <li key={v.symbol} className="tile grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-0.5 px-3 py-2.5 sm:grid-cols-[4.5rem_1fr_auto]">
              <span className="font-mono font-semibold">{v.symbol}</span>
              <span className="text-sm">
                <span className={`mr-1.5 text-xs font-medium ${FIT_CLASS[v.fit]}`}>{FIT_LABEL[v.fit]}</span>
                <span className="text-muted">{v.note || "AI ไม่ได้ให้ความเห็นตัวนี้"}</span>
              </span>
              <span className="col-start-2 flex gap-3 font-mono text-xs text-muted sm:col-start-auto sm:justify-self-end">
                <span>AI {ai ? `#${ai}` : "—"}</span>
                <span title={f?.missingRequired.length ? "ไม่มีข้อมูลที่เป้าหมายนี้ต้องใช้" : undefined}>
                  สูตร {f?.rank ? `#${f.rank}` : "ข้อมูลไม่พอ"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <FormulaExplained goals={a.goals} />
    </section>
  );
}

function Result({ a }: { a: AnalysisView }) {
  const goalLabels = a.goals.map((id) => GOALS.find((g) => g.id === id)?.label ?? id);
  return (
    <section aria-label="ผลวิเคราะห์" className="space-y-4">
      <div className="surface space-y-2 p-4">
        <p className="text-xs text-muted">
          วิเคราะห์เมื่อ {formatDateTime(new Date(a.createdAt))} · โมเดล <span className="font-mono">{a.model}</span> · ดูหุ้น {a.universe} ตัว ·
          เป้าหมาย: {goalLabels.length > 0 ? goalLabels.join(", ") : "ภาพรวมสมดุล"}
          {a.anonymized && " · ซ่อนชื่อหุ้นจาก AI"}
        </p>
        {a.skipped.length > 0 && (
          <p className="text-xs text-warning">
            ใช้โมเดลสำรอง: {a.skipped.map((s) => `${s.model} ใช้ไม่ได้ (${s.reason})`).join(", ")} จึงสลับมาใช้ {a.model}
          </p>
        )}
        {a.summary && <p className="text-sm leading-relaxed">{a.summary}</p>}
      </div>

      <ol className="space-y-3">
        {a.picks.map((p) => (
          <li key={p.symbol} className="surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary-2 font-mono text-sm font-semibold text-on-primary">
                  {p.rank}
                </span>
                <h2 className="font-mono text-lg font-semibold tracking-wide">{p.symbol}</h2>
                <FormulaChip a={a} symbol={p.symbol} />
              </div>
              {p.price !== null && <span className="font-mono text-lg tabular-nums">{usd(p.price)}</span>}
            </div>

            {p.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {p.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.risks.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {p.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-label="ความเสี่ยง" className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.entryNote && <p className="tile mt-3 px-3 py-2.5 text-xs leading-relaxed text-muted">{p.entryNote}</p>}
          </li>
        ))}
      </ol>

      <Verdicts a={a} />

      {a.caveats.length > 0 && (
        <ul className="space-y-1 text-xs leading-relaxed text-muted">
          {a.caveats.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted">
        ผลนี้สร้างโดย AI จากตัวเลขในระบบ{a.anonymized ? " (ซ่อนชื่อหุ้น ไม่ได้ส่งข่าว)" : " และสรุปข่าวล่าสุดจากหน้า \"ข่าว\" (ถ้ามีภายใน 36 ชั่วโมง)"} อาจผิดพลาดได้
        และไม่ใช่คำแนะนำการลงทุน — &quot;อันดับจากสูตร&quot; เป็นเกณฑ์อ้างอิงที่ระบบคำนวณเองเพื่อเทียบกับ AI ไม่ได้ส่งให้ AI · backtest ของระบบยังไม่พบว่าการซื้อตามแนวรับให้ผลดีกว่าซื้อวันอื่นอย่างมีนัยสำคัญ
        ใช้เพื่อช่วยคัดว่าตัวไหนควรดูต่อ ไม่ใช่สัญญาณซื้อ
      </p>
    </section>
  );
}

export function AnalysisPanel({
  initial,
  used: initialUsed,
  limit,
  missing,
  models,
  readOnly = false,
}: {
  initial: AnalysisView | null;
  used: number;
  limit: number;
  /** names of the AI environment variables not set yet (empty = ready) */
  missing: string[];
  /** models from AI_MODEL: the first is the default, the rest are fallbacks and can be picked */
  models: string[];
  /** a visitor of the public site: the latest result only, no controls */
  readOnly?: boolean;
}) {
  const [goals, setGoals] = useState<Set<GoalId>>(new Set());
  const [model, setModel] = useState(models[0] ?? "");
  const [result, setResult] = useState(initial);
  const [used, setUsed] = useState(initialUsed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "busy" | "copied">("idle");
  const [anonymous, setAnonymous] = useState(false);
  /** after a copy with hidden names: which code is which stock (never part of the copied text) */
  const [codes, setCodes] = useState<Record<string, string> | null>(null);
  /** the browser refused the clipboard: the text is shown to select by hand */
  const [manualText, setManualText] = useState<string | null>(null);

  useEffect(() => {
    if (copy !== "copied") return;
    const t = setTimeout(() => setCopy("idle"), 2500);
    return () => clearTimeout(t);
  }, [copy]);

  /**
   * The same prompt and data, to paste into any AI chat: no AI call here, so it works without settings or quota.
   * The clipboard write starts inside the click with the text still on its way (a ClipboardItem holding a promise):
   * waiting for the server first and then writing fails with "Document is not focused" when the window lost focus
   * meanwhile. If the browser still refuses, the text is shown to copy by hand.
   */
  async function copyPrompt() {
    setCopy("busy");
    setError(null);
    setManualText(null);
    const textPromise = apiFetch("/api/analysis/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [...goals], anonymous }),
    }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as { text?: string; codes?: Record<string, string> | null; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `สร้างข้อความไม่สำเร็จ (HTTP ${res.status})`);
      setCodes(body.codes ?? null);
      return body.text;
    });
    textPromise.catch(() => {}); // handled below; avoids an unhandled rejection while the clipboard waits
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": textPromise.then((t) => new Blob([t], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await textPromise);
      }
      setCopy("copied");
    } catch (err) {
      setCopy("idle");
      const text = await textPromise.catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "สร้างข้อความไม่สำเร็จ");
        return null;
      });
      if (text !== null) {
        setManualText(text); // the text is fine, only the clipboard was refused
        setError(`เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ (${err instanceof Error ? err.message : "clipboard"}) — คัดลอกจากกล่องด้านล่างแทน`);
      }
    }
  }

  const ready = missing.length === 0;
  const left = Math.max(0, limit - used);

  function toggle(id: GoalId) {
    setGoals((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: [...goals], anonymous, ...(models.length > 1 ? { model } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { analysis?: AnalysisView; error?: string; used?: number | null };
      if (typeof body.used === "number") setUsed(body.used);
      if (!res.ok || !body.analysis) throw new Error(body.error ?? `วิเคราะห์ไม่สำเร็จ (HTTP ${res.status})`);
      setResult(body.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "วิเคราะห์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">วิเคราะห์ด้วย AI</h1>
          <p className="mt-1 text-sm text-muted">
            ผลล่าสุดที่เจ้าของระบบสั่งวิเคราะห์: ส่งหุ้นทุกตัวที่ track พร้อมปัจจัยที่คำนวณเทียบกันได้ ข้อมูลพื้นฐาน แนวรับ และข่าว ให้ AI ให้ความเห็นทุกตัวและจัดอันดับตัวที่ควรดูต่อสูงสุด 5 ตัว
            ตามเป้าหมายที่เลือก พร้อมอันดับจากสูตรของระบบไว้เทียบ
          </p>
        </div>
        {result ? <Result a={result} /> : <div className="surface p-8 text-center text-sm text-muted">ยังไม่มีผลวิเคราะห์</div>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">วิเคราะห์ด้วย AI</h1>
        <p className="mt-1 text-sm text-muted">
          ส่งหุ้นทุกตัวที่ track พร้อมราคาปัจจุบัน ปัจจัยที่คำนวณเทียบกันได้ (โมเมนตัม ความผันผวน ขนาดบริษัท อัพไซด์ ฯลฯ) ข้อมูลพื้นฐาน แนวรับ และข่าว
          ให้ AI ให้ความเห็นทุกตัวและจัดอันดับตัวที่ควรดูต่อสูงสุด 5 ตัว ตามเป้าหมายที่เลือก พร้อมอันดับจากสูตรของระบบไว้เทียบ
        </p>
      </div>

      {!ready && (
        <div role="alert" className="rounded-[1.25rem] bg-warning/10 p-4 text-sm">
          <p className="font-medium text-warning">ยังไม่ได้ตั้งค่า AI</p>
          <p className="mt-1 text-muted">
            เพิ่ม environment variable{" "}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && ", "}
                <code className="font-mono text-foreground">{m}</code>
              </span>
            ))}{" "}
            ใน Vercel แล้ว redeploy (ดูวิธีใน README หัวข้อ &quot;วิเคราะห์ด้วย AI&quot;)
          </p>
        </div>
      )}

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">เป้าหมาย (เลือกได้หลายข้อ ไม่เลือก = ดูภาพรวมสมดุล)</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GOALS.map((g) => {
            const on = goals.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                className={`cursor-pointer rounded-2xl px-4 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                  on ? "bg-foreground text-background" : "bg-card hover:bg-raised"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {on && <CheckIcon className="size-4 shrink-0" />}
                  {g.label}
                </span>
                <span className={`mt-0.5 block text-xs leading-relaxed ${on ? "text-background/70" : "text-muted"}`}>{g.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || !ready || left === 0}
          className="btn-primary"
        >
          {busy ? <Spinner /> : <SparklesIcon />}
          {busy ? "กำลังวิเคราะห์…" : "วิเคราะห์ด้วย AI"}
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          disabled={busy || copy === "busy"}
          title="คัดลอกคำสั่งและข้อมูลชุดเดียวกัน ไปวางในแชท AI ที่ใช้อยู่ (ไม่ใช้โควตา)"
          className="btn-soft bg-card hover:bg-raised"
        >
          {copy === "busy" ? <Spinner /> : copy === "copied" ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copy === "copied" ? "คัดลอกแล้ว วางในแชท AI ได้เลย" : "คัดลอกไปถาม AI เอง"}</span>
        </button>
        <span className="text-xs text-muted">
          วันนี้ใช้ไปแล้ว <span className="font-mono tabular-nums">{used}/{limit}</span> ครั้ง
          {models.length === 1 && <> · โมเดล <span className="font-mono">{models[0]}</span></>}
        </span>
        {models.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            โมเดล
            {/* the native arrow sits on the rounded edge: hide it and draw one inside the padding */}
            <span className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="field cursor-pointer appearance-none bg-card pl-4 pr-10 font-mono text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {models.map((m, i) => (
                  <option key={m} value={m}>
                    {m}
                    {i === 0 ? " (หลัก)" : ""}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </label>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          disabled={busy}
          className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
        />
        <span>
          ซ่อนชื่อหุ้นจาก AI
          <span className="block text-xs leading-relaxed text-muted">
            ส่งเป็นรหัส S01, S02… ไม่ส่งราคาเป็นดอลลาร์และข่าว เพื่อไม่ให้ AI เลือกเพราะคุ้นชื่อ (ใช้ได้ทั้งปุ่มวิเคราะห์และปุ่มคัดลอก) — AI ยังอาจเดาได้จากกลุ่มอุตสาหกรรมและขนาด
          </span>
        </span>
      </label>

      {codes && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-foreground">คีย์รหัสของข้อความที่คัดลอก (ไม่ได้อยู่ในข้อความ)</summary>
          <p className="mt-2 font-mono leading-relaxed">
            {Object.entries(codes)
              .map(([c, sym]) => `${c} = ${sym}`)
              .join(" · ")}
          </p>
        </details>
      )}

      {manualText && (
        <textarea
          readOnly
          value={manualText}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="ข้อความสำหรับคัดลอกเอง"
          className="field h-40 w-full bg-card p-3 font-mono text-xs"
        />
      )}

      <div aria-live="polite" className="min-h-5">
        {busy && <p className="text-sm text-muted">AI กำลังอ่านข้อมูลหุ้นทั้งหมด ปกติไม่เกิน 1 นาที แต่ถ้าผู้ให้บริการช้าหรือต้องสลับโมเดล อาจนานถึงราว 5 นาที อย่าปิดหน้านี้</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      {result ? (
        <Result a={result} />
      ) : (
        <div className="surface p-8 text-center text-sm text-muted">ยังไม่เคยวิเคราะห์ — เลือกเป้าหมายแล้วกด &quot;วิเคราะห์ด้วย AI&quot;</div>
      )}
    </div>
  );
}
