import type { Reason } from "@/lib/rules/types";
import { REASON_STYLE } from "@/lib/ui/reason-style";

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-gray-500">Aucun motif enregistré.</p>;
  }
  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => (
        <li key={index} className={REASON_STYLE[reason.level]}>
          {reason.message}
        </li>
      ))}
    </ul>
  );
}
