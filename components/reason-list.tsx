import type { Reason } from "@/lib/rules/types";
import { formatEuros, formatPercent } from "@/lib/format";

function formatReasonDetail(reason: Reason): string | null {
  const data = reason.data;
  if (!data) return null;
  const parts: string[] = [];
  if (typeof data.deviationPct === "number") {
    parts.push(formatPercent(data.deviationPct));
  }
  if (typeof data.amountExclVatCents === "number") {
    parts.push(formatEuros(data.amountExclVatCents));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-gray-500">Aucun motif enregistré.</p>;
  }
  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => {
        const detail = formatReasonDetail(reason);
        return (
          <li key={index} className="text-sm text-gray-800">
            <span>{reason.message}</span>
            {detail && <span className="ml-2 text-gray-500">({detail})</span>}
          </li>
        );
      })}
    </ul>
  );
}
