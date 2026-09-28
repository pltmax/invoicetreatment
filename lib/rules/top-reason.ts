// lib/rules/top-reason.ts
import type { Reason } from "@/lib/rules/types";

// Prefer the first red/orange reason (the actionable one) over a green /
// informational reason that might happen to come first in the array.
export function topReasonMessage(reasons: Reason[]): string {
  const flagged = reasons.find((r) => r.level === "red" || r.level === "orange");
  return flagged?.message ?? reasons[0]?.message ?? "Conforme";
}
