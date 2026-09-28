import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getSessionWithDecisions } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { Amount } from "@/components/amount";
import { LevelBadge } from "@/components/level-badge";
import { formatDateTimeFr } from "@/lib/format";
import { CopyHashButton } from "./_components/copy-hash-button";
import { PrintButton } from "./_components/print-button";

export const dynamic = "force-dynamic";

export default async function BordereauPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionWithDecisions(db, id);
  if (!session) notFound();

  const total = session.decisions.reduce((sum, d) => sum + d.amountInclVatCents, 0);

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="no-print flex justify-end gap-3">
        <PrintButton />
      </div>

      <div>
        <h1 className="text-lg font-semibold text-gray-900">Bordereau {session.id}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Signé le</dt>
            <dd className="text-gray-900">{formatDateTimeFr(session.signedAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Signataire</dt>
            <dd className="text-gray-900">PDG</dd>
          </div>
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="text-gray-900">{session.kind === "batch" ? "Lot" : "Individuelle"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Nombre de factures</dt>
            <dd className="text-gray-900">{session.decisions.length}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Référence de signature</dt>
            <dd className="text-gray-900">{session.signatureRef}</dd>
          </div>
        </dl>
      </div>

      <div className="no-print rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        <p className="mb-1 font-medium text-gray-900">Notifications envoyées</p>
        {session.decisions.map((decision) => (
          <p key={decision.invoiceId}>Notification envoyée à {notificationEmail(decision.entityName)}</p>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 pr-4 font-normal">Facture</th>
            <th className="py-2 pr-4 font-normal">Fournisseur</th>
            <th className="py-2 pr-4 font-normal">Filiale</th>
            <th className="py-2 pr-4 text-right font-normal">Montant</th>
            <th className="py-2 pr-4 font-normal">Niveau</th>
            <th className="py-2 pr-4 font-normal">Décision</th>
            <th className="py-2 font-normal">Commentaire</th>
          </tr>
        </thead>
        <tbody>
          {session.decisions.map((decision) => (
            <tr key={decision.invoiceId} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-900">{decision.invoiceNumber}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.supplierName}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.entityName}</td>
              <td className="py-2 pr-4 text-right">
                <Amount cents={decision.amountInclVatCents} />
              </td>
              <td className="py-2 pr-4">{decision.level && <LevelBadge level={decision.level} />}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.outcome === "approved" ? "Approuvée" : "Rejetée"}</td>
              <td className="py-2 text-gray-600">{decision.comment ?? "—"}</td>
            </tr>
          ))}
          <tr className="font-medium text-gray-900">
            <td className="py-2 pr-4" colSpan={3}>
              Total
            </td>
            <td className="py-2 pr-4 text-right">
              <Amount cents={total} />
            </td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
      </div>

      <div className="rounded border border-gray-200 p-3 text-sm">
        <p className="text-gray-500">Empreinte d&apos;intégrité (SHA-256)</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="text-gray-900">
            {session.contentHash.slice(0, 12)}…{session.contentHash.slice(-4)}
          </code>
          <CopyHashButton hash={session.contentHash} />
        </div>
        <code className="hidden break-all text-gray-900 print:block">{session.contentHash}</code>
      </div>

      <p className="text-sm text-gray-500">
        Ce bordereau est immuable une fois signé. Aucune action de modification n&apos;existe sur cette
        page.
      </p>
    </div>
  );
}
