import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { expectedClassifications } from "@/lib/db/seed";
import { resetDemo } from "@/app/actions/demo";
import { formatEuros, formatDateFr } from "@/lib/format";
import type { Level } from "@/lib/rules/types";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<Level, string> = {
  green: "bg-green-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const LEVEL_LABEL: Record<Level, string> = {
  green: "Vert",
  orange: "Orange",
  red: "Rouge",
};

export default async function Home() {
  const invoices = await getPendingInvoices(db);
  const scenarioByInvoiceNumber = new Map(
    expectedClassifications.map((entry) => [entry.invoiceNumber, entry.scenario])
  );

  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Factures en attente</h1>
      <form action={resetDemo} className="mt-4">
        <button type="submit" className="border border-gray-400 px-3 py-1 rounded">
          Réinitialiser la démo
        </button>
      </form>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-300 p-2 text-left">Fournisseur</th>
            <th className="border border-gray-300 p-2 text-left">Filiale</th>
            <th className="border border-gray-300 p-2 text-left">Montant TTC</th>
            <th className="border border-gray-300 p-2 text-left">Échéance</th>
            <th className="border border-gray-300 p-2 text-left">Niveau</th>
            <th className="border border-gray-300 p-2 text-left">Motifs</th>
            <th className="border border-gray-300 p-2 text-left">Scénario</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="border border-gray-300 p-2">{invoice.supplierName}</td>
              <td className="border border-gray-300 p-2">{invoice.entityName}</td>
              <td className="border border-gray-300 p-2">{formatEuros(invoice.amountInclVatCents)}</td>
              <td className="border border-gray-300 p-2">{formatDateFr(invoice.dueDate)}</td>
              <td className="border border-gray-300 p-2">
                {invoice.level && (
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${LEVEL_COLOR[invoice.level]}`}
                    title={LEVEL_LABEL[invoice.level]}
                  />
                )}
              </td>
              <td className="border border-gray-300 p-2">
                {invoice.reasonMessages.map((message, index) => (
                  <div key={index}>{message}</div>
                ))}
              </td>
              <td className="border border-gray-300 p-2">
                {scenarioByInvoiceNumber.get(invoice.invoiceNumber) ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
