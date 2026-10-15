import { TIER_LABEL_TH, type Tier } from "@/lib/support/types";

const STYLE: Record<Tier, string> = {
  minor: "bg-warning/12 text-warning",
  intermediate: "bg-caution/12 text-caution",
  major: "bg-danger/12 text-danger",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[tier]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {TIER_LABEL_TH[tier]}
    </span>
  );
}
