import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { expectedClassifications } from "@/lib/db/seed";
import { resetDemo } from "@/app/actions/demo";

export const dynamic = "force-dynamic";

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}

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
            <th className="border border-gray-300 p-2 text-left">Scénario</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="border border-gray-300 p-2">{invoice.supplierName}</td>
              <td className="border border-gray-300 p-2">{invoice.entityName}</td>
              <td className="border border-gray-300 p-2">{formatEuros(invoice.amountInclVatCents)}</td>
              <td className="border border-gray-300 p-2">{formatDate(invoice.dueDate)}</td>
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
