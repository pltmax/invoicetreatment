import "server-only";
import type { Client } from "@libsql/client";
import { getAllInvoicesForPdfGeneration } from "../db/queries";
import { renderInvoicePdf } from "./generate";
import { storeInvoicePdf } from "./store";

const CONCURRENCY = 8;

export async function generateAllInvoicePdfs(db: Client): Promise<void> {
  const invoices = await getAllInvoicesForPdfGeneration(db);
  for (let i = 0; i < invoices.length; i += CONCURRENCY) {
    const chunk = invoices.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (invoice) => {
        const pdf = await renderInvoicePdf(invoice);
        await storeInvoicePdf(db, invoice.id, pdf);
      })
    );
  }
}
