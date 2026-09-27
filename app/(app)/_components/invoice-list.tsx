"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { createBatchSession } from "@/app/actions/sign";
import type { PendingInvoiceRow } from "@/lib/db/queries";
import { formatDateFr } from "@/lib/format";
import type { Level } from "@/lib/rules/types";

const LEVEL_ORDER: Level[] = ["red", "orange", "green"];

function topReasonMessage(invoice: PendingInvoiceRow): string {
  const flagged = invoice.reasons.find((r) => r.level === "red" || r.level === "orange");
  return flagged?.message ?? invoice.reasons[0]?.message ?? "Conforme";
}

export function InvoiceList({ invoices }: { invoices: PendingInvoiceRow[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byLevel = new Map<Level, PendingInvoiceRow[]>();
    for (const level of LEVEL_ORDER) byLevel.set(level, []);
    for (const invoice of invoices) {
      const level = invoice.level ?? "orange";
      byLevel.get(level)?.push(invoice);
    }
    return LEVEL_ORDER.map((level) => ({ level, rows: byLevel.get(level) ?? [] }));
  }, [invoices]);

  const stats = useMemo(() => {
    const counts: Record<Level, number> = { green: 0, orange: 0, red: 0 };
    let total = 0;
    for (const invoice of invoices) {
      const level = invoice.level ?? "orange";
      counts[level] += 1;
      total += invoice.amountInclVatCents;
    }
    return { counts, total };
  }, [invoices]);

  const selected = useMemo(
    () => invoices.filter((invoice) => selectedIds.has(invoice.id)),
    [invoices, selectedIds]
  );
  const selectedTotal = selected.reduce((sum, invoice) => sum + invoice.amountInclVatCents, 0);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (invoices.length === 0) {
    return <p className="text-sm text-gray-500">Aucune facture en attente.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-gray-600">
        <span>
          {stats.counts.red} rouge · {stats.counts.orange} orange · {stats.counts.green} vert
        </span>
        <span>
          Total en attente : <Amount cents={stats.total} className="font-medium text-gray-900" />
        </span>
      </div>

      {groups.map(({ level, rows }) =>
        rows.length === 0 ? null : (
          <div key={level} className="mb-8">
            <h2 className="mb-2">
              <LevelBadge level={level} />
            </h2>
            <ul className="divide-y divide-gray-200 rounded border border-gray-200">
              {rows.map((invoice) => (
                <li key={invoice.id} className="flex items-start gap-3 p-4">
                  {level !== "red" && (
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={selectedIds.has(invoice.id)}
                      onChange={() => toggle(invoice.id)}
                      aria-label={`Sélectionner la facture ${invoice.invoiceNumber}`}
                    />
                  )}
                  <Link href={`/invoices/${invoice.id}`} className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-gray-900">{invoice.supplierName}</span>
                      <Amount
                        cents={invoice.amountInclVatCents}
                        className="shrink-0 font-medium text-gray-900"
                      />
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {invoice.entityName} · {formatDateFr(invoice.dueDate)}
                    </div>
                    <div className="mt-1 truncate text-sm text-gray-600">{topReasonMessage(invoice)}</div>
                  </Link>
                  {level === "red" && (
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="shrink-0 self-center rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
                    >
                      Examiner
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {selected.length > 0 && (
        <form
          action={createBatchSession}
          className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-gray-200 bg-white p-4 shadow-sm"
        >
          {selected.map((invoice) => (
            <input key={invoice.id} type="hidden" name="ids" value={invoice.id} />
          ))}
          <span className="text-sm text-gray-700">
            {selected.length} facture{selected.length === 1 ? "" : "s"} ·{" "}
            <Amount cents={selectedTotal} />
          </span>
          <button
            type="submit"
            className="min-h-[44px] shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Approuver la sélection en lot
          </button>
        </form>
      )}
    </div>
  );
}
