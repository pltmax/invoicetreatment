import Link from "next/link";
import { db } from "@/lib/db/client";
import { getInvoicesByIds } from "@/lib/db/queries";
import { SessionReview } from "./_components/session-review";

export const dynamic = "force-dynamic";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = await searchParams;
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const invoices = await getInvoicesByIds(db, ids);

  if (invoices.length === 0) {
    return (
      <div className="px-4 py-4">
        <p className="text-sm text-gray-500">Aucune facture sélectionnée n&apos;est plus éligible.</p>
        <Link href="/" className="mt-3 inline-block text-sm text-blue-600 underline">
          Retour au tableau de bord
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Validation en lot</h1>
      <SessionReview invoices={invoices} />
    </div>
  );
}
