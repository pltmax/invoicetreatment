import { db } from "@/lib/db/client";
import { getThresholds } from "@/lib/db/queries";
import { LevelBadge } from "@/components/level-badge";
import { updateThresholds } from "@/app/actions/thresholds";

export const dynamic = "force-dynamic";

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const thresholds = await getThresholds(db);

  return (
    <div className="space-y-8 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Règles de classification</h1>
        <p className="mt-1 text-sm text-gray-500">
          Modifier un seuil reclasse immédiatement les factures en attente.
        </p>
      </div>

      {saved === "1" && (
        <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Règles enregistrées et factures en attente reclassées.
        </p>
      )}
      {error === "invalid" && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Toutes les valeurs doivent être des nombres positifs.
        </p>
      )}
      {error === "order" && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Le seuil rouge de l&apos;écart doit être supérieur au seuil orange.
        </p>
      )}

      <form action={updateThresholds} className="space-y-8">
        <div>
          <h2 className="mb-3">
            <LevelBadge level="red" label="Rouge" />
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="exceptionalAmountEuros" className="mb-1 block text-sm font-medium text-gray-900">
                Montant exceptionnel
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture HT au-dessus de ce montant, quel que soit le fournisseur.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="exceptionalAmountEuros"
                  name="exceptionalAmountEuros"
                  defaultValue={thresholds.exceptionalAmountCents / 100}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">€ HT</span>
              </div>
            </div>
            <div>
              <label htmlFor="deviationRedPct" className="mb-1 block text-sm font-medium text-gray-900">
                Écart vs historique / contrat / filiale — rouge
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Au-delà de ce pourcentage d&apos;écart, la facture passe au rouge.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="deviationRedPct"
                  name="deviationRedPct"
                  defaultValue={Math.round(thresholds.deviationRed * 100)}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div>
              <label htmlFor="ibanRecentChangeDays" className="mb-1 block text-sm font-medium text-gray-900">
                IBAN modifié récemment
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture rouge si l&apos;IBAN du fournisseur a changé il y a moins de ce
                nombre de jours.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="ibanRecentChangeDays"
                  name="ibanRecentChangeDays"
                  defaultValue={thresholds.ibanRecentChangeDays}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">jours</span>
              </div>
            </div>
            <div>
              <label htmlFor="riskWindowMonths" className="mb-1 block text-sm font-medium text-gray-900">
                Événement de risque fournisseur
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture rouge si un événement de risque a été signalé il y a moins de ce
                nombre de mois.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="riskWindowMonths"
                  name="riskWindowMonths"
                  defaultValue={thresholds.riskWindowMonths}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">mois</span>
              </div>
            </div>
            <div>
              <label htmlFor="duplicateWindowDays" className="mb-1 block text-sm font-medium text-gray-900">
                Facture en double — fenêtre
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Même montant, même filiale, émise à moins de ce nombre de jours d&apos;une
                autre facture déjà connue.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="duplicateWindowDays"
                  name="duplicateWindowDays"
                  defaultValue={thresholds.duplicateWindowDays}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">jours</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-3">
            <LevelBadge level="orange" label="Orange" />
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="deviationOrangePct" className="mb-1 block text-sm font-medium text-gray-900">
                Écart vs historique / contrat / filiale — orange
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Au-delà de ce pourcentage d&apos;écart, la facture passe à l&apos;orange.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="deviationOrangePct"
                  name="deviationOrangePct"
                  defaultValue={Math.round(thresholds.deviationOrange * 100)}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div>
              <label htmlFor="newSupplierAmountEuros" className="mb-1 block text-sm font-medium text-gray-900">
                Nouveau fournisseur — seuil
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Première facture d&apos;un fournisseur : orange en dessous de ce montant HT,
                rouge au-dessus.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="newSupplierAmountEuros"
                  name="newSupplierAmountEuros"
                  defaultValue={thresholds.newSupplierAmountCents / 100}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">€ HT</span>
              </div>
            </div>
            <div>
              <label htmlFor="recurringMinInvoices" className="mb-1 block text-sm font-medium text-gray-900">
                Minimum de factures pour être « récurrent »
              </label>
              <p className="mb-1 text-sm text-gray-500">
                En dessous de ce nombre de factures approuvées pour cette filiale, la
                facture passe à l&apos;orange.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="recurringMinInvoices"
                  name="recurringMinInvoices"
                  defaultValue={thresholds.recurringMinInvoices}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">factures</span>
              </div>
            </div>
            <div>
              <label htmlFor="historySample" className="mb-1 block text-sm font-medium text-gray-900">
                Taille de l&apos;échantillon d&apos;historique
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Nombre de factures récentes utilisées pour calculer la médiane de
                comparaison.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="historySample"
                  name="historySample"
                  defaultValue={thresholds.historySample}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">factures</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="min-h-[44px] w-full rounded bg-blue-600 px-4 text-sm font-semibold text-white sm:w-auto sm:px-8"
        >
          Enregistrer les règles
        </button>
      </form>
    </div>
  );
}
