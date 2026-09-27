import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { InvoiceList } from "./_components/invoice-list";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const invoices = await getPendingInvoices(db);
  return (
    <div className="px-4 py-4">
      <InvoiceList invoices={invoices} />
    </div>
  );
}
