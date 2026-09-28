import type { Reason } from "@/lib/rules/types";
import { summarizeReason } from "@/lib/rules/reason-summary";
import { REASON_STYLE } from "@/lib/ui/reason-style";

// "summary": short label for list views; "full": complete message for the detail page.
export function ReasonList({
  reasons,
  variant = "full",
}: {
  reasons: Reason[];
  variant?: "summary" | "full";
}) {
  if (reasons.length === 0) {
    return <p className="text-sm text-gray-500">Aucun motif enregistré.</p>;
  }
  const compact = variant === "summary";
  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => (
        <li key={index} className={compact ? `${REASON_STYLE[reason.level]} w-fit max-w-full` : REASON_STYLE[reason.level]}>
          {compact ? summarizeReason(reason) : reason.message}
        </li>
      ))}
    </ul>
  );
}
