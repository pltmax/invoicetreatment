"use client";

import { useState } from "react";
import Link from "next/link";
import { invoiceDetailHref } from "@/lib/batch-selection";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { createBatchSession } from "@/app/actions/sign";
import type { PendingInvoiceRow } from "@/lib/db/queries";
import { ReasonList } from "@/components/reason-list";
import { topReasons } from "@/lib/rules/top-reason";

export function SessionReview({ invoices }: { invoices: PendingInvoiceRow[] }) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const remaining = invoices.filter((invoice) => !removedIds.has(invoice.id));
  const remainingIds = remaining.map((invoice) => invoice.id);
  const total = remaining.reduce((sum, invoice) => sum + invoice.amountInclVatCents, 0);

  if (remaining.length === 0) {
    return <p className="text-sm text-gray-500">Toutes les factures ont été retirées de la sélection.</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {remaining.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-3 p-4">
            <Link href={invoiceDetailHref(invoice.id, remainingIds)} className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-gray-900">{invoice.supplierName}</span>
                <Amount cents={invoice.amountInclVatCents} className="shrink-0 font-medium text-gray-900" />
              </div>
              {invoice.level && (
                <div className="mt-1">
                  <LevelBadge level={invoice.level} />
                </div>
              )}
              <div className="mt-2">
                <ReasonList reasons={topReasons(invoice.reasons)} variant="summary" />
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setRemovedIds((prev) => new Set(prev).add(invoice.id))}
              className="shrink-0 text-sm text-gray-400 underline"
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>

      <form
        action={createBatchSession}
        className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-gray-200 bg-white p-4 shadow-sm"
      >
        {remaining.map((invoice) => (
          <input key={invoice.id} type="hidden" name="ids" value={invoice.id} />
        ))}
        <span className="text-sm text-gray-700">
          {remaining.length} facture{remaining.length === 1 ? "" : "s"} · <Amount cents={total} />
        </span>
        <button
          type="submit"
          className="min-h-[44px] shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Signer et valider
        </button>
      </form>
    </div>
  );
}
