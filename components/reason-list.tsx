import type { Reason } from "@/lib/rules/types";

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-gray-500">Aucun motif enregistré.</p>;
  }
  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => (
        <li key={index} className="text-sm text-gray-800">
          {reason.message}
        </li>
      ))}
    </ul>
  );
}
