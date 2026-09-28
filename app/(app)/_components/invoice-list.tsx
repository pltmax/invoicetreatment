"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import type { PendingInvoiceRow } from "@/lib/db/queries";
import { formatDateFr } from "@/lib/format";
import type { Level } from "@/lib/rules/types";
import { topReasonMessage } from "@/lib/rules/top-reason";

const LEVEL_ORDER: Level[] = ["red", "orange", "green"];

const ALL = "all";

function groupLabel(level: Level, count: number): string {
  if (level === "red") return "En alerte";
  if (level === "orange") return "En vigilance";
  return `Conforme${count > 1 ? "s" : ""}`;
}

export function InvoiceList({ invoices }: { invoices: PendingInvoiceRow[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [entityFilter, setEntityFilter] = useState(ALL);
  const [supplierFilter, setSupplierFilter] = useState(ALL);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");

  const entityOptions = useMemo(
    () => [...new Set(invoices.map((invoice) => invoice.entityName))].sort((a, b) => a.localeCompare(b)),
    [invoices]
  );
  const supplierOptions = useMemo(
    () => [...new Set(invoices.map((invoice) => invoice.supplierName))].sort((a, b) => a.localeCompare(b)),
    [invoices]
  );

  const hasActiveFilter =
    entityFilter !== ALL || supplierFilter !== ALL || dueFrom !== "" || dueTo !== "";

  function resetFilters() {
    setEntityFilter(ALL);
    setSupplierFilter(ALL);
    setDueFrom("");
    setDueTo("");
  }

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      if (entityFilter !== ALL && invoice.entityName !== entityFilter) return false;
      if (supplierFilter !== ALL && invoice.supplierName !== supplierFilter) return false;
      if (dueFrom !== "" && invoice.dueDate < dueFrom) return false;
      if (dueTo !== "" && invoice.dueDate > dueTo) return false;
      return true;
    });
  }, [invoices, entityFilter, supplierFilter, dueFrom, dueTo]);

  const groups = useMemo(() => {
    const byLevel = new Map<Level, PendingInvoiceRow[]>();
    for (const level of LEVEL_ORDER) byLevel.set(level, []);
    for (const invoice of filteredInvoices) {
      const level = invoice.level ?? "orange";
      byLevel.get(level)?.push(invoice);
    }
    return LEVEL_ORDER.map((level) => ({ level, rows: byLevel.get(level) ?? [] }));
  }, [filteredInvoices]);

  const stats = useMemo(() => {
    const counts: Record<Level, number> = { green: 0, orange: 0, red: 0 };
    let total = 0;
    for (const invoice of filteredInvoices) {
      const level = invoice.level ?? "orange";
      counts[level] += 1;
      total += invoice.amountInclVatCents;
    }
    return { counts, total };
  }, [filteredInvoices]);

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
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="mb-1 block text-gray-500">Filiale</label>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 pr-6"
          >
            <option value={ALL}>Toutes</option>
            {entityOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-gray-500">Fournisseur</label>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 pr-6"
          >
            <option value={ALL}>Tous</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Échéances :</span>
              <label className="text-gray-500">du</label>
              <input
                type="date"
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
                className="rounded border border-gray-300 p-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-gray-500">au</label>
              <input
                type="date"
                value={dueTo}
                onChange={(e) => setDueTo(e.target.value)}
                className="rounded border border-gray-300 p-2"
              />
            </div>
          </div>
        </div>
      </div>

      {hasActiveFilter && (
        <button type="button" onClick={resetFilters} className="mb-4 text-sm text-blue-600 underline">
          Réinitialiser les filtres
        </button>
      )}

      <div className="mb-6 flex flex-wrap gap-4 text-sm text-gray-600">
        <span>
          {stats.counts.red} en alerte · {stats.counts.orange} en vigilance · {stats.counts.green}{" "}
          conforme{stats.counts.green > 1 ? "s" : ""}
        </span>
        <span>
          Total en attente : <Amount cents={stats.total} className="font-medium text-gray-900" />
        </span>
      </div>

      {filteredInvoices.length === 0 && (
        <p className="text-sm text-gray-500">Aucune facture ne correspond aux filtres.</p>
      )}

      {groups.map(({ level, rows }) =>
        rows.length === 0 ? null : (
          <div key={level} className="mb-8">
            <h2 className="mb-2">
              <LevelBadge level={level} label={groupLabel(level, rows.length)} />
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
                    <div className="mt-1 truncate text-sm text-gray-600">
                      {topReasonMessage(invoice.reasons)}
                    </div>
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
        <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-gray-200 bg-white p-4 shadow-sm">
          <span className="text-sm text-gray-700">
            {selected.length} facture{selected.length === 1 ? "" : "s"} ·{" "}
            <Amount cents={selectedTotal} />
          </span>
          <Link
            href={`/sessions/new?ids=${selected.map((invoice) => invoice.id).join(",")}`}
            className="min-h-[44px] shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white flex items-center justify-center"
          >
            Examiner la sélection
          </Link>
        </div>
      )}
    </div>
  );
}
