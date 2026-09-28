"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Amount } from "@/components/amount";
import { LevelBadge } from "@/components/level-badge";
import { formatDateTimeFr } from "@/lib/format";
import type { SessionHistoryRow } from "@/lib/db/queries";

const ALL = "all";

export type SessionWithEmails = SessionHistoryRow & { notifiedEmails: string[] };

export function SessionHistory({ sessions }: { sessions: SessionWithEmails[] }) {
  const [entityFilter, setEntityFilter] = useState(ALL);
  const [supplierFilter, setSupplierFilter] = useState(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const entityOptions = useMemo(
    () =>
      [...new Set(sessions.flatMap((s) => s.decisions.map((d) => d.entityName)))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [sessions]
  );
  const supplierOptions = useMemo(
    () =>
      [...new Set(sessions.flatMap((s) => s.decisions.map((d) => d.supplierName)))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [sessions]
  );

  const hasActiveFilter = entityFilter !== ALL || supplierFilter !== ALL || dateFrom !== "" || dateTo !== "";

  function resetFilters() {
    setEntityFilter(ALL);
    setSupplierFilter(ALL);
    setDateFrom("");
    setDateTo("");
  }

  const filteredSessions = useMemo(() => {
    return sessions
      .map((session) => {
        const signedDate = session.signedAt.slice(0, 10);
        if (dateFrom !== "" && signedDate < dateFrom) return null;
        if (dateTo !== "" && signedDate > dateTo) return null;

        const decisions = session.decisions.filter((decision) => {
          if (entityFilter !== ALL && decision.entityName !== entityFilter) return false;
          if (supplierFilter !== ALL && decision.supplierName !== supplierFilter) return false;
          return true;
        });
        if (decisions.length === 0) return null;

        return { ...session, decisions };
      })
      .filter((session): session is SessionWithEmails => session !== null);
  }, [sessions, entityFilter, supplierFilter, dateFrom, dateTo]);

  if (sessions.length === 0) {
    return <p className="text-sm text-gray-500">Aucune session pour le moment.</p>;
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
              <span className="text-gray-500">Signée :</span>
              <label className="text-gray-500">du</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded border border-gray-300 p-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-gray-500">au</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
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

      {filteredSessions.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune session ne correspond aux filtres.</p>
      ) : (
        <ul className="space-y-3">
          {filteredSessions.map((session, index) => (
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
                  {session.notifiedEmails.map((email) => (
                    <p key={email}>Notification envoyée à {email}</p>
                  ))}
                </div>

                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {session.decisions.map((decision) => (
                    <li key={decision.invoiceId}>
                      <Link
                        href={`/invoices/${decision.invoiceId}`}
                        className="block space-y-1 p-4 hover:bg-gray-50"
                      >
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
                      </Link>
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
          ))}
        </ul>
      )}
    </div>
  );
}
