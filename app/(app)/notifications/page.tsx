import { db } from "@/lib/db/client";
import { getNotifications } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { Amount } from "@/components/amount";
import { LevelBadge } from "@/components/level-badge";
import { formatDateTimeFr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const notifications = await getNotifications(db);

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Notifications envoyées aux propriétaires de factures depuis le début de la session.
        </p>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune notification envoyée pour le moment.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {notifications.map((notification) => (
            <li key={notification.invoiceId} className="space-y-1 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-gray-500">
                  {notificationEmail(notification.entityName)}
                </span>
                <span className="shrink-0 text-xs text-gray-400">
                  {formatDateTimeFr(notification.sentAt)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-gray-900">{notification.invoiceNumber}</span>
                <Amount cents={notification.amountInclVatCents} className="font-medium text-gray-900" />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                {notification.level ? <LevelBadge level={notification.level} /> : <span />}
                <span className="text-gray-600">
                  {notification.outcome === "approved" ? "Approuvée" : "Rejetée"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
