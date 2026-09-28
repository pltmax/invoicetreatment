import type { Level } from "@/lib/rules/types";

// Callout style per reason level. Full class strings so Tailwind can see them.
// Text stays dark: white on these 80% backgrounds falls below WCAG AA.
export const REASON_STYLE: Record<Level, string> = {
  green: "text-sm text-gray-800",
  orange: "rounded border border-orange-600 bg-orange-500/80 px-3 py-2 text-sm font-medium text-gray-900",
  red: "rounded border border-red-700 bg-red-500/80 px-3 py-2 text-sm font-medium text-gray-900",
};
