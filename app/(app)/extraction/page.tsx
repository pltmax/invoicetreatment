import { db } from "@/lib/db/client";
import { getEntities } from "@/lib/db/queries";
import { UploadForm } from "./_components/upload-form";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  "missing-entity": "Choisissez une filiale destinataire.",
  "missing-file": "Choisissez un fichier PDF.",
  "not-pdf": "Le fichier doit être un PDF.",
  "too-large": "Le fichier dépasse 10 Mo.",
};

export default async function ExtractionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  const entities = await getEntities(db);

  const errorText = error === "extraction" ? message : error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="space-y-6 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Couche d&apos;extraction</h1>
      </div>

      <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Comment ça marche en production</p>
        <p>
          Chaque facture reçue par email à invoices@holding.com serait captée par un webhook de
          réception : la pièce jointe PDF est récupérée automatiquement, puis envoyée à Claude
          pour une extraction structurée des données (fournisseur, montants, dates, IBAN...). La
          facture apparaît alors directement dans la file d&apos;attente, classée et prête à être
          examinée — sans aucune intervention humaine.
        </p>
        <p>
          Pour cette démo, vous pouvez déclencher cette même étape manuellement : choisissez la
          filiale destinataire et déposez un PDF de facture ci-dessous. Le PDF est transmis à
          Claude pour extraction, puis stocké de façon privée — il reste consultable depuis la
          fiche de la facture une fois créée.
        </p>
        <p className="text-gray-500">Utilisez uniquement des factures fictives (aucune donnée réelle).</p>
      </div>

      {errorText && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorText}</p>
      )}

      <UploadForm entities={entities} />
    </div>
  );
}
