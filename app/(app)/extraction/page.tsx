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
        <p className="font-medium text-gray-900">En production cela marcherait de la manière suivante: </p>
        <p>
          Chaque facture reçue par email dans une boîte de réception type: &quot;invoices@holding.com&quot; serait captée par un webhook de
          réception et la pièce jointe PDF serait récupérée automatiquement, puis traitée comme c&apos;est le cas dans cette page
          pour une extraction structurée des données. La facture apparaîtrait alors directement dans la file d&apos;attente, classée et prête à être
          examinée.
        </p>
        <p>
          Pour la démo, on peut déclencher cette même étape manuellement en choisissant la
          filiale destinataire et en déposant un PDF de facture ci-dessous.
        </p>
      </div>

      {errorText && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorText}</p>
      )}

      <UploadForm entities={entities} />
    </div>
  );
}
