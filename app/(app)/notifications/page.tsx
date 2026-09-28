import Link from "next/link";
import { db } from "@/lib/db/client";
import { listSessionsWithDecisions } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { Amount } from "@/components/amount";
import { LevelBadge } from "@/components/level-badge";
import { formatDateTimeFr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const sessions = await listSessionsWithDecisions(db);

  return (
    <div className="space-y-4 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sessions signées, du plus récent au plus ancien, avec les décisions et notifications de
          chacune.
        </p>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune session pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((session, index) => {
            const notifiedEmails = [...new Set(session.decisions.map((d) => notificationEmail(d.entityName)))];
            return (
              <li key={session.id} className="rounded border border-gray-200">
                <details open={index === 0}>
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 p-4">
                    <span className="font-medium text-gray-900">{formatDateTimeFr(session.signedAt)}</span>
                    <span className="shrink-0 text-sm text-gray-500">
                      {session.kind === "batch" ? "Lot" : "Individuelle"} · {session.decisions.length} facture
                      {session.decisions.length === 1 ? "" : "s"}
                    </span>
                  </summary>

                  <div className="border-t border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                    <p className="mb-1 font-medium text-gray-900">Notifications envoyées</p>
                    {notifiedEmails.map((email) => (
                      <p key={email}>Notification envoyée à {email}</p>
                    ))}
                  </div>

                  <ul className="divide-y divide-gray-100 border-t border-gray-100">
                    {session.decisions.map((decision) => (
                      <li key={decision.invoiceId} className="space-y-1 p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-gray-900">{decision.invoiceNumber}</span>
                          <Amount cents={decision.amountInclVatCents} className="font-medium text-gray-900" />
                        </div>
                        <div className="flex items-baseline justify-between gap-2 text-sm text-gray-600">
                          <span>
                            {decision.supplierName} · {decision.entityName}
                          </span>
                          <span>{decision.outcome === "approved" ? "Approuvée" : "Rejetée"}</span>
                        </div>
                        {decision.level && <LevelBadge level={decision.level} />}
                      </li>
                    ))}
                  </ul>

                  <div className="border-t border-gray-200 p-3 text-right">
                    <Link href={`/sessions/${session.id}`} className="text-sm text-blue-600 underline">
                      Voir le bordereau
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
