import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { loadContext } from "@/lib/rules/context";
import { getClassification, getDecisionSessionId } from "@/lib/db/queries";
import { median } from "@/lib/rules/stats";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { ReasonList } from "@/components/reason-list";
import { formatDateFr, formatEuros, formatIbanGrouped, formatCategory } from "@/lib/format";
import { signSingleDecision } from "@/app/actions/sign";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await loadContext(db, id, new Date());
  } catch {
    notFound();
  }

  const classification = await getClassification(db, id);
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
  const maxPeerAmount = Math.max(
    context.invoice.amountExclVatCents,
    ...peerRows.map((r) => r.medianAmount),
    1
  );

  const currentIban = context.ibanHistory[0]?.iban ?? null;
  const sirenMismatch = context.invoice.printedSiren !== context.supplier.siren;
  const vatMismatch = context.invoice.printedVatNumber !== context.supplier.vatNumber;
  const ibanMismatch = currentIban !== null && context.invoice.printedIban !== currentIban;

  return (
    <div className="space-y-8 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{context.invoice.invoiceNumber}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
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
      </div>

      <div>
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
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Historique à cette filiale</h2>
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
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Comparaison entre filiales</h2>
        {peerRows.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune facture comparable dans les autres filiales.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm font-medium text-gray-900">
                {context.invoice.entityName} (actuelle)
              </span>
              <div className="h-2 flex-1 rounded bg-gray-100">
                <div
                  className="h-2 rounded bg-blue-600"
                  style={{ width: `${(context.invoice.amountExclVatCents / maxPeerAmount) * 100}%` }}
                />
              </div>
              <Amount
                cents={context.invoice.amountExclVatCents}
                className="w-24 shrink-0 text-right text-sm"
              />
            </div>
            {peerRows.map((row) => (
              <div key={row.entityId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-gray-600">{row.entityName}</span>
                <div className="h-2 flex-1 rounded bg-gray-100">
                  <div
                    className="h-2 rounded bg-gray-400"
                    style={{ width: `${(row.medianAmount / maxPeerAmount) * 100}%` }}
                  />
                </div>
                <Amount cents={row.medianAmount} className="w-24 shrink-0 text-right text-sm text-gray-600" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Contrat</h2>
        {context.contract ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
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
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Identité du fournisseur</h2>
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

      <div>
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
      </div>

      <div>
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
