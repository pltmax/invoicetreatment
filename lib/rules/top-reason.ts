// lib/rules/top-reason.ts
import type { Reason } from "@/lib/rules/types";

// Prefer the first red/orange reason (the actionable one) over a green /
// informational reason that might happen to come first in the array.
export function topReason(reasons: Reason[]): Reason | undefined {
  return reasons.find((r) => r.level === "red" || r.level === "orange") ?? reasons[0];
}

// Single-item list form, for feeding ReasonList in compact views.
export function topReasons(reasons: Reason[]): Reason[] {
  const top = topReason(reasons);
  return top ? [top] : [];
}
