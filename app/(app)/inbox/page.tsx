import Link from "next/link";
import { db } from "@/lib/db/client";
import { getInboxInvoices } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { Amount } from "@/components/amount";
import { formatDateTimeFr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const invoices = await getInboxInvoices(db);

  return (
    <div className="space-y-4 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Boîte de réception</h1>
        <p className="mt-1 text-sm text-gray-500">
          invoices@holding.com · Extraction automatique déjà effectuée
        </p>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune facture reçue en attente.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link href={`/invoices/${invoice.id}`} className="flex items-start gap-3 p-4">
                <div
                  className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-300 p-0.5 text-center text-[9px] font-medium leading-tight text-gray-500 [overflow-wrap:anywhere]"
                  aria-hidden="true"
                >
                  {invoice.invoiceNumber}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-gray-500">
                      {notificationEmail(invoice.entityName)}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {formatDateTimeFr(invoice.receivedAt)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-medium text-gray-900">
                    Facture {invoice.supplierName} — <Amount cents={invoice.amountInclVatCents} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
