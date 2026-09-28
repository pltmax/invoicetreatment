import type { Level } from "@/lib/rules/types";

// Callout style per reason level. Full class strings so Tailwind can see them.
// Text stays dark: white on these 80% backgrounds falls below WCAG AA.
export const REASON_STYLE: Record<Level, string> = {
  green: "text-sm text-gray-800",
  orange: "text-sm font-medium text-orange-800",
  red: "text-sm font-medium text-red-800",
};
