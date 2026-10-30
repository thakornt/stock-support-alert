export interface AlertRules {
  /** Price counts as "touching" a level when price <= level * (1 + touchTolerance). */
  touchTolerance: number;
  /** After an alert, price must rise above level * (1 + rearmBuffer) before it can fire again. */
  rearmBuffer: number;
  /** Minimum minutes between two alerts for the same symbol + tier. */
  cooldownMinutes: number;
}

export const DEFAULT_RULES: AlertRules = {
  touchTolerance: 0.003,
  rearmBuffer: 0.01,
  cooldownMinutes: 60,
};

export interface TierState {
  armed: boolean;
  lastAlertAt: Date | null;
}

/**
 * Two prices of the same thing (a stored close and the provider's "previous close") that differ by more than this
 * are on different scales: a split or reverse split happened (the provider rescales its history, our stored levels
 * are not), or the data is wrong. Comparing a level with a price across that gap would fire a meaningless alert.
 */
const SCALE_MISMATCH = 0.2;
export const sameScale = (a: number, b: number) => Math.abs(a / b - 1) <= SCALE_MISMATCH;

export type Decision = "alert" | "rearm" | "none";

/**
 * Per (symbol, tier) state machine:
 *
 *   armed --price touches level--> ALERT --> disarmed
 *   disarmed --price bounces above level + buffer--> rearmed (no message)
 *
 * Each tier has its own state, so touching a different tier fires independently,
 * and touching the same tier again only fires after a real bounce.
 * A missing state row means "armed".
 */
export function evaluateTier(
  input: {
    price: number;
    level: number;
    state: TierState | undefined;
    now: Date;
    /** Today's low; when given, a touch earlier in the day counts (once-a-day mode). */
    low?: number;
  },
  rules: AlertRules = DEFAULT_RULES,
): Decision {
  const { price, level, now } = input;
  const state = input.state ?? { armed: true, lastAlertAt: null };

  if (!state.armed) {
    return price > level * (1 + rules.rearmBuffer) ? "rearm" : "none";
  }

  const touched = Math.min(price, input.low ?? price) <= level * (1 + rules.touchTolerance);
  if (!touched) return "none";

  if (state.lastAlertAt) {
    const elapsedMin = (now.getTime() - state.lastAlertAt.getTime()) / 60_000;
    if (elapsedMin < rules.cooldownMinutes) return "none";
  }
  return "alert";
}

export type TouchStatus = "touch" | "broken" | "gap_broken";

/** Price this far under the level (fraction) is no longer a "touch" but a break. */
export const BREAK_BELOW = 0.02;
/** Previous close above the level and price this far under it = the level was jumped over by a gap. */
export const GAP_BELOW = 0.05;

/**
 * What the alert should call the event:
 *  - touch: price is at the level, or less than BREAK_BELOW under it
 *  - broken: price is more than BREAK_BELOW under the level (the support did not hold so far)
 *  - gap_broken: yesterday closed above the level and price is now more than GAP_BELOW under it: the level was never
 *    tested, it was gapped through, so "buy at support" does not apply until new supports are computed
 */
export function classifyTouch(price: number, level: number, prevClose?: number): TouchStatus {
  if (prevClose !== undefined && prevClose > level && price < level * (1 - GAP_BELOW)) return "gap_broken";
  if (price < level * (1 - BREAK_BELOW)) return "broken";
  return "touch";
}
