import { db } from "@/lib/db/client";
import { listSessionsWithDecisions } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { SessionHistory } from "./_components/session-history";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const sessions = await listSessionsWithDecisions(db);
  const sessionsWithEmails = sessions.map((session) => ({
    ...session,
    notifiedEmails: [...new Set(session.decisions.map((d) => notificationEmail(d.entityName)))],
  }));

  return (
    <div className="space-y-4 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Historique</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sessions signées, du plus récent au plus ancien, avec les décisions et notifications de
          chacune.
        </p>
      </div>

      <SessionHistory sessions={sessionsWithEmails} />
    </div>
  );
}
