import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { loadContext } from "@/lib/rules/context";
import { getClassification, getDecisionSessionId, getInvoicesByIds } from "@/lib/db/queries";
import { batchReviewHref, parseBatchIds } from "@/lib/batch-selection";
import { median } from "@/lib/rules/stats";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { ReasonList } from "@/components/reason-list";
import { formatDateFr, formatEuros, formatIbanGrouped, formatCategory } from "@/lib/format";
import { signSingleDecision } from "@/app/actions/sign";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { id } = await params;
  const { batch } = await searchParams;

  // These three don't depend on each other's result, and each one is a
  // real network round trip against a remote (Turso) database in
  // production — run them concurrently instead of stacking their latency.
  const [batchInvoices, contextResult, classification] = await Promise.all([
    // Arriving from a batch session: restore that selection on return,
    // minus invoices that are no longer eligible (decided in the meantime).
    getInvoicesByIds(db, parseBatchIds(batch)),
    loadContext(db, id, new Date()).catch(() => null),
    getClassification(db, id),
  ]);
  const batchIds = batchInvoices.map((invoice) => invoice.id);

  if (!contextResult) {
    notFound();
  }
  const context = contextResult;

  const isDecided = context.invoice.status !== "pending";
  const existingSessionId = isDecided ? await getDecisionSessionId(db, id) : null;

  const historyRows = context.groupApprovedInvoices
    .filter(
      (row) => row.entityId === context.invoice.entityId && row.category === context.invoice.category
    )
    .slice(0, context.thresholds.historySample);

  const peerByEntity = new Map<string, { entityName: string; amounts: number[] }>();
  for (const row of context.groupApprovedInvoices) {
    if (row.entityId === context.invoice.entityId) continue;
    if (row.category !== context.invoice.category) continue;
    const entry = peerByEntity.get(row.entityId) ?? { entityName: row.entityName, amounts: [] };
    entry.amounts.push(row.amountExclVatCents);
    peerByEntity.set(row.entityId, entry);
  }
  const peerRows = [...peerByEntity.entries()]
    .map(([entityId, entry]) => ({
      entityId,
      entityName: entry.entityName,
      medianAmount: median(entry.amounts) ?? 0,
    }))
    .sort((a, b) => b.medianAmount - a.medianAmount);

  const currentIban = context.ibanHistory[0]?.iban ?? null;
  const sirenMismatch = context.invoice.printedSiren !== context.supplier.siren;
  const vatMismatch = context.invoice.printedVatNumber !== context.supplier.vatNumber;
  const ibanMismatch = currentIban !== null && context.invoice.printedIban !== currentIban;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-6 py-4">
      {batchIds.length > 0 && (
        <Link
          href={batchReviewHref(batchIds)}
          className="inline-flex min-h-[44px] items-center gap-1 text-base font-medium text-blue-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[1em] w-[1em] shrink-0"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Retour à la validation ({batchIds.length} facture{batchIds.length === 1 ? "" : "s"})
        </Link>
      )}
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{context.invoice.invoiceNumber}</h1>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Fournisseur</dt>
            <dd className="text-gray-900">{context.supplier.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Filiale</dt>
            <dd className="text-gray-900">{context.invoice.entityName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Montant HT</dt>
            <dd className="text-gray-900">
              <Amount cents={context.invoice.amountExclVatCents} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Montant TTC</dt>
            <dd className="text-gray-900">
              <Amount cents={context.invoice.amountInclVatCents} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Émise le</dt>
            <dd className="text-gray-900">{formatDateFr(context.invoice.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Échéance</dt>
            <dd className="text-gray-900">{formatDateFr(context.invoice.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Catégorie</dt>
            <dd className="text-gray-900">{formatCategory(context.invoice.category)}</dd>
          </div>
        </dl>
        <hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Classification</h2>
        {classification ? (
          <div>
            <LevelBadge level={classification.level} />
            <div className="mt-3">
              <ReasonList reasons={classification.reasons} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Aucune classification disponible.</p>
        )}
      <hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Historique avec cette filiale</h2>
        {historyRows.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun historique disponible pour ce fournisseur à cette filiale.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-200 bg-gray-50 font-medium text-gray-900">
                <td className="py-2">Facture actuelle</td>
                <td className="py-2 text-right">
                  <Amount cents={context.invoice.amountExclVatCents} />
                </td>
              </tr>
              {historyRows.map((row, index) => (
                <tr key={index} className="border-b border-gray-100 text-gray-600">
                  <td className="py-2">{formatDateFr(row.dueDate)}</td>
                  <td className="py-2 text-right">
                    <Amount cents={row.amountExclVatCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <hr className="border-t border-gray-200 my-5" />

        <h2 className="mb-2 text-sm font-semibold text-gray-900">Comparaison entre filiales :</h2>
        {peerRows.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune facture comparable dans les autres filiales.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="hidden sm:block" aria-hidden="true" />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-gray-900">
                  {context.invoice.entityName} (actuelle)
                </span>
                <Amount
                  cents={context.invoice.amountExclVatCents}
                  className="shrink-0 text-sm font-semibold text-gray-900"
                />
              </div>
              {peerRows.map((row) => (
                <div key={row.entityId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-gray-600">{row.entityName}</span>
                  <Amount cents={row.medianAmount} className="shrink-0 text-sm text-gray-600" />
                </div>
              ))}
            </div>
          </div>
        )}
<hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Contrat</h2>
        {context.contract ? (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Catégorie</dt>
              <dd className="text-gray-900">{formatCategory(context.contract.category)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Montant attendu HT</dt>
              <dd className="text-gray-900">
                {context.contract.expectedAmountCents !== null
                  ? formatEuros(context.contract.expectedAmountCents)
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">Aucun contrat rattaché.</p>
        )}
<hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Identité du fournisseur</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 font-normal"></th>
                <th className="py-1 font-normal">Registre</th>
                <th className="py-1 font-normal">Facture</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100">
                <td className="py-2 text-gray-500">SIREN</td>
                <td className="py-2 text-gray-900">{context.supplier.siren}</td>
                <td className={`py-2 ${sirenMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                  {context.invoice.printedSiren}
                </td>
              </tr>
              <tr className="border-t border-gray-100">
                <td className="py-2 text-gray-500">TVA</td>
                <td className="py-2 text-gray-900">{context.supplier.vatNumber}</td>
                <td className={`py-2 ${vatMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                  {context.invoice.printedVatNumber}
                </td>
              </tr>
              <tr className="border-t border-gray-100">
                <td className="py-2 text-gray-500">IBAN</td>
                <td className="py-2 text-gray-900">{currentIban ? formatIbanGrouped(currentIban) : "—"}</td>
                <td className={`py-2 ${ibanMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                  {formatIbanGrouped(context.invoice.printedIban)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Historique IBAN</h2>
        {context.ibanHistory.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun historique d&apos;IBAN disponible.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {context.ibanHistory.map((entry, index) => (
              <li key={index} className="flex items-center justify-between py-2">
                <span className="text-gray-900">{formatIbanGrouped(entry.iban)}</span>
                <span className="text-gray-500">
                  {formatDateFr(entry.effectiveFrom)}
                  {index === 0 && <span className="ml-2 text-green-700">Actif</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
<hr className="border-t border-gray-200 my-5" />
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Décision</h2>
        {isDecided ? (
          <p className="text-sm text-gray-600">
            Facture déjà traitée.{" "}
            {existingSessionId && (
              <Link href={`/sessions/${existingSessionId}`} className="text-blue-600 underline">
                Voir le bordereau
              </Link>
            )}
          </p>
        ) : (
          <form action={signSingleDecision} className="space-y-3">
            <input type="hidden" name="invoiceId" value={context.invoice.id} />
            <textarea
              name="comment"
              rows={3}
              placeholder="Commentaire (facultatif)"
              className="w-full rounded border border-gray-300 p-3 text-sm"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                name="outcome"
                value="approved"
                className="min-h-[44px] flex-1 rounded bg-blue-600 px-4 text-sm font-semibold text-white"
              >
                Approuver
              </button>
              <button
                type="submit"
                name="outcome"
                value="rejected"
                className="min-h-[44px] flex-1 rounded border border-gray-300 px-4 text-sm font-semibold text-gray-700"
              >
                Rejeter
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
